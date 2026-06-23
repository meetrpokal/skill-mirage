"""
LangGraph Agentic Workflow
--------------------------
An intelligent ReAct agent that decides at runtime which tools to invoke
(Layer-1 PostgreSQL data and/or Qdrant RAG course search) based on what the
user is actually asking.

Uses langgraph-prebuilt's `create_react_agent` for a standard tool-calling loop.
Falls back to a plain LLM response if tool calling fails (e.g. Groq model
generates malformed tool calls).
"""

import json
import logging
from typing import Any

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langgraph.prebuilt import create_react_agent
from groq import RateLimitError

from app.config import settings
from app.core.rag.tools import get_all_tools
from app.core.rag.prompts import build_agent_system_prompt
from app.models.schemas import UserProfile

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
FALLBACK_MODEL = "llama-3.1-8b-instant"


def _get_llm() -> ChatGroq:
    """Return a Groq-hosted chat model with tool-calling support."""
    return ChatGroq(
        model=settings.LLM_MODEL,
        api_key=settings.GROQ_API_KEY,
        temperature=0.3,
    )


async def _fallback_response(query: str, system_prompt: str) -> dict:
    """Plain LLM call without tools — used when the agent loop fails."""
    llm = _get_llm()
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=query)]
    try:
        response = await llm.ainvoke(messages)
    except RateLimitError:
        logger.warning("Primary model rate-limited in fallback, trying %s", FALLBACK_MODEL)
        fallback_llm = ChatGroq(
            model=FALLBACK_MODEL,
            api_key=settings.GROQ_API_KEY,
            temperature=0.3,
        )
        response = await fallback_llm.ainvoke(messages)
    return {
        "answer": response.content,
        "sources": [],
        "tools_used": [],
    }


def _extract_results(messages: list) -> dict:
    """Pull answer, sources, and tool names from an agent message history."""
    tools_used: set[str] = set()
    for msg in messages:
        if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
            for tc in msg.tool_calls:
                tools_used.add(tc["name"])

    final_answer = ""
    for msg in reversed(messages):
        if (
            isinstance(msg, AIMessage)
            and msg.content
            and not getattr(msg, "tool_calls", None)
        ):
            final_answer = msg.content
            break

    sources: list[dict] = []
    seen_titles: set[str] = set()
    for msg in messages:
        if isinstance(msg, ToolMessage) and msg.name == "search_courses":
            try:
                courses = json.loads(msg.content)
                if isinstance(courses, dict):
                    courses = courses.get("courses", [])
                for c in courses:
                    if isinstance(c, dict):
                        title = c.get("title", "")
                        if title and title not in seen_titles:
                            seen_titles.add(title)
                            sources.append({
                                "title": title,
                                "platform": c.get("platform", ""),
                                "link": c.get("link", ""),
                                "institute": c.get("institute", ""),
                            })
            except (json.JSONDecodeError, TypeError):
                pass

    return {
        "answer": final_answer,
        "sources": sources,
        "tools_used": list(tools_used),
    }


async def run_agent(query: str, user: UserProfile, memory_context: str = "") -> dict:
    """
    Run the LangGraph agentic workflow with retry + fallback.

    Retries the agent loop up to MAX_RETRIES times if the LLM produces
    malformed tool calls (common with some Groq-hosted models). If all
    retries fail, falls back to a plain LLM response without tools.
    """
    system_prompt = build_agent_system_prompt(user, memory_context)

    llm = _get_llm()
    tools = get_all_tools()

    agent = create_react_agent(
        model=llm,
        tools=tools,
        prompt=system_prompt,
    )

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            result = await agent.ainvoke(
                {"messages": [HumanMessage(content=query)]}
            )
            return _extract_results(result["messages"])
        except Exception as e:
            last_err = e
            logger.warning("Agent attempt %d failed: %s", attempt + 1, e)

    # All retries exhausted — fall back to plain LLM (no tools)
    logger.warning("Agent failed after %d retries, falling back to plain LLM: %s", MAX_RETRIES, last_err)
    return await _fallback_response(query, system_prompt)
