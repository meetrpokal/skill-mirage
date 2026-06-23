"""
Document retriever backed by the Qdrant vector store.
"""

from langchain_core.vectorstores import VectorStoreRetriever
from app.core.vectorstore import get_vector_store

# Module-level cache so we reuse the same Qdrant connection
_vector_store = None


def get_retriever(k: int = 6) -> VectorStoreRetriever:
    """
    Return a LangChain retriever that fetches the top-k most
    relevant course documents from Qdrant.
    """
    global _vector_store
    if _vector_store is None:
        _vector_store = get_vector_store()
    return _vector_store.as_retriever(search_kwargs={"k": k})
