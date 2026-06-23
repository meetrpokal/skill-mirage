"""
Plan Service — generates a personalised upskilling plan.

This is a DEDICATED endpoint (separate from the chat agent) that:
  1. Fetches the user's risk data, skill trends, and watchlist from Layer-1
  2. Retrieves relevant courses via Qdrant RAG
  3. Calls the LLM with a specialised plan-generation prompt
  4. Returns a structured plan with recommended courses and risk analysis
"""

import asyncio
import json
import logging
from typing import Any

from langchain_groq import ChatGroq
from langchain_core.output_parsers import StrOutputParser
from groq import RateLimitError

from app.config import settings
from app.core import layer1
from app.core.rag.retriever import get_retriever
from app.core.rag.prompts import PLAN_PROMPT
from app.models.schemas import UserProfile

logger = logging.getLogger(__name__)

FALLBACK_MODEL = "llama-3.1-8b-instant"


class PlanService:
    """Generates personalised upskilling plans from live market data + courses."""

    def __init__(self):
        self.llm = ChatGroq(
            model=settings.LLM_MODEL,
            api_key=settings.GROQ_API_KEY,
            temperature=0.3,
        )

    async def generate_plan(self, user: UserProfile, preferences: str = "") -> dict:
        """
        Generate a personalised upskilling plan.

        Parameters
        ----------
        user : UserProfile
            Full user context from the frontend.
        preferences : str
            Optional free-text preferences (e.g. "I want to transition to
            data science", "courses under 3 months").

        Returns
        -------
        dict  {"plan": str, "recommended_courses": list, "risk_analysis": dict}
        """

        # ── 1. Parallel data fetch ───────────────────────────────────
        vuln_future = asyncio.to_thread(
            layer1.get_vulnerability_scores,
            canonical_role=user.current_job or None,
            city=user.city or None,
            limit=5,
        )
        trends_future = asyncio.to_thread(
            layer1.get_skill_trends,
            city=user.city or None,
            direction="rising",
            limit=15,
        )
        watchlist_future = asyncio.to_thread(
            layer1.get_watchlist_alerts,
            canonical_role=user.current_job or None,
            city=user.city or None,
        )
        safe_roles_future = asyncio.to_thread(
            layer1.get_vulnerability_scores,
            city=user.city or None,
            max_score=40,
            limit=10,
        )

        # Course search query built from user context
        course_query = " ".join(filter(None, [
            user.current_job,
            user.short_writeup,
            preferences,
            "upskilling career transition",
        ]))
        retriever = get_retriever(k=8)
        courses_future = asyncio.to_thread(retriever.invoke, course_query)

        vuln_data, skill_trends, watchlist, safe_roles, courses = (
            await asyncio.gather(
                vuln_future,
                trends_future,
                watchlist_future,
                safe_roles_future,
                courses_future,
            )
        )

        # ── 2. Format data for the prompt ────────────────────────────
        vulnerability_str = (
            json.dumps(vuln_data, default=str)
            if vuln_data
            else "No vulnerability data available for this role/city."
        )
        trends_str = (
            json.dumps(skill_trends, default=str)
            if skill_trends
            else "No skill trend data available."
        )
        watchlist_str = (
            json.dumps(watchlist, default=str)
            if watchlist
            else "No watchlist alerts for this role/city."
        )
        safe_roles_str = (
            json.dumps(safe_roles, default=str)
            if safe_roles
            else "No safe-role data available."
        )
        courses_str = (
            "\n".join(f"- {doc.page_content}" for doc in courses)
            if courses
            else "No relevant courses found."
        )

        # ── 3. LLM call (with fallback model on rate-limit) ──────
        prompt_vars = {
            "username": user.username,
            "current_job": user.current_job,
            "city": user.city,
            "yoe": user.yoe,
            "ai_vulnerability_index": user.ai_vulnerability_index,
            "short_writeup": user.short_writeup,
            "language": user.language,
            "preferences": preferences or "No specific preferences provided.",
            "vulnerability_data": vulnerability_str,
            "skill_trends": trends_str,
            "watchlist_data": watchlist_str,
            "safe_roles": safe_roles_str,
            "courses_data": courses_str,
        }

        chain = PLAN_PROMPT | self.llm | StrOutputParser()
        try:
            plan = await chain.ainvoke(prompt_vars)
        except RateLimitError:
            logger.warning("Primary model rate-limited, falling back to %s", FALLBACK_MODEL)
            fallback_llm = ChatGroq(
                model=FALLBACK_MODEL,
                api_key=settings.GROQ_API_KEY,
                temperature=0.3,
            )
            chain = PLAN_PROMPT | fallback_llm | StrOutputParser()
            plan = await chain.ainvoke(prompt_vars)

        # ── 4. Structure the response ────────────────────────────────
        recommended_courses: list[dict] = []
        seen: set[str] = set()
        for doc in courses:
            title = doc.metadata.get("title", "")
            if title and title not in seen:
                seen.add(title)
                recommended_courses.append({
                    "title": title,
                    "platform": doc.metadata.get("platform", ""),
                    "link": doc.metadata.get("link", ""),
                    "institute": doc.metadata.get("institute", ""),
                })

        risk_analysis: dict = {}
        if vuln_data and isinstance(vuln_data, list) and vuln_data:
            top = vuln_data[0]
            risk_analysis = {
                "score": top.get("score"),
                "risk_band": top.get("risk_band"),
                "hiring_decline": top.get("hiring_decline"),
                "ai_mention_rate": top.get("ai_mention_rate"),
                "displacement_ratio": top.get("displacement_ratio"),
                "trend_direction": top.get("trend_direction"),
            }

        return {
            "plan": plan,
            "recommended_courses": recommended_courses,
            "risk_analysis": risk_analysis,
        }
