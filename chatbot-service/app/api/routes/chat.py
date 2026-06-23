"""
Chat & Plan API endpoints.
"""

import logging
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.models.schemas import (
    ChatRequest, ChatResponse, MemoryResponse,
    PlanRequest, PlanResponse,
)
from app.api.dependencies import get_chat_service, get_plan_service
from app.services.chat_service import ChatService
from app.services.plan_service import PlanService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post("/", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
):
    """Send a message and get an intelligent, context-aware response."""
    try:
        result = await service.chat(query=request.query, user=request.user)
        return ChatResponse(**result)
    except Exception as e:
        logger.exception("Chat endpoint error")
        return JSONResponse(
            status_code=200,
            content={"answer": "I'm having trouble processing that right now. Please try again.", "sources": [], "tools_used": []},
        )


@router.post("/plan", response_model=PlanResponse)
async def generate_plan(
    request: PlanRequest,
    service: PlanService = Depends(get_plan_service),
):
    """Generate a personalised upskilling plan."""
    try:
        result = await service.generate_plan(
            user=request.user, preferences=request.preferences
        )
        return PlanResponse(**result)
    except Exception as e:
        logger.exception("Plan endpoint error")
        return JSONResponse(
            status_code=200,
            content={"plan": "Unable to generate plan right now. Please try again.", "risk_analysis": {}, "recommended_courses": []},
        )


@router.get("/memories/{user_id}", response_model=MemoryResponse)
async def get_memories(
    user_id: str,
    service: ChatService = Depends(get_chat_service),
):
    """Retrieve all stored memories for a given user."""
    memories = await service.get_memories(user_id=user_id)
    return MemoryResponse(memories=memories)


@router.delete("/memories/{user_id}")
async def reset_memory(
    user_id: str,
    service: ChatService = Depends(get_chat_service),
):
    """Delete all memories for a given user."""
    await service.reset_memory(user_id=user_id)
    return {"message": f"Memory reset for user '{user_id}'"}
