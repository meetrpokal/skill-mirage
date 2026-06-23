"""
Document Service — search and retrieval of indexed course documents.
"""

import asyncio
from app.core.rag.retriever import get_retriever


class DocumentService:
    """Direct document search against the Qdrant vector store."""

    async def search(self, query: str, top_k: int = 5) -> list[dict]:
        """Return the top-k most relevant course chunks."""
        retriever = get_retriever(k=top_k)
        docs = await asyncio.to_thread(retriever.invoke, query)
        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
            }
            for doc in docs
        ]
