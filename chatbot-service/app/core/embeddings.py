from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.embeddings import Embeddings
from app.config import settings


class RotatingKeyEmbeddings(Embeddings):
    """
    Wraps multiple Gemini API keys and rotates to the next one
    when the current key hits a rate limit or daily quota.
    """

    def __init__(self, api_keys: list[str], model: str):
        self.api_keys = api_keys
        self.model = model
        self.current_index = 0
        self._models = [
            GoogleGenerativeAIEmbeddings(model=model, google_api_key=key)
            for key in api_keys
        ]
        print(f"Initialized {len(self._models)} API key(s) for embedding rotation")

    def _get_current(self) -> GoogleGenerativeAIEmbeddings:
        return self._models[self.current_index]

    def _rotate(self):
        old = self.current_index
        self.current_index = (self.current_index + 1) % len(self._models)
        print(f"  Rotating API key: {old + 1} -> {self.current_index + 1}")
        if self.current_index == 0:
            raise RuntimeError("All API keys exhausted. Wait for quota reset or add more keys.")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        start_index = self.current_index
        while True:
            try:
                return self._get_current().embed_documents(texts)
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    self._rotate()
                    if self.current_index == start_index:
                        raise RuntimeError("All API keys exhausted.") from e
                else:
                    raise

    def embed_query(self, text: str) -> list[float]:
        start_index = self.current_index
        while True:
            try:
                return self._get_current().embed_query(text)
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    self._rotate()
                    if self.current_index == start_index:
                        raise RuntimeError("All API keys exhausted.") from e
                else:
                    raise


def get_embedding_model() -> Embeddings:
    """Returns the embedding model — rotating if multiple keys, single otherwise."""
    keys = settings.GOOGLE_API_KEYS
    if len(keys) > 1:
        return RotatingKeyEmbeddings(api_keys=keys, model=settings.EMBEDDING_MODEL)
    return GoogleGenerativeAIEmbeddings(
        model=settings.EMBEDDING_MODEL,
        google_api_key=keys[0] if keys else settings.GOOGLE_API_KEY,
    )
