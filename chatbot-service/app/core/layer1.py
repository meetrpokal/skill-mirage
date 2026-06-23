"""
Layer-1 Data Access — queries PostgreSQL for live job-market intelligence.

Tables available in PostgreSQL:
─────────────────────────────────────────────────────────────────────
  jobs                 Scraped job listings  (Naukri, LinkedIn, …)
  vulnerability_scores AI vulnerability index per role × city
  skill_mentions       Skill demand trends per city / sector
  aggregates           Summary statistics (top companies, sectors, …)
  watchlist_alerts     Roles with sustained hiring decline
  courses              Government / NPTEL / SWAYAM structured courses
─────────────────────────────────────────────────────────────────────
"""

import psycopg2
import psycopg2.extras
from contextlib import contextmanager

from app.config import settings


# ── Connection ────────────────────────────────────────────────────────────


@contextmanager
def _get_conn():
    """Obtain a read-only PostgreSQL connection."""
    conn = psycopg2.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        dbname=settings.POSTGRES_DB,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
    )
    conn.set_session(readonly=True, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def _run(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a read-only query and return rows as dicts."""
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


# ── Jobs ──────────────────────────────────────────────────────────────────


def search_jobs(
    city: str | None = None,
    canonical_role: str | None = None,
    title_contains: str | None = None,
    sector: str | None = None,
    count_only: bool = False,
    limit: int = 20,
) -> dict:
    """Search or count live job listings with optional filters."""
    conds: list[str] = []
    params: list = []

    if city:
        conds.append("LOWER(city) LIKE LOWER(%s)")
        params.append(f"%{city}%")
    if canonical_role:
        conds.append("LOWER(canonical_role) LIKE LOWER(%s)")
        params.append(f"%{canonical_role}%")
    if title_contains:
        conds.append("LOWER(title) LIKE LOWER(%s)")
        params.append(f"%{title_contains}%")
    if sector:
        conds.append("LOWER(sector) LIKE LOWER(%s)")
        params.append(f"%{sector}%")

    where = f"WHERE {' AND '.join(conds)}" if conds else ""

    if count_only:
        rows = _run(f"SELECT COUNT(*) AS total FROM jobs {where}", tuple(params))
        return {"count": rows[0]["total"] if rows else 0}

    count_params = list(params)
    sql = f"""
        SELECT job_id, title, canonical_role, company, city, state, sector,
               skills_list, salary_min, salary_max, posted_date,
               ai_tool_mentions, ai_mention_rate, source
        FROM jobs {where}
        ORDER BY posted_date DESC NULLS LAST
        LIMIT %s
    """
    params.append(limit)
    jobs = _run(sql, tuple(params))
    total_rows = _run(
        f"SELECT COUNT(*) AS total FROM jobs {where}", tuple(count_params)
    )
    total = total_rows[0]["total"] if total_rows else 0
    return {"jobs": jobs, "total": total, "showing": len(jobs)}


# ── Vulnerability / Risk Scores ───────────────────────────────────────────


def get_vulnerability_scores(
    canonical_role: str | None = None,
    city: str | None = None,
    risk_band: str | None = None,
    max_score: int = 100,
    min_score: int = 0,
    limit: int = 20,
) -> list[dict]:
    """Get AI vulnerability scores for roles × cities."""
    conds: list[str] = ["score <= %s", "score >= %s"]
    params: list = [max_score, min_score]

    if canonical_role:
        conds.append("LOWER(canonical_role) LIKE LOWER(%s)")
        params.append(f"%{canonical_role}%")
    if city:
        conds.append("LOWER(city) LIKE LOWER(%s)")
        params.append(f"%{city}%")
    if risk_band:
        conds.append("LOWER(risk_band) = LOWER(%s)")
        params.append(risk_band)

    where = f"WHERE {' AND '.join(conds)}"
    sql = f"""
        SELECT canonical_role, city, score, risk_band, hiring_decline,
               ai_mention_rate, displacement_ratio, trend_direction,
               delta_30d, top_features, snapshot_date
        FROM vulnerability_scores {where}
        ORDER BY score ASC
        LIMIT %s
    """
    params.append(limit)
    return _run(sql, tuple(params))


# ── Skill Trends ──────────────────────────────────────────────────────────


def get_skill_trends(
    skill: str | None = None,
    city: str | None = None,
    direction: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Get skill demand / mention trends."""
    conds: list[str] = []
    params: list = []

    if skill:
        conds.append("LOWER(skill) LIKE LOWER(%s)")
        params.append(f"%{skill}%")
    if city:
        conds.append("LOWER(city) LIKE LOWER(%s)")
        params.append(f"%{city}%")
    if direction:
        conds.append("LOWER(direction) = LOWER(%s)")
        params.append(direction)

    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    sql = f"""
        SELECT skill, city, sector, mention_count,
               week_over_week_change, month_over_month_change,
               direction, gov_training_seats, gov_courses, has_gov_course,
               snapshot_date
        FROM skill_mentions {where}
        ORDER BY mention_count DESC
        LIMIT %s
    """
    params.append(limit)
    return _run(sql, tuple(params))


# ── Watchlist Alerts ──────────────────────────────────────────────────────


def get_watchlist_alerts(
    canonical_role: str | None = None,
    city: str | None = None,
    active_only: bool = True,
) -> list[dict]:
    """Get roles experiencing sustained hiring declines."""
    conds: list[str] = []
    params: list = []

    if canonical_role:
        conds.append("LOWER(canonical_role) LIKE LOWER(%s)")
        params.append(f"%{canonical_role}%")
    if city:
        conds.append("LOWER(city) LIKE LOWER(%s)")
        params.append(f"%{city}%")
    if active_only:
        conds.append("is_active = TRUE")

    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    sql = f"""
        SELECT canonical_role, city, decline_history,
               consecutive_decline_months, affected_workers,
               severity, is_active, triggered_at
        FROM watchlist_alerts {where}
        ORDER BY consecutive_decline_months DESC
    """
    return _run(sql, tuple(params))


# ── Aggregates ────────────────────────────────────────────────────────────


def get_aggregates(agg_type: str | None = None) -> list[dict]:
    """Get summary aggregates (top companies, sectors, etc.)."""
    if agg_type:
        return _run(
            "SELECT agg_type, agg_key, agg_value, updated_at "
            "FROM aggregates WHERE LOWER(agg_type) = LOWER(%s) "
            "ORDER BY agg_value DESC",
            (agg_type,),
        )
    return _run(
        "SELECT agg_type, agg_key, agg_value, updated_at "
        "FROM aggregates ORDER BY agg_type, agg_value DESC"
    )
