"""
scoring_api.py — Personal AI Risk Scoring API.

Takes a worker profile (title, city, years of experience, write-up) and the
pre-computed L1 vulnerability table, then returns:
  - final_risk_score   (0-100)
  - risk category       (LOW / MODERATE / HIGH / CRITICAL)
  - component adjustments (experience, AI skills, manual flags)
  - top-5 SHAP feature contributions
  - confidence estimate  (std dev from ensemble)

Two scoring modes:
  1. **Model-based** — uses the trained LightGBM + SHAP (preferred)
  2. **Deterministic fallback** — rule-based formula for cold-start scenarios

Usage:
    # As a module
    from scoring_api import score_worker
    result = score_worker(l1_table, model, explainer, feature_names, profile)

    # CLI demo
    python scoring_api.py
"""

import os
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
import joblib
import shap

from pipeline import (
    normalize_job_title,
    count_ai_mentions,
    count_manual_flags,
    detect_automation_signal,
    ROLE_THEORETICAL_BETA,
    AI_TOOLS,
    MANUAL_KEYWORDS,
)

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────
# 1.  DATA STRUCTURES
# ──────────────────────────────────────────────

CATEGORY_THRESHOLDS = [
    (75, "CRITICAL RISK"),
    (50, "HIGH RISK"),
    (25, "MODERATE RISK"),
    (0,  "LOW RISK"),
]

FEATURE_COLS = [
    "Base_L1_Score",
    "Experience_Mid",
    "AI_Mentions",
    "Manual_Flags",
    "Automation_Weight",
    "Theoretical_Beta",
    "Role_Seniority",
    "Hiring_Intensity",
]

# Reskilling pathway recommendations by risk category
RESKILLING_PATHS = {
    "CRITICAL RISK": {
        "target_roles": ["data analyst", "RPA developer", "AI-assisted support"],
        "courses": [
            {"name": "AI for Everyone (NPTEL)", "url": "https://nptel.ac.in", "weeks": 4},
            {"name": "Python for Data Science (SWAYAM)", "url": "https://swayam.gov.in", "weeks": 8},
            {"name": "Intro to Machine Learning (NPTEL)", "url": "https://nptel.ac.in", "weeks": 12},
        ],
    },
    "HIGH RISK": {
        "target_roles": ["data analyst", "automation specialist"],
        "courses": [
            {"name": "Data Analytics with Python (SWAYAM)", "url": "https://swayam.gov.in", "weeks": 6},
            {"name": "Business Analytics (NPTEL)", "url": "https://nptel.ac.in", "weeks": 8},
        ],
    },
    "MODERATE RISK": {
        "target_roles": ["senior analyst", "AI product manager"],
        "courses": [
            {"name": "AI & ML Fundamentals (NPTEL)", "url": "https://nptel.ac.in", "weeks": 4},
        ],
    },
    "LOW RISK": {
        "target_roles": [],
        "courses": [],
    },
}


# ──────────────────────────────────────────────
# 2.  DETERMINISTIC FALLBACK SCORER
# ──────────────────────────────────────────────

def _deterministic_score(base_l1: float, xp_years: float,
                         ai_count: int, manual_count: int) -> dict:
    """Rule-based fallback when no trained model is available."""
    # Experience adjustment
    if xp_years <= 2:
        xp_adj = 10
    elif xp_years >= 10:
        xp_adj = -20
    elif xp_years >= 7:
        xp_adj = -10
    else:
        xp_adj = 0

    ai_adj     = -15 * ai_count
    manual_adj = 10 * manual_count
    writeup_adj = ai_adj + manual_adj

    final = int(np.clip(round(base_l1 + xp_adj + writeup_adj), 0, 100))

    return {
        "final_risk_score": final,
        "base_l1_vulnerability": round(base_l1),
        "component_adjustments": {
            "experience_adj": xp_adj,
            "ai_skill_adj":   ai_adj,
            "manual_flags_adj": manual_adj,
        },
        "top_features": [
            ("base_l1_vulnerability", round(base_l1, 1)),
            ("manual_flags", manual_adj),
            ("experience_adj", xp_adj),
            ("ai_skill_adj", ai_adj),
        ],
        "confidence": "deterministic (no ML model)",
        "scoring_mode": "fallback",
    }


