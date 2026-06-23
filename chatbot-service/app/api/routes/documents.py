"""
Document search API endpoints.
"""

from fastapi import APIRouter, Depends

from app.models.schemas import DocumentSearchRequest, DocumentSearchResponse
from app.api.dependencies import get_document_service
from app.services.document_service import DocumentService

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.post("/search", response_model=DocumentSearchResponse)
async def search_documents(
    request: DocumentSearchRequest,
    service: DocumentService = Depends(get_document_service),
):
    """Semantic search over the indexed course documents."""
    results = await service.search(query=request.query, top_k=request.top_k)
    return DocumentSearchResponse(results=results)
