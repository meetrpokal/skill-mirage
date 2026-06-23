"""
Chat Service — business logic for chat operations.
"""

import asyncio
from app.core.rag.chain import run_rag_chain, get_memory
from app.models.schemas import UserProfile


class ChatService:
    """Thin wrapper around the agentic RAG chain + mem0 memory."""

    async def chat(self, query: str, user: UserProfile) -> dict:
        """Run the agentic RAG pipeline and return answer + sources + tools_used."""
        return await run_rag_chain(query=query, user=user)

    async def get_memories(self, user_id: str) -> list:
        """Return all stored memories for a user."""
        memory = get_memory()
        if memory is None:
            return []
        result = await asyncio.to_thread(memory.get_all, user_id=user_id)
        if isinstance(result, list):
            return result
        return result.get("results", [])

    async def reset_memory(self, user_id: str) -> None:
        """Delete every memory associated with a user."""
        memory = get_memory()
        if memory is None:
            return
        await asyncio.to_thread(memory.delete_all, user_id=user_id)
