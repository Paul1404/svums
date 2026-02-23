from datetime import datetime

from pydantic import BaseModel


class CancellationLetterResponse(BaseModel):
    id: int
    anrede: str
    vorname: str
    nachname: str
    strasse: str
    plz: str
    ort: str
    geburtsdatum: str
    mitgliedsnummer: str | None = None
    abteilung: str | None = None
    austritt_datum: str
    signature_source: str
    filename: str
    created_at: datetime

    model_config = {"from_attributes": True}
