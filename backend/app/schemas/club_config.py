"""Club configuration schema — all club-specific settings in one place.

Stored as JSON in AppSettings.club_config.  Every field has a default
matching the original SV 1945 Untereuerheim setup so the app works
out of the box without any configuration.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class FeeEntry(BaseModel):
    """A single fee rule."""

    typ: str  # "familie", "kind", "jugendlich", "junger_erwachsener", "erwachsener"
    betrag: Decimal
    label: str
    elternteil_mitglied: Optional[bool] = None  # None = not applicable

    model_config = {"json_schema_extra": {"examples": [{"typ": "erwachsener", "betrag": "54.00", "label": "Erwachsene"}]}}


DEFAULT_FEES: list[dict] = [
    {"typ": "familie", "betrag": "96.00", "label": "Familie (2 Erwachsene + Kinder bis 18 Jahre)", "elternteil_mitglied": None},
    {"typ": "kind", "betrag": "12.00", "label": "Kinder (bis 14 Jahre), 1 Elternteil Mitglied", "elternteil_mitglied": True},
    {"typ": "kind", "betrag": "24.00", "label": "Kinder (bis 14 Jahre), kein Elternteil Mitglied", "elternteil_mitglied": False},
    {"typ": "jugendlich", "betrag": "24.00", "label": "Jugendliche (bis 18 Jahre), 1 Elternteil Mitglied", "elternteil_mitglied": True},
    {"typ": "jugendlich", "betrag": "36.00", "label": "Jugendliche (bis 18 Jahre), kein Elternteil Mitglied", "elternteil_mitglied": False},
    {"typ": "junger_erwachsener", "betrag": "42.00", "label": "Junge Erwachsene (bis 25 Jahre)", "elternteil_mitglied": None},
    {"typ": "erwachsener", "betrag": "54.00", "label": "Erwachsene", "elternteil_mitglied": None},
]

DEFAULT_DEPARTMENTS: list[str] = [
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


class ClubConfig(BaseModel):
    """Complete club configuration — serialised as JSON in the DB."""

    # ── Identity ──────────────────────────────────────────────
    club_name: str = "Sportverein 1945 Untereuerheim e.V."
    club_short_name: str = "SV 1945 Untereuerheim e.V."
    club_abbreviation: str = "SVU"
    club_city: str = "Untereuerheim"
    club_address: str = "Triebweg 9 · 97508 Grettstadt/Untereuerheim"
    club_website: str = "https://sv-untereuerheim.de"

    # ── Contact ───────────────────────────────────────────────
    contact_name: str = "Alexander Eckert"
    contact_role: str = "1. Vorsitzender"
    contact_phone: str = "09729/432"
    contact_email: str = "info@sv-untereuerheim.de"

    # ── Legal ─────────────────────────────────────────────────
    registergericht: str = "Amtsgericht Schweinfurt"
    registernummer: str = "VR 31"
    steuernummer: str = "249/111/20506"
    datenschutz_url: str = "https://sv-untereuerheim.de/datenschutz"
    satzung_url: str = "https://sv-untereuerheim.de/satzung"
    impressum_url: str = "https://sv-untereuerheim.de/impressum"

    # ── SEPA ──────────────────────────────────────────────────
    sepa_glaeubiger_id: str = "DE71ZZZ00000901082"
    sepa_mandate_prefix: str = "SVU1945-"

    # ── Fees ──────────────────────────────────────────────────
    fees: list[FeeEntry] = [FeeEntry(**f) for f in DEFAULT_FEES]

    # ── Departments ───────────────────────────────────────────
    departments: list[str] = list(DEFAULT_DEPARTMENTS)

    # ── Branding ──────────────────────────────────────────────
    primary_color: str = "#b91c1c"
    primary_color_dark: str = "#991b1b"
    primary_color_light: str = "#dc2626"
    logo_url: str = ""  # optional — path or data-URL

    # ── Email ─────────────────────────────────────────────────
    email_subject_prefix: str = "Sportverein 1945 Untereuerheim e.V."

    # ── Helpers ───────────────────────────────────────────────

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, raw: str | None) -> "ClubConfig":
        if not raw:
            return cls()
        return cls.model_validate_json(raw)

    def to_template_dict(self) -> dict:
        """Return a plain dict suitable for Jinja2 template context."""
        data = json.loads(self.model_dump_json())
        # Convert fee decimals to strings for templates
        for fee in data.get("fees", []):
            fee["betrag"] = str(fee["betrag"])
        return data


class ClubConfigUpdate(BaseModel):
    """Partial update schema — only provided fields are applied."""

    club_name: Optional[str] = None
    club_short_name: Optional[str] = None
    club_abbreviation: Optional[str] = None
    club_city: Optional[str] = None
    club_address: Optional[str] = None
    club_website: Optional[str] = None

    contact_name: Optional[str] = None
    contact_role: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None

    registergericht: Optional[str] = None
    registernummer: Optional[str] = None
    steuernummer: Optional[str] = None
    datenschutz_url: Optional[str] = None
    satzung_url: Optional[str] = None
    impressum_url: Optional[str] = None

    sepa_glaeubiger_id: Optional[str] = None
    sepa_mandate_prefix: Optional[str] = None

    fees: Optional[list[FeeEntry]] = None

    departments: Optional[list[str]] = None

    primary_color: Optional[str] = None
    primary_color_dark: Optional[str] = None
    primary_color_light: Optional[str] = None
    logo_url: Optional[str] = None

    email_subject_prefix: Optional[str] = None
