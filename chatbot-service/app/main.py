from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes.chat import router as chat_router
from app.api.routes.documents import router as documents_router


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_TITLE,
        description=settings.APP_DESCRIPTION,
        version=settings.APP_VERSION,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", tags=["Health"])
    async def root():
        return {"message": "RAG Chatbot API is running"}

    @app.get("/health", tags=["Health"])
    async def health_check():
        return {"status": "healthy"}

    # Register API routers
    app.include_router(chat_router, prefix="/api")
    app.include_router(documents_router, prefix="/api")

    return app


app = create_app()
