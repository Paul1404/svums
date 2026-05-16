from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class LwImportBatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str | None
    imported_at: datetime
    file_size_bytes: int | None
    members_count: int
    contracts_count: int
    fee_types_count: int
    sepa_count: int
    skipped_tables: str | None
    notes: str | None


class LwImportResult(BaseModel):
    batch: LwImportBatchResponse
    inserted_members: int
    inserted_contracts: int
    inserted_fee_types: int
    inserted_sepa: int
    parsed_tables: list[str]
    skipped_tables: list[str]


class LwMemberSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    adr_nr: int
    mitgliedsnummer: str | None
    anrede: str | None
    vorname: str | None
    nachname: str | None
    geburtsdatum: date | None
    plz: str | None
    ort: str | None
    eintritt: date | None
    austritt: date | None
    verstorben_am: date | None
    aktiv: str | None
    geloscht: bool | None
    email: str | None


class LwMemberListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[LwMemberSummary]


class LwContractResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    adr_nr: int
    vertrag_nr: str | None
    art: int | None
    art_name: str | None
    mitglied_nr: str | None
    sollstellung: str | None
    vertrag_begin: date | None
    vertrag_ende: date | None
    betrag: float | None
    gekuend_am: date | None
    gekuend_zum: date | None


class LwSepaMandateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    adr_nr: int
    mandats_nr: str | None
    lastschriftart: str | None
    status: str | None
    angelegt_am: date | None
    gueltig_ab: date | None
    gueltig_bis: date | None
    unterschrift_datum: date | None
    erste_verwendung: date | None
    letzte_verwendung: date | None
    widerrufen_am: date | None
    is_deleted: bool | None


class LwFeeTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    art: int
    bezeichnung: str | None
    sollstellung: str | None
    betrag: float | None
    fibukonto: int | None
    nicht_aktiv: bool | None


class LwMemberDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    adr_nr: int
    mitgliedsnummer: str | None
    anrede: str | None
    titel: str | None
    vorname: str | None
    nachname: str | None
    geborene: str | None
    geburtsdatum: date | None
    geburtsort: str | None
    strasse: str | None
    hausnummer: str | None
    plz: str | None
    ort: str | None
    land: str | None
    co: str | None
    telefon: str | None
    telefon_mobil: str | None
    email: str | None
    eintritt: date | None
    austritt: date | None
    verstorben_am: date | None
    aktiv: str | None
    aktiv_pasiv: str | None
    bereich: str | None
    abteilung: str | None
    bank: str | None
    iban: str | None  # decrypted
    bic: str | None
    abw_kontoinhaber: str | None
    mandatsreferenz: str | None
    geloscht: bool | None
    bemerkung: str | None
    imported_at: datetime
    contracts: list[LwContractResponse]
    sepa_mandates: list[LwSepaMandateResponse]


class LwImportStatsResponse(BaseModel):
    total_members: int
    active_members: int
    deleted_members: int
    total_contracts: int
    total_sepa: int
    total_fee_types: int
    last_import: LwImportBatchResponse | None


class LwMemberGeo(BaseModel):
    """Compact payload used to plot a member on the map."""

    adr_nr: int
    mitgliedsnummer: str | None
    vorname: str | None
    nachname: str | None
    plz: str | None
    ort: str | None
    lat: float
    lng: float


class LwGeocodeStatus(BaseModel):
    running: bool
    total: int
    processed: int
    found: int
    failed: int
    skipped: int
    started_at: datetime | None
    completed_at: datetime | None
    last_address: str | None
    last_error: str | None
    pending: int  # members without coordinates yet
    geocoded: int  # members with coordinates
    total_with_address: int  # members that have any address fields