# ──────────────────────────────────────────────
# 3.  MODEL-BASED SCORER
# ──────────────────────────────────────────────

def _build_feature_vector(profile: dict, l1: pd.DataFrame) -> tuple:
    """Build a single-row feature vector from a worker profile.

    Returns (feature_array, base_l1_score, component metadata).
    """
    title     = profile["title"]
    city      = profile["city"].title()
    xp_years  = float(profile.get("xp_years", 3))
    write_up  = str(profile.get("write_up", ""))

    norm_role = normalize_job_title(title)
    write_up_lower = write_up.lower()

    # Lookup L1 base score
    match = l1[
        (l1["Primary_City"] == city) & (l1["Normalized_Role"] == norm_role)
    ]
    if not match.empty:
        base_l1 = float(match.iloc[0]["AI_Vulnerability_Index"])
        hiring  = float(match.iloc[0]["Total_Jobs"])
    else:
        base_l1 = ROLE_THEORETICAL_BETA.get(norm_role, 0.45) * 100
        hiring  = 0.0

    ai_mentions  = count_ai_mentions(write_up_lower)
    manual_flags = count_manual_flags(write_up_lower)
    auto_weight  = detect_automation_signal(write_up_lower)
    theo_beta    = ROLE_THEORETICAL_BETA.get(norm_role, 0.45)

    # Role seniority bucket
    if xp_years <= 2:
        seniority = 1
    elif xp_years <= 5:
        seniority = 2
    elif xp_years <= 10:
        seniority = 3
    else:
        seniority = 4

    features = np.array([[
        base_l1, xp_years, ai_mentions, manual_flags,
        auto_weight, theo_beta, seniority, hiring,
    ]])

    meta = {
        "base_l1": base_l1,
        "ai_mentions": ai_mentions,
        "manual_flags": manual_flags,
        "norm_role": norm_role,
        "city": city,
    }
    return features, meta


def score_worker(l1: pd.DataFrame, model, explainer,
                 feature_names: list, profile: dict) -> dict:
    """Score a single worker profile using the trained LightGBM model.

    If model/explainer is None, falls back to deterministic scoring.
    """
    features, meta = _build_feature_vector(profile, l1)

    # --- Fallback path ---
    if model is None:
        return _deterministic_score(
            meta["base_l1"],
            float(profile.get("xp_years", 3)),
            meta["ai_mentions"],
            meta["manual_flags"],
        )

    # --- Model prediction ---
    pred = float(model.predict(features)[0])
    final_score = int(np.clip(round(pred), 0, 100))

    # --- SHAP explanation ---
    shap_values = explainer.shap_values(features)[0]
    # Pair feature names with SHAP values, sorted by absolute contribution
    feat_contributions = sorted(
        zip(feature_names, shap_values.tolist(), features[0].tolist()),
        key=lambda x: abs(x[1]),
        reverse=True,
    )
    top_features = [
        {"feature": name, "shap_value": round(sv, 2), "raw_value": round(rv, 2)}
        for name, sv, rv in feat_contributions[:5]
    ]

    # --- Confidence estimate (std from small perturbation ensemble) ---
    rng = np.random.default_rng(0)
    perturbed = np.tile(features, (20, 1))
    perturbed += rng.normal(0, 0.5, perturbed.shape)
    preds_ensemble = model.predict(perturbed)
    confidence_std = float(np.std(preds_ensemble))

    # --- Risk category ---
    category = "LOW RISK"
    for threshold, cat in CATEGORY_THRESHOLDS:
        if final_score >= threshold:
            category = cat
            break

    # --- Experience adjustment (for reporting) ---
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
# 4.  BATCH SCORING
# ──────────────────────────────────────────────

