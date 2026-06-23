"""
LangChain tool definitions for the agentic chatbot.

These tools are given to the LangGraph agent which decides at runtime
whether to call Layer-1 data (PostgreSQL) or the RAG course store (Qdrant)
based on the user's query.
"""

import json
from typing import Optional

from langchain_core.tools import tool

from app.core import layer1
from app.core.rag.retriever import get_retriever


# ── Layer-1 Tools ─────────────────────────────────────────────────────────


@tool
def search_jobs(
    city: str = "",
    canonical_role: str = "",
    title_contains: str = "",
    sector: str = "",
    count_only: bool = False,
    limit: int = 20,
) -> str:
    """Search LIVE job listings from the job-market database.

    Use this tool when the user asks about:
    - Job availability in a city or for a role
    - How many jobs exist for a certain role / city / sector
    - What companies are hiring for a role
    - Job details, salary ranges, required skills

    Set count_only=True to get just the total count
    (e.g. "how many BPO jobs in Indore?").
    All string filters use partial matching (LIKE).
    """
    try:
        result = layer1.search_jobs(
            city=city or None,
            canonical_role=canonical_role or None,
            title_contains=title_contains or None,
            sector=sector or None,
            count_only=count_only,
            limit=limit,
        )
        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to query jobs database: {e}"})


@tool
def get_risk_assessment(
    canonical_role: str = "",
    city: str = "",
    risk_band: str = "",
    max_score: int = 100,
    min_score: int = 0,
    limit: int = 20,
) -> str:
    """Get AI vulnerability / risk scores for job roles in specific cities.

    Use this tool when the user asks about:
    - Why their risk / vulnerability score is high or low
    - Which jobs are safer or most at risk of AI displacement
    - Hiring decline or trend direction for specific roles
    - Comparing risk across different roles or cities

    Score range: 0-100 (higher = more vulnerable to AI displacement).
    Risk bands: Low, Moderate, High, Critical.
    Use max_score to find safer roles (e.g. max_score=40).
    Returns: hiring_decline, ai_mention_rate, displacement_ratio, trend_direction.
    """
    try:
        results = layer1.get_vulnerability_scores(
            canonical_role=canonical_role or None,
            city=city or None,
            risk_band=risk_band or None,
            max_score=max_score,
            min_score=min_score,
            limit=limit,
        )
        return json.dumps(results, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to query vulnerability data: {e}"})


@tool
def get_skill_trends(
    skill: str = "",
    city: str = "",
    direction: str = "",
    limit: int = 20,
) -> str:
    """Get skill demand trends from live job-market data.

    Use this tool when the user asks about:
    - Which skills are trending or declining
    - Skill demand in a specific city
    - Week-over-week or month-over-month changes in skill mentions
    - Government training / course availability for a skill

    direction can be: 'rising', 'declining', or 'stable'.
    Returns: mention_count, week_over_week_change, month_over_month_change,
             direction, gov_courses.
    """
    try:
        results = layer1.get_skill_trends(
            skill=skill or None,
            city=city or None,
            direction=direction or None,
            limit=limit,
        )
        return json.dumps(results, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to query skill trends: {e}"})


@tool
def get_watchlist_alerts(
    canonical_role: str = "",
    city: str = "",
    active_only: bool = True,
) -> str:
    """Get watchlist alerts for roles experiencing sustained hiring declines.

    Use this tool when the user asks about:
    - Roles that are declining over multiple months
    - Jobs on a decline watchlist
    - How many workers are affected by a decline in a role/city
    - Severity of hiring decline for specific roles

    Returns: decline_history (monthly decline %), consecutive_decline_months,
             affected_workers, severity.
    """
    try:
        results = layer1.get_watchlist_alerts(
            canonical_role=canonical_role or None,
            city=city or None,
            active_only=active_only,
        )
        return json.dumps(results, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to query watchlist alerts: {e}"})


# ── RAG Course Search Tool ────────────────────────────────────────────────


@tool
def search_courses(query: str) -> str:
    """Search for relevant upskilling courses (NPTEL, SWAYAM, etc.) via semantic search.

    Use this tool ONLY when:
    - The user explicitly asks for course recommendations or learning resources
    - The user asks how to upskill, reskill, or learn something specific
    - The user asks about training paths, certifications, or educational programs
    - You need to suggest specific courses as part of career transition advice

    Do NOT use this tool when:
    - The user asks about job counts, risk scores, or market data
    - The user asks general questions unrelated to learning
    - The query is about understanding their current situation (use Layer-1 tools instead)
    """
    try:
        retriever = get_retriever(k=6)
        docs = retriever.invoke(query)
        if not docs:
            return json.dumps({"message": "No relevant courses found.", "courses": []})

        results = []
        for i, doc in enumerate(docs):
            results.append({
                "course_number": i + 1,
                "content": doc.page_content,
                "title": doc.metadata.get("title", ""),
                "platform": doc.metadata.get("platform", ""),
                "link": doc.metadata.get("link", ""),
                "institute": doc.metadata.get("institute", ""),
            })
        return json.dumps(results, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to search courses: {e}"})


# ── Tool Registry ─────────────────────────────────────────────────────────


def get_all_tools() -> list:
    """Return all tools available to the agent."""
    return [
        search_jobs,
        get_risk_assessment,
        get_skill_trends,
        get_watchlist_alerts,
        search_courses,
    ]
