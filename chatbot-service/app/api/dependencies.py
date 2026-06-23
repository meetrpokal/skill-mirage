"""
FastAPI dependency injection — singleton services.
"""

from app.services.chat_service import ChatService
from app.services.document_service import DocumentService
from app.services.plan_service import PlanService

_chat_service: ChatService | None = None
_document_service: DocumentService | None = None
_plan_service: PlanService | None = None


def get_chat_service() -> ChatService:
    global _chat_service
    if _chat_service is None:
        _chat_service = ChatService()
    return _chat_service


def get_document_service() -> DocumentService:
    global _document_service
    if _document_service is None:
        _document_service = DocumentService()
    return _document_service


def get_plan_service() -> PlanService:
    global _plan_service
    if _plan_service is None:
        _plan_service = PlanService()
    return _plan_service