def score_batch(l1: pd.DataFrame, model, explainer,
                feature_names: list, profiles: list[dict]) -> pd.DataFrame:
    """Score multiple worker profiles and return as a DataFrame."""
    results = []
    for i, profile in enumerate(profiles):
        res = score_worker(l1, model, explainer, feature_names, profile)
        res["profile_id"] = i + 1
        res["title"]      = profile["title"]
        res["city"]       = profile["city"]
        res["xp_years"]   = profile.get("xp_years", "N/A")
        results.append(res)

    df = pd.DataFrame(results)
    col_order = [
        "profile_id", "title", "city", "xp_years",
        "final_risk_score", "category", "base_l1_vulnerability",
        "component_adjustments", "top_features", "confidence_std",
        "scoring_mode",
    ]
    return df[[c for c in col_order if c in df.columns]]


# ──────────────────────────────────────────────
# 5.  CLI DEMO
# ──────────────────────────────────────────────

def main():
    """Run a quick demo: load artefacts (or use fallback) and score sample workers."""
    from pipeline import preprocess, compute_l1_index

    # --- Load or compute L1 ---
    if os.path.exists("l1_vulnerability.csv"):
        l1 = pd.read_csv("l1_vulnerability.csv")
        print("[API] Loaded pre-computed L1 table.")
    else:
        print("[API] Computing L1 table from scratch …")
        df = pd.read_csv("Main_Naukri.csv")
        df_clean = preprocess(df)
        l1 = compute_l1_index(df_clean)

    # --- Load model (if trained) ---
    model, explainer, feat_names = None, None, FEATURE_COLS
    if os.path.exists("artefacts/lgb_risk_model.pkl"):
        model      = joblib.load("artefacts/lgb_risk_model.pkl")
        explainer  = joblib.load("artefacts/shap_explainer.pkl")
        feat_names = joblib.load("artefacts/feature_names.pkl")
        print("[API] Loaded trained model.")
    else:
        print("[API] No trained model found — using deterministic fallback.")

    # --- Sample worker profiles ---
    profiles = [
        {
            "title": "BPO Voice Executive",
            "city": "Pune",
            "xp_years": 2,
            "write_up": (
                "I handle customer queries on voice calls and do manual "
                "data entry into the CRM. It involves a lot of copy paste work daily."
            ),
        },
        {
            "title": "Data Analyst",
            "city": "Gurgaon",
            "xp_years": 5,
            "write_up": (
                "I analyze financial data and have recently started using "
                "ChatGPT and Python to automate my basic reporting tasks."
            ),
        },
        {
            "title": "Machine Learning Engineer",
            "city": "Bangalore",
            "xp_years": 7,
            "write_up": (
                "I build and deploy deep learning models using PyTorch and "
                "TensorFlow. I work on NLP pipelines with LLMs and transformers."
            ),
        },
        {
            "title": "Data Entry Operator",
            "city": "Delhi",
            "xp_years": 1,
            "write_up": (
                "I do manual typing and copy paste of records from scanned "
                "documents into Excel. Very repetitive back office work."
            ),
        },
    ]

    print("\n══════════════════════════════════════════════════")
    print("     PERSONAL AI RISK SCORE — DEMO RESULTS")
    print("══════════════════════════════════════════════════\n")

    for p in profiles:
        result = score_worker(l1, model, explainer, feat_names, p)
        print(f"Worker: {p['title']} | {p['city']} | {p['xp_years']} yrs exp")
        print(f"  Score:    {result['final_risk_score']}/100  [{result.get('category', 'N/A')}]")
        print(f"  Base L1:  {result['base_l1_vulnerability']}")
        print(f"  Adjust:   {result['component_adjustments']}")
        if isinstance(result.get("top_features"), list) and result["top_features"]:
            if isinstance(result["top_features"][0], dict):
                print(f"  Top drivers:")
                for f in result["top_features"][:3]:
                    print(f"    - {f['feature']}: SHAP={f['shap_value']:+.1f} (val={f['raw_value']})")
            else:
                print(f"  Top drivers: {result['top_features'][:3]}")
        print(f"  Mode:     {result['scoring_mode']}")
        # Reskilling suggestion
        reskill = result.get("reskilling", {})
        if reskill and reskill.get("courses"):
            print(f"  Reskilling path → {reskill['target_roles']}")
            for c in reskill["courses"][:2]:
                print(f"    📘 {c['name']} ({c['weeks']} weeks)")
        print()


if __name__ == "__main__":
    main()
