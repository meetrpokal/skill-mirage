import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_TITLE: str = "RAG Chatbot API"
    APP_DESCRIPTION: str = "A RAG-based chatbot with memory, powered by LangChain & FastAPI"
    APP_VERSION: str = "0.1.0"

    APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT: int = int(os.getenv("APP_PORT", 8000))
    DEBUG: bool = os.getenv("DEBUG", "True").lower() == "true"

    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")

    # Multiple API keys for rotation (comma-separated)
    @property
    def GOOGLE_API_KEYS(self) -> list[str]:
        keys_str = os.getenv("GOOGLE_API_KEYS", "")
        if keys_str:
            return [k.strip() for k in keys_str.split(",") if k.strip()]
        # Fallback to single key
        return [self.GOOGLE_API_KEY] if self.GOOGLE_API_KEY else []

    # Qdrant Cloud
    QDRANT_URL: str = os.getenv("QDRANT_URL", "")
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    QDRANT_COLLECTION_NAME: str = os.getenv("QDRANT_COLLECTION_NAME", "courses")

    # Neo4j Aura (Cloud)
    NEO4J_URI: str = os.getenv("NEO4J_URI", "")
    NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "")
    NEO4J_DATABASE: str = os.getenv("NEO4J_DATABASE", "neo4j")

    # mem0 memory collection (stored in Qdrant, separate from courses)
    MEM0_COLLECTION_NAME: str = os.getenv("MEM0_COLLECTION_NAME", "chat_memories")

    # PostgreSQL (Layer-1 live job-market data — Docker Compose)
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", "5433"))
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "jobmarket")
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "mirage")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "mirage123")

    # Model Settings
    EMBEDDING_MODEL: str = "models/gemini-embedding-001"
    EMBEDDING_DIMS: int = 3072  # gemini-embedding-001 output dimensions
    LLM_MODEL: str = "llama-3.3-70b-versatile"  # Groq-hosted Llama 3.3 70B


settings = Settings()
