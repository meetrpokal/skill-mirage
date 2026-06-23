"""
RAG Chain
---------
Orchestrates the agentic RAG pipeline:
  query → retrieve memories (mem0 + neo4j) → run LangGraph agent
  (with Layer-1 DB tools + RAG course search) → store memories → return
"""

import asyncio
import concurrent.futures
from typing import Any

from mem0 import Memory

from app.config import settings
from app.core.rag.agent import run_agent
from app.models.schemas import UserProfile

# Timeout (seconds) for mem0 initialisation.  If it exceeds this the
# chatbot still works — it just won't have conversation memory.
_MEM0_INIT_TIMEOUT = 90   # Qdrant + Gemini cold-start can be slow
_MEM0_OP_TIMEOUT = 30     # per search / store operation


# ---------------------------------------------------------------------------
# mem0 configuration (Qdrant cloud for vector memory)
# ---------------------------------------------------------------------------

def _build_mem0_config() -> dict:
    """Build the mem0 config dict.

    NOTE: graph_store (Neo4j) is intentionally excluded because mem0's
    internal langchain_neo4j.Neo4jGraph initialization hangs on certain
    Neo4j Aura free-tier instances.  Vector-based memory via Qdrant is
    sufficient for conversation context and works reliably.
    """
    return {
        "llm": {
            "provider": "groq",
            "config": {
                "model": settings.LLM_MODEL,
                "api_key": settings.GROQ_API_KEY,
                "temperature": 0.1,
                "max_tokens": 2000,
            },
        },
        "embedder": {
            "provider": "gemini",
            "config": {
                "model": settings.EMBEDDING_MODEL,
                "api_key": settings.GOOGLE_API_KEY,
                "embedding_dims": settings.EMBEDDING_DIMS,
            },
        },
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": settings.MEM0_COLLECTION_NAME,
                "url": settings.QDRANT_URL,
                "api_key": settings.QDRANT_API_KEY,
                "embedding_model_dims": settings.EMBEDDING_DIMS,
            },
        },
        "version": "v1.1",
    }


# ---------------------------------------------------------------------------
# Singletons (lazy-initialised)
# ---------------------------------------------------------------------------

_memory: Memory | None = None
_memory_failed: bool = False  # sticky flag — don't retry if init already failed


def get_memory() -> Memory | None:
    """Return (or create) the global mem0 Memory instance.

    Uses a thread-pool timeout so a hanging Neo4j / Qdrant connection
    can never block the API.  Returns None on failure so the RAG chain
    can still answer without memory context.
    """
    global _memory, _memory_failed
    if _memory is not None:
        return _memory
    if _memory_failed:
        return None

    def _init():
        return Memory.from_config(_build_mem0_config())

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_init)
            _memory = future.result(timeout=_MEM0_INIT_TIMEOUT)
            print("[mem0] Memory backend initialised successfully.")
    except concurrent.futures.TimeoutError:
        print(
            f"[mem0] Initialisation timed out after {_MEM0_INIT_TIMEOUT}s — "
            "continuing without conversation memory."
        )
        _memory_failed = True
        return None
    except Exception as exc:
        print(f"[mem0] Failed to initialise memory backend: {exc}")
        _memory_failed = True
        return None
    return _memory


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_memories(memories: Any) -> str:
    """Normalise mem0 search results into a readable string."""
    if not memories:
        return "No previous conversation context available."

    # mem0 may return a list or a dict with a "results" key
    results = memories if isinstance(memories, list) else memories.get("results", [])
    if not results:
        return "No previous conversation context available."

    lines = [f"- {m.get('memory', '')}" for m in results if m.get("memory")]
    return "\n".join(lines) if lines else "No previous conversation context available."


# Keep references to fire-and-forget tasks so they aren't GC'd
_background_tasks: set = set()


async def _store_memory_bg(memory: Memory, messages: list[dict], user_id: str):
    """Store conversation in mem0 without blocking the response."""
    try:
        await asyncio.wait_for(
            asyncio.to_thread(memory.add, messages, user_id=user_id),
            timeout=_MEM0_OP_TIMEOUT,
        )
    except asyncio.TimeoutError:
        print(f"[mem0] Store timed out for {user_id} — skipping.")
    except Exception as exc:
        # Non-critical — log and move on
        print(f"[mem0] Failed to store memory for {user_id}: {exc}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def _safe_memory_search(memory: Memory, query: str, user_id: str) -> Any:
    """Search mem0 with graceful degradation on rate-limit / timeout / errors."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(memory.search, query=query, user_id=user_id, limit=5),
            timeout=_MEM0_OP_TIMEOUT,
        )
    except asyncio.TimeoutError:
        print(f"[mem0] Search timed out — proceeding without memory context.")
        return []
    except Exception as e:
        err = str(e).lower()
        if "429" in err or "resource_exhausted" in err:
            print(f"[mem0] Rate-limited during search — proceeding without memory context.")
        else:
            print(f"[mem0] Search failed: {e}")
        return []


async def run_rag_chain(query: str, user: UserProfile) -> dict:
    """
    Execute the agentic RAG pipeline:
      1. Fetch past memories from mem0
      2. Run LangGraph agent (decides which tools to call)
      3. Fire-and-forget memory storage
      4. Return answer + sources + tools_used
    """
    memory = get_memory()
    user_id = user.user_id

    # 1. Retrieve conversation memory
    memory_context = "No previous conversation context available."
    if memory is not None:
        memories = await _safe_memory_search(memory, query, user_id)
        memory_context = _format_memories(memories)

    # 2. Run the LangGraph agent with tools
    result = await run_agent(query=query, user=user, memory_context=memory_context)

    # 3. Store this exchange in mem0 (non-blocking)
    if memory is not None:
        messages = [
            {"role": "user", "content": query},
            {"role": "assistant", "content": result["answer"]},
        ]
        task = asyncio.create_task(_store_memory_bg(memory, messages, user_id))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    return result
