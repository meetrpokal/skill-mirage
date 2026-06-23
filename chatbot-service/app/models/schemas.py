"""
Pydantic request / response models for the API.
"""

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# User Profile (sent by the frontend with every request)
# ---------------------------------------------------------------------------

class UserProfile(BaseModel):
    """Full user context — populated from the Layer-2 frontend."""
    username: str = Field(default="User", description="Display name")
    user_id: str = Field(default="default_user", description="Unique identifier")
    current_job: str = Field(default="", description="Current job title / canonical role")
    city: str = Field(default="", description="User's city")
    yoe: int = Field(default=0, ge=0, description="Years of experience")
    language: str = Field(
        default="english",
        description="Preferred response language (e.g. english, hindi)",
    )
    ai_vulnerability_index: float = Field(
        default=0.0, ge=0, le=100,
        description="User's AI vulnerability score (0-100) from Layer-2",
    )
    short_writeup: str = Field(
        default="",
        description="Short self-description including skills, background, goals",
    )


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, description="User's question or message")
    user: UserProfile = Field(
        default_factory=UserProfile,
        description="Full user context from the frontend",
    )


class CourseSource(BaseModel):
    title: str
    platform: Optional[str] = ""
    link: Optional[str] = ""
    institute: Optional[str] = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[CourseSource] = []
    tools_used: list[str] = Field(
        default=[],
        description="Names of tools the agent invoked to answer this query",
    )


# ---------------------------------------------------------------------------
# Plan Generation (dedicated endpoint)
# ---------------------------------------------------------------------------

class PlanRequest(BaseModel):
    user: UserProfile
    preferences: str = Field(
        default="",
        description="Optional: target role, time constraints, etc.",
    )


class PlanResponse(BaseModel):
    plan: str = Field(..., description="The personalised upskilling plan (Markdown)")
    recommended_courses: list[CourseSource] = []
    risk_analysis: dict = Field(
        default={},
        description="Summary risk metrics for the user's current role/city",
    )


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

class MemoryResponse(BaseModel):
    memories: list[dict] = []


# ---------------------------------------------------------------------------
# Document search
# ---------------------------------------------------------------------------

class DocumentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Search query")
    top_k: int = Field(default=5, ge=1, le=20, description="Number of results")


class DocumentSearchResponse(BaseModel):
    results: list[dict] = []
