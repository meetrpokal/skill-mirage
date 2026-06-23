from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models
from app.config import settings
from app.core.embeddings import get_embedding_model


def get_qdrant_client() -> QdrantClient:
    """Returns a Qdrant cloud client."""
    return QdrantClient(
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,
        timeout=60,  # 60s timeout for cloud operations
    )


def _ensure_collection_exists(client: QdrantClient, collection_name: str):
    """Creates the collection if it doesn't exist."""
    if not client.collection_exists(collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(
                size=3072,  # gemini-embedding-001 output dimension
                distance=models.Distance.COSINE,
            ),
        )
        print(f"Created Qdrant collection: {collection_name}")


def get_vector_store() -> QdrantVectorStore:
    """Returns the Qdrant vector store with Gemini embeddings."""
    client = get_qdrant_client()
    _ensure_collection_exists(client, settings.QDRANT_COLLECTION_NAME)
    return QdrantVectorStore(
        client=client,
        collection_name=settings.QDRANT_COLLECTION_NAME,
        embedding=get_embedding_model(),
    )
