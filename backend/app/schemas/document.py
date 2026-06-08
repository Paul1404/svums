from datetime import datetime

from pydantic import BaseModel


class GeneratedDocumentResponse(BaseModel):
    id: int
    document_id: str
    doc_type: str
    doc_type_label: str
    application_id: int | None = None
    cancellation_letter_id: int | None = None
    recipient_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
