"""
service.py — Python ML Scoring Microservice.

Subscribes to Redis channel "layer1.jobs", scores incoming jobs using the
trained LightGBM model, upserts results into PostgreSQL, and publishes
scored output to Redis channel "layer1.scores" for real-time frontend updates.

Also exposes FastAPI endpoints for on-demand scoring.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import redis.asyncio as aioredis
import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from pipeline_utils import (
    normalize_job_title,
    count_ai_mentions,
    count_manual_flags,
    detect_automation_signal,
    build_feature_vector,
    deterministic_score,
    get_risk_category,
    get_risk_band,
    ROLE_THEORETICAL_BETA,
    FEATURE_COLS,
    RESKILLING_PATHS,
    CATEGORY_THRESHOLDS,
    clean_location,
    parse_experience,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [scoring] %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://mirage:mirage123@localhost:5432/jobmarket")
BATCH_SIZE = int(os.getenv("SCORING_BATCH_SIZE", "10"))
FLUSH_INTERVAL = float(os.getenv("SCORING_FLUSH_INTERVAL", "2"))
L1_RECOMPUTE_INTERVAL = int(os.getenv("L1_RECOMPUTE_INTERVAL", "1800"))

JOBS_CHANNEL = "layer1.jobs"
SCORES_CHANNEL = "layer1.scores"

# Global state
model = None
explainer = None
feature_names = None
l1_table = None
pg_pool = None
redis_pub = None


def load_l1_from_csv() -> pd.DataFrame:
    """Load L1 vulnerability table from CSV file."""
    csv_path = "l1_vulnerability.csv"
    if os.path.isfile(csv_path):
        logger.info("Loading L1 table from %s", csv_path)
        return pd.read_csv(csv_path)
    logger.warning("L1 CSV not found at %s, will use empty table", csv_path)
    return pd.DataFrame(columns=[
        "Primary_City", "Normalized_Role", "Total_Jobs",
        "AI_Vulnerability_Index",
    ])


async def compute_l1_from_db() -> pd.DataFrame:
    """Recompute L1 table from PostgreSQL job data."""
    global pg_pool
    if pg_pool is None:
        return load_l1_from_csv()
    try:
        rows = await pg_pool.fetch("""
            SELECT city AS "Primary_City",
                   title AS "Job_Title",
                   skills_list,
                   experience
            FROM jobs
            WHERE city IS NOT NULL AND title IS NOT NULL
        """)
        if not rows:
            return load_l1_from_csv()

        records = []
        for r in rows:
            skills_text = ""
            if r["skills_list"]:
                skills_text = " ".join(r["skills_list"]).lower() if isinstance(r["skills_list"], list) else str(r["skills_list"]).lower()
            norm_role = normalize_job_title(r["Job_Title"])
            records.append({
                "Primary_City": clean_location(r["Primary_City"]),
                "Normalized_Role": norm_role,
                "Requires_AI": 1 if count_ai_mentions(skills_text) > 0 else 0,
                "Automation_Weight": detect_automation_signal(skills_text),
                "Manual_Flags": count_manual_flags(skills_text),
                "AI_Mentions": count_ai_mentions(skills_text),
            })
        df = pd.DataFrame(records)
        agg = df.groupby(["Primary_City", "Normalized_Role"]).agg(
            Total_Jobs=("Requires_AI", "count"),
            Jobs_with_AI=("Requires_AI", "sum"),
            Avg_Automation_Wt=("Automation_Weight", "mean"),
        ).reset_index()
        agg["AI_Penetration_Pct"] = (agg["Jobs_with_AI"] / agg["Total_Jobs"]) * 100
        observed = (agg["AI_Penetration_Pct"] / 100).clip(0, 1)
        observed_adj = (observed * 0.7 + agg["Avg_Automation_Wt"] * 0.3).clip(0, 1)
        theo = agg["Normalized_Role"].map(ROLE_THEORETICAL_BETA).fillna(0.45)
        raw = 0.55 * observed_adj + 0.30 * theo + 0.15 * theo
        agg["AI_Vulnerability_Index"] = (raw * 100).round().clip(0, 100).astype(int)
        agg = agg[agg["Total_Jobs"] >= 3].copy()
        logger.info("Recomputed L1 from DB: %d (city, role) combos", len(agg))
        return agg.sort_values("AI_Vulnerability_Index", ascending=False).reset_index(drop=True)
    except Exception as e:
        logger.error("Failed to compute L1 from DB: %s", e)
        return load_l1_from_csv()


async def periodic_l1_recompute():
    """Periodically recompute L1 table from database."""
    global l1_table
    while True:
        await asyncio.sleep(L1_RECOMPUTE_INTERVAL)
        try:
            l1_table = await compute_l1_from_db()
            logger.info("L1 table recomputed (%d rows)", len(l1_table))
        except Exception as e:
            logger.error("L1 recompute error: %s", e)


def score_single_job(job: dict) -> dict:
    """Score a single job dict from the scraper pipeline."""
    global model, explainer, feature_names, l1_table

    title = job.get("title", job.get("Job_Titles", ""))
    city_raw = job.get("city", job.get("Locations", ""))
    # Accept both "skills_list" (from scraper) and "skills" / "Skills"
    skills_raw = job.get("skills_list", job.get("skills", job.get("Skills", "")))
    experience_raw = job.get("experience", job.get("Experience_Required", ""))
    job_description = job.get("job_description", "")

    norm_role = normalize_job_title(title)
    city = clean_location(city_raw)

    # Build skills text from skills list + job description for richer signal
    skills_text = ""
    if isinstance(skills_raw, list):
        skills_text = " ".join(skills_raw).lower()
    elif skills_raw:
        skills_text = str(skills_raw).lower()
    # Append job description for AI/automation/manual keyword detection
    if job_description:
        skills_text = (skills_text + " " + str(job_description).lower()).strip()

    xp_years = parse_experience(experience_raw)
    if np.isnan(xp_years):
        xp_years = 3.0

    # Build feature vector using the profile format
    profile = {
        "title": title,
        "city": city,
        "xp_years": xp_years,
        "write_up": skills_text,
    }

    features, meta = build_feature_vector(profile, l1_table)

    # Score with model or fallback
    if model is not None:
        try:
            pred = float(model.predict(features)[0])
            score = int(np.clip(round(pred), 0, 100))

            # SHAP explanation
            shap_values = explainer.shap_values(features)[0]
            feat_contributions = sorted(
                zip(feature_names, shap_values.tolist(), features[0].tolist()),
                key=lambda x: abs(x[1]),
                reverse=True,
            )
            top_features = [
                {"feature": name, "shap_value": round(sv, 2), "raw_value": round(rv, 2)}
                for name, sv, rv in feat_contributions[:5]
            ]
            scoring_mode = "model"
        except Exception as e:
            logger.warning("Model scoring failed, using fallback: %s", e)
            fallback = deterministic_score(
                meta["base_l1"], xp_years,
                meta["ai_mentions"], meta["manual_flags"],
            )
            score = fallback["final_risk_score"]
            top_features = fallback["top_features"]
            scoring_mode = "fallback"
    else:
        fallback = deterministic_score(
            meta["base_l1"], xp_years,
            meta["ai_mentions"], meta["manual_flags"],
        )
        score = fallback["final_risk_score"]
        top_features = fallback["top_features"]
        scoring_mode = "fallback"

    risk_band = get_risk_band(score)
    ai_mention_rate = meta["ai_mentions"] / max(len(skills_text.split()), 1)

    return {
        "canonical_role": norm_role,
        "city": city,
        "score": score,
        "risk_band": risk_band,
        "top_features": top_features,
        "ai_mention_rate": round(ai_mention_rate, 3),
        "hiring_intensity": meta["hiring"],
        "scoring_mode": scoring_mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def upsert_scores(scored_results: list):
    """Upsert scored results into PostgreSQL vulnerability_scores table."""
    global pg_pool
    if pg_pool is None:
        return
    try:
        async with pg_pool.acquire() as conn:
            # Ensure extra columns exist (table created in init.sql)
            for col, typ in [("top_features", "JSONB"), ("scoring_mode", "TEXT"), ("updated_at", "TIMESTAMPTZ")]:
                await conn.execute(f"""
                    ALTER TABLE vulnerability_scores ADD COLUMN IF NOT EXISTS {col} {typ}
                """)
            # Remove duplicates and ensure unique constraint for upsert
            has_idx = await conn.fetchval("""
                SELECT 1 FROM pg_indexes WHERE indexname = 'uq_vuln_role_city'
            """)
            if not has_idx:
                await conn.execute("""
                    DELETE FROM vulnerability_scores a USING vulnerability_scores b
                    WHERE a.id < b.id AND a.canonical_role = b.canonical_role AND a.city = b.city
                """)
                await conn.execute("""
                    CREATE UNIQUE INDEX uq_vuln_role_city ON vulnerability_scores (canonical_role, city)
                """)
            for r in scored_results:
                await conn.execute("""
                    INSERT INTO vulnerability_scores
                        (canonical_role, city, score, risk_band, top_features, ai_mention_rate, scoring_mode, updated_at)
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
                    ON CONFLICT (canonical_role, city)
                    DO UPDATE SET
                        score = EXCLUDED.score,
                        risk_band = EXCLUDED.risk_band,
                        top_features = EXCLUDED.top_features,
                        ai_mention_rate = EXCLUDED.ai_mention_rate,
                        scoring_mode = EXCLUDED.scoring_mode,
                        updated_at = NOW()
                """,
                    r["canonical_role"], r["city"], float(r["score"]),
                    r["risk_band"], json.dumps(r["top_features"]),
                    r["ai_mention_rate"], r["scoring_mode"],
                )
    except Exception as e:
        logger.error("DB upsert error: %s", e)


async def score_and_publish(jobs: list):
    """Score a batch of jobs, upsert to DB, publish to Redis."""
    global redis_pub
    if not jobs:
        return

    scored = []
    for job in jobs:
        try:
            result = score_single_job(job)
            scored.append(result)
        except Exception as e:
            logger.error("Error scoring job: %s", e)

    if not scored:
        return

    # Aggregate by (canonical_role, city) — keep latest per group
    seen = {}
    for s in scored:
        key = (s["canonical_role"], s["city"])
        seen[key] = s
    unique_scores = list(seen.values())

    # Upsert to DB
    await upsert_scores(unique_scores)

    # Publish each scored result to Redis
    for s in unique_scores:
        try:
            await redis_pub.publish(SCORES_CHANNEL, json.dumps(s))
        except Exception as e:
            logger.error("Redis publish error: %s", e)

    logger.info("Scored & published %d unique (role, city) results from %d jobs",
                len(unique_scores), len(jobs))


# Shared mutable batch state for subscriber + flush timer
_batch_lock = asyncio.Lock()
_batch: list = []


async def _flush_batch():
    """Flush the shared batch — called from both subscriber and timer."""
    global _batch
    async with _batch_lock:
        if not _batch:
            return
        to_score = _batch
        _batch = []
    await score_and_publish(to_score)


async def subscribe_and_score():
    """Subscribe to layer1.jobs channel, batch & score incoming jobs."""
    global _batch
    sub = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = sub.pubsub()
    await pubsub.subscribe(JOBS_CHANNEL)
    logger.info("Subscribed to Redis channel '%s'", JOBS_CHANNEL)

    # Start the periodic flush timer
    asyncio.create_task(flush_timer())

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            job = json.loads(message["data"])
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON from Redis: %s", e)
            continue

        async with _batch_lock:
            _batch.append(job)
            should_flush = len(_batch) >= BATCH_SIZE

        if should_flush:
            await _flush_batch()


async def flush_timer():
    """Periodic flush to handle low-throughput scenarios."""
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        await _flush_batch()


def score_worker_profile(profile: dict) -> dict:
    """Score a single worker profile (on-demand endpoint)."""
    global model, explainer, feature_names, l1_table

    features, meta = build_feature_vector(profile, l1_table)

    if model is None:
        result = deterministic_score(
            meta["base_l1"],
            float(profile.get("xp_years", 3)),
            meta["ai_mentions"],
            meta["manual_flags"],
        )
        category = get_risk_category(result["final_risk_score"])
        result["category"] = category
        result["reskilling"] = RESKILLING_PATHS.get(category, {})
        return result

    # Model prediction
    pred = float(model.predict(features)[0])
    final_score = int(np.clip(round(pred), 0, 100))

    # SHAP explanation
    shap_values = explainer.shap_values(features)[0]
    feat_contributions = sorted(
        zip(feature_names, shap_values.tolist(), features[0].tolist()),
        key=lambda x: abs(x[1]),
        reverse=True,
    )
    top_features = [
        {"feature": name, "shap_value": round(sv, 2), "raw_value": round(rv, 2)}
        for name, sv, rv in feat_contributions[:5]
    ]

    # Confidence estimate
    rng = np.random.default_rng(0)
    perturbed = np.tile(features, (20, 1))
    perturbed += rng.normal(0, 0.5, perturbed.shape)
    preds_ensemble = model.predict(perturbed)
    confidence_std = float(np.std(preds_ensemble))

    # Risk category
    category = get_risk_category(final_score)

    # Experience adjustment (for reporting)
    xp = float(profile.get("xp_years", 3))
    if xp <= 2:
        xp_adj = 10
    elif xp >= 10:
        xp_adj = -20
    elif xp >= 7:
        xp_adj = -10
    else:
        xp_adj = 0

    return {
        "final_risk_score": final_score,
        "base_l1_vulnerability": round(meta["base_l1"]),
        "category": category,
        "component_adjustments": {
            "experience_adj": xp_adj,
            "ai_skill_adj": -15 * meta["ai_mentions"],
            "manual_flags_adj": 10 * meta["manual_flags"],
        },
        "top_features": top_features,
        "confidence_std": round(confidence_std, 2),
        "scoring_mode": "model",
        "reskilling": RESKILLING_PATHS.get(category, {}),
    }


# ──────────────────────────────────────────────
# FastAPI App
# ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, explainer, feature_names, l1_table, pg_pool, redis_pub

    # Load model artefacts
    artefacts_dir = "artefacts"
    model_path = os.path.join(artefacts_dir, "lgb_risk_model.pkl")
    explainer_path = os.path.join(artefacts_dir, "shap_explainer.pkl")
    features_path = os.path.join(artefacts_dir, "feature_names.pkl")

    if os.path.exists(model_path):
        model = joblib.load(model_path)
        logger.info("Loaded LightGBM model from %s", model_path)
    else:
        logger.warning("Model not found at %s — will use deterministic fallback", model_path)

    if os.path.exists(explainer_path):
        explainer = joblib.load(explainer_path)
        logger.info("Loaded SHAP explainer")
    else:
        logger.warning("SHAP explainer not found — SHAP explanations disabled")

    if os.path.exists(features_path):
        feature_names = joblib.load(features_path)
        logger.info("Loaded feature names: %s", feature_names)
    else:
        feature_names = FEATURE_COLS
        logger.warning("Using default feature names")

    # Load L1 table
    l1_table = load_l1_from_csv()
    logger.info("L1 table loaded: %d rows", len(l1_table))

    # Connect to PostgreSQL
    try:
        pg_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        logger.info("Connected to PostgreSQL")
    except Exception as e:
        logger.error("PostgreSQL connection failed: %s — DB writes disabled", e)
        pg_pool = None

    # Connect to Redis for publishing
    redis_pub = aioredis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Connected to Redis at %s", REDIS_URL)

    # Start background tasks
    subscriber_task = asyncio.create_task(subscribe_and_score())
    l1_recompute_task = asyncio.create_task(periodic_l1_recompute())

    yield

    # Cleanup
    subscriber_task.cancel()
    l1_recompute_task.cancel()
    if pg_pool:
        await pg_pool.close()
    await redis_pub.close()
    logger.info("Scoring service shut down")


app = FastAPI(title="ML Scoring Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "explainer_loaded": explainer is not None,
        "l1_rows": len(l1_table) if l1_table is not None else 0,
        "db_connected": pg_pool is not None,
    }


@app.post("/score")
async def score_single(request: Request):
    body = await request.json()
    profile = {
        "title": body.get("title", body.get("jobTitle", "")),
        "city": body.get("city", ""),
        "xp_years": body.get("xp_years", body.get("yearsOfExperience", 3)),
        "write_up": body.get("write_up", body.get("writeUp", "")),
    }
    result = score_worker_profile(profile)
    return JSONResponse(content=result)


@app.post("/score/batch")
async def score_batch_endpoint(request: Request):
    body = await request.json()
    if not isinstance(body, list):
        return JSONResponse(content={"error": "Expected a list of profiles"}, status_code=400)
    results = []
    for i, p in enumerate(body):
        profile = {
            "title": p.get("title", p.get("jobTitle", "")),
            "city": p.get("city", ""),
            "xp_years": p.get("xp_years", p.get("yearsOfExperience", 3)),
            "write_up": p.get("write_up", p.get("writeUp", "")),
        }
        result = score_worker_profile(profile)
        result["profile_id"] = i + 1
        results.append(result)
    return JSONResponse(content=results)


@app.get("/l1")
async def get_l1():
    if l1_table is None or l1_table.empty:
        return JSONResponse(content=[])
    return JSONResponse(content=l1_table.to_dict(orient="records"))
