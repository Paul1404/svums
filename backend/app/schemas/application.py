from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator


VALID_ABTEILUNGEN = [
    "Fußball",
    "Gymnastik",
    "Combo",
    "Kinderturnen",
    "Korbball",
    "Tischtennis",
    "Yoga",
    "Dart",
    "Lauftreff",
    "PingPongParkinson",
    "Keine Abteilung",
]

VALID_MITGLIEDSCHAFT_TYPEN = [
    "kind",
    "jugendlich",
    "junger_erwachsener",
    "erwachsener",
    "familie",
]

VALID_ANTRAGSTYPEN = ["einzel", "kind", "familie"]

VALID_STATUS = ["neu", "dokument_hochgeladen", "in_bearbeitung", "genehmigt", "abgelehnt"]


class ChildData(BaseModel):
    vorname: str
    nachname: str
    geburtsdatum: date
    abteilungen: list[str]

    @field_validator("vorname", "nachname")
    @classmethod
    def validate_child_names(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Mindestens 2 Zeichen erforderlich")
        return v.strip()

    @field_validator("geburtsdatum")
    @classmethod
    def validate_child_dob(cls, v):
        from app.services.fees import calculate_age
        today = date.today()
        if v >= today:
            raise ValueError("Geburtsdatum muss in der Vergangenheit liegen")
        age = calculate_age(v)  # uses Stichtag (Jan 1st)
        if age > 18:
            raise ValueError("Kind muss 18 Jahre oder jünger sein (Stichtag 1. Januar)")
        return v

    @field_validator("abteilungen")
    @classmethod
    def validate_child_abteilungen(cls, v):
        for abt in v:
            if abt not in VALID_ABTEILUNGEN:
                raise ValueError(f"Ungültige Abteilung: {abt}")
        if len(v) == 0:
            raise ValueError("Mindestens eine Abteilung muss ausgewählt werden")
        return v


VALID_GESCHLECHT = ["Herr", "Frau", "keine Angabe"]


class ApplicationCreate(BaseModel):
    antragstyp: str = "einzel"
    geschlecht: Optional[str] = None
    vorname: str
    nachname: str
    geburtsdatum: date
    strasse: str
    plz: str
    ort: str
    telefon: Optional[str] = None
    email: EmailStr
    abteilungen: list[str]
    mitgliedschaft_typ: str
    elternteil_mitglied: Optional[bool] = None
    # Guardian for Kind type
    erziehungsberechtigter_vorname: Optional[str] = None
    erziehungsberechtigter_nachname: Optional[str] = None
    # Partner / second parent for Familie type
    partner_vorname: Optional[str] = None
    partner_nachname: Optional[str] = None
    partner_geburtsdatum: Optional[date] = None
    partner_abteilungen: Optional[list[str]] = None
    # Children for Familie type
    kinder: Optional[list[ChildData]] = None
    # SEPA
    kontoinhaber: Optional[str] = None
    iban: str
    bic: Optional[str] = None
    kreditinstitut: Optional[str] = None
    # Optional inline signature (base64 data-URL PNG) – Option B flow
    unterschrift_base64: Optional[str] = None

    @field_validator("partner_geburtsdatum", mode="before")
    @classmethod
    def coerce_empty_date(cls, v):
        """Convert empty strings to None so Pydantic does not try to parse '' as a date."""
        if v == "" or v is None:
            return None
        return v

    @field_validator("antragstyp")
    @classmethod
    def validate_antragstyp(cls, v):
        if v not in VALID_ANTRAGSTYPEN:
            raise ValueError(f"Ungültiger Antragstyp: {v}")
        return v

    @field_validator("geschlecht")
    @classmethod
    def validate_geschlecht(cls, v):
        if v is not None and v not in VALID_GESCHLECHT:
            raise ValueError(f"Ungültige Anrede: {v}. Erlaubt: Herr, Frau, keine Angabe")
        return v

    @field_validator("abteilungen")
    @classmethod
    def validate_abteilungen(cls, v):
        for abt in v:
            if abt not in VALID_ABTEILUNGEN:
                raise ValueError(f"Ungültige Abteilung: {abt}")
        if len(v) == 0:
            raise ValueError("Mindestens eine Abteilung muss ausgewählt werden")
        return v

    @field_validator("mitgliedschaft_typ")
    @classmethod
    def validate_mitgliedschaft_typ(cls, v):
        if v not in VALID_MITGLIEDSCHAFT_TYPEN:
            raise ValueError(f"Ungültiger Mitgliedschaftstyp: {v}")
        return v

    @field_validator("plz")
    @classmethod
    def validate_plz(cls, v):
        if not v.isdigit() or len(v) != 5:
            raise ValueError("PLZ muss 5 Ziffern haben")
        return v

    @field_validator("vorname", "nachname")
    @classmethod
    def validate_names(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Mindestens 2 Zeichen erforderlich")
        return v.strip()

    @field_validator("geburtsdatum")
    @classmethod
    def validate_geburtsdatum(cls, v):
        today = date.today()
        if v >= today:
            raise ValueError("Geburtsdatum muss in der Vergangenheit liegen")
        if (today - v).days > 120 * 365:
            raise ValueError("Ungültiges Geburtsdatum")
        return v

    @field_validator("strasse")
    @classmethod
    def validate_strasse(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Bitte vollständige Straße und Hausnummer angeben")
        return v.strip()

    @field_validator("ort")
    @classmethod
    def validate_ort(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Mindestens 2 Zeichen erforderlich")
        return v.strip()

    @field_validator("telefon")
    @classmethod
    def validate_telefon(cls, v):
        if v and v.strip():
            import re
            cleaned = re.sub(r'[\s\-/()]', '', v)
            if not re.match(r'^\+?\d{6,15}$', cleaned):
                raise ValueError("Ungültige Telefonnummer")
        return v

    @field_validator("iban")
    @classmethod
    def validate_iban(cls, v):
        cleaned = v.replace(" ", "").upper()
        if len(cleaned) < 15 or len(cleaned) > 34:
            raise ValueError("IBAN muss zwischen 15 und 34 Zeichen lang sein")
        if not cleaned[:2].isalpha() or not cleaned[2:4].isdigit():
            raise ValueError("Ungültiges IBAN-Format")
        rearranged = cleaned[4:] + cleaned[:4]
        num_str = ""
        for ch in rearranged:
            num_str += str(ord(ch) - ord("A") + 10) if ch.isalpha() else ch
        if int(num_str) % 97 != 1:
            raise ValueError("IBAN-Prüfsumme ist ungültig")
        return cleaned

    @field_validator("bic")
    @classmethod
    def validate_bic(cls, v):
        if v and v.strip():
            import re
            if not re.match(r'^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$', v.strip().upper()):
                raise ValueError("Ungültiges BIC-Format (8 oder 11 Zeichen)")
            return v.strip().upper()
        return v

    @model_validator(mode="after")
    def validate_type_specific(self):
        from app.services.fees import calculate_real_age

        if self.antragstyp == "kind":
            if not self.erziehungsberechtigter_vorname or not self.erziehungsberechtigter_nachname:
                raise ValueError("Erziehungsberechtigter ist bei Kind-Antrag erforderlich")
            # Kind must be under 18
            age = calculate_real_age(self.geburtsdatum)
            if age >= 18:
                raise ValueError("Kind/Jugendliche-Antrag: das Kind muss unter 18 Jahre alt sein")

        if self.antragstyp == "einzel":
            # Einzel must be at least 14
            age = calculate_real_age(self.geburtsdatum)
            if age < 14:
                raise ValueError("Einzel-Antrag: Antragsteller muss mindestens 14 Jahre alt sein")

        if self.antragstyp == "familie":
            if not self.kinder or len(self.kinder) == 0:
                raise ValueError("Bei Familienmitgliedschaft muss mindestens ein Kind angegeben werden")
            # Parent must be at least 18
            age = calculate_real_age(self.geburtsdatum)
            if age < 18:
                raise ValueError("Familien-Antrag: Antragsteller/Elternteil muss mindestens 18 Jahre alt sein")
            # Partner is REQUIRED for Familienmitgliedschaft (2 adults + children)
            if not self.partner_vorname or not self.partner_nachname:
                raise ValueError(
                    "Bei Familienmitgliedschaft ist ein Partner/2. Elternteil "
                    "(Vorname und Nachname) erforderlich"
                )
            if not self.partner_geburtsdatum:
                raise ValueError("Geburtsdatum des Partners ist erforderlich")
            partner_age = calculate_real_age(self.partner_geburtsdatum)
            if partner_age < 18:
                raise ValueError("Partner muss mindestens 18 Jahre alt sein")
            if self.partner_abteilungen:
                for abt in self.partner_abteilungen:
                    if abt not in VALID_ABTEILUNGEN:
                        raise ValueError(f"Ungültige Abteilung für Partner: {abt}")

        return self


class ApplicationResponse(BaseModel):
    id: int
    antragsnummer: Optional[str] = None
    antragstyp: Optional[str] = "einzel"
    geschlecht: Optional[str] = None
    vorname: str
    nachname: str
    geburtsdatum: date
    strasse: str
    plz: str
    ort: str
    telefon: Optional[str]
    email: str
    erziehungsberechtigter_vorname: Optional[str] = None
    erziehungsberechtigter_nachname: Optional[str] = None
    partner_vorname: Optional[str] = None
    partner_nachname: Optional[str] = None
    partner_geburtsdatum: Optional[date] = None
    partner_abteilungen: Optional[list[str]] = None
    kinder: Optional[list[dict]] = None
    abteilungen: list[str]
    mitgliedschaft_typ: str
    elternteil_mitglied: Optional[bool]
    jahresbeitrag: Decimal
    kontoinhaber: Optional[str]
    iban: str
    bic: Optional[str]
    kreditinstitut: Optional[str]
    mandatsreferenz: Optional[str] = None
    status: str
    notes: Optional[str]
    email_sent: bool
    uploaded_file: Optional[str] = None
    uploaded_at: Optional[datetime] = None
    admin_decline_reason: Optional[str] = None
    admin_approved_file: Optional[str] = None
    consent_at: Optional[datetime] = None
    created_at: datetime

    @field_validator("iban", mode="before")
    @classmethod
    def decrypt_iban_field(cls, v):
        if isinstance(v, str) and v.startswith("enc:"):
            from app.services.crypto import decrypt_iban_safe
            return decrypt_iban_safe(v)
        return v

    @field_validator("abteilungen", mode="before")
    @classmethod
    def parse_abteilungen(cls, v):
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v

    @field_validator("kinder", mode="before")
    @classmethod
    def parse_kinder(cls, v):
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v

    @field_validator("partner_abteilungen", mode="before")
    @classmethod
    def parse_partner_abteilungen(cls, v):
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v

    model_config = {"from_attributes": True}


class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    admin_unterschrift_base64: Optional[str] = None
    use_saved_admin_signature: bool = True
    admin_decline_reason: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in VALID_STATUS:
            raise ValueError(f"Ungültiger Status: {v}")
        return v

    @model_validator(mode="after")
    def validate_approval_denial(self):
        if self.status == "genehmigt":
            if not self.admin_unterschrift_base64 and not self.use_saved_admin_signature:
                raise ValueError(
                    "Bei Genehmigung ist eine Signatur erforderlich "
                    "(zeichnen, hochladen oder gespeicherte Admin-Signatur verwenden)"
                )
        if self.status == "abgelehnt":
            if not self.admin_decline_reason or not str(self.admin_decline_reason).strip():
                raise ValueError(
                    "Bei Ablehnung ist eine Begründung erforderlich "
                    "(wird dem Antragsteller mitgeteilt)"
                )
        return self


class ApplicationListResponse(BaseModel):
    items: list[ApplicationResponse]
    total: int
    page: int
    per_page: int


class FeeCalculationRequest(BaseModel):
    geburtsdatum: date
    mitgliedschaft_typ: str
    elternteil_mitglied: Optional[bool] = None


class FeeCalculationResponse(BaseModel):
    jahresbeitrag: Decimal
    mitgliedschaft_typ: str
    label: str


class ApplicationSubmitResponse(BaseModel):
    id: int
    antragsnummer: str
    mandatsreferenz: str
    upload_url: str
    message: str
