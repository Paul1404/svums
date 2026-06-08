"""Render checks for the DIN 5008 generated documents.

WeasyPrint needs native libraries (pango, cairo, ...). When they are missing
the whole module is skipped so the rest of the suite still runs.
"""
import io

import pytest

weasyprint = pytest.importorskip("weasyprint")

from app.schemas.club_config import ClubConfig
from app.services.pdf import (
    generate_approval_page,
    generate_cancellation_pdf,
    generate_pdf,
)

# Verify the native stack actually works; skip cleanly if it does not.
try:
    weasyprint.HTML(string="<p>x</p>").write_pdf()
except Exception as exc:  # pragma: no cover - depends on host libraries
    pytest.skip(f"WeasyPrint native libraries unavailable: {exc}", allow_module_level=True)

from pypdf import PdfReader


CLUB = ClubConfig().to_template_dict()


def _read(pdf_bytes: bytes) -> tuple[int, str]:
    assert pdf_bytes[:4] == b"%PDF"
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return len(reader.pages), text


def _base_application() -> dict:
    return {
        "antragsnummer": "ANT-2026-0042",
        "antragstyp": "einzel",
        "geschlecht": "Frau",
        "nachname": "Müller",
        "vorname": "Anna",
        "geburtsdatum_formatted": "14.03.1990",
        "strasse": "Hauptstraße 12",
        "plz": "97508",
        "ort": "Untereuerheim",
        "telefon": "09729/1234",
        "email": "anna.mueller@example.de",
        "abteilungen_display": "Fußball, Yoga",
        "club": CLUB,
        "datum": "08.06.2026",
        "site_host_display": "sv-untereuerheim.de",
        "glaeubiger_id": CLUB["sepa_glaeubiger_id"],
        "mandatsreferenz": "SVU1945-0042",
        "iban_formatted": "DE89 3704 0044 0532 0130 00",
        "bic": "COBADEFFXXX",
        "kreditinstitut": "Commerzbank",
        "mitgliedschaft_typ": "erwachsener",
        "notification_email": "info@sv-untereuerheim.de",
    }


def test_beitrittserklaerung_renders_with_din_elements():
    data = _base_application()
    data["unterschrift_base64"] = ""
    pages, text = _read(generate_pdf(data))
    assert pages <= 2
    assert "Beitrittserklärung" in text
    assert "SEPA-Lastschriftmandat" in text
    assert "Anna" in text and "Müller" in text
    # DIN footer (runs on every page) carries the club register data
    assert CLUB["registergericht"] in text


@pytest.mark.parametrize("antragstyp", ["einzel", "familie", "kind"])
def test_beitrittserklaerung_all_types_render(antragstyp):
    data = _base_application()
    data["antragstyp"] = antragstyp
    if antragstyp == "kind":
        data.update(
            erziehungsberechtigter_nachname="Schmidt",
            erziehungsberechtigter_vorname="Julia",
            elternteil_mitglied=True,
        )
    pages, text = _read(generate_pdf(data))
    assert pages >= 2
    assert CLUB["club_name"] in text


def test_aufnahmebestaetigung_is_single_page_letter():
    pages, text = _read(
        generate_approval_page(
            admin_unterschrift_base64="",
            approval_datum="08.06.2026",
            antragsnummer="ANT-2026-0042",
            applicant_name="Anna Müller",
            mandatsreferenz="SVU1945-0042",
            mitgliedsnummer="2026-117",
            club_config=CLUB,
            notification_email="info@sv-untereuerheim.de",
            empfaenger_anrede_text="Frau",
            empfaenger_anrede_greeting="Sehr geehrte Frau Müller",
            empfaenger_name="Anna Müller",
            empfaenger_strasse="Hauptstraße 12",
            empfaenger_plz="97508",
            empfaenger_ort="Untereuerheim",
        )
    )
    assert pages == 1
    # DIN letter parts: recipient address, salutation, subject, closing
    assert "Sehr geehrte Frau Müller" in text
    assert "Aufnahmebestätigung" in text
    assert "Mit freundlichen Grüßen" in text
    assert "Hauptstraße 12" in text


def test_austrittsbestaetigung_renders_as_letter():
    data = {
        "empfaenger_anrede": "Sehr geehrte Frau Müller",
        "empfaenger_anrede_text": "Frau",
        "empfaenger_vorname": "Anna",
        "empfaenger_nachname": "Müller",
        "empfaenger_strasse": "Hauptstraße 12",
        "empfaenger_plz": "97508",
        "empfaenger_ort": "Untereuerheim",
        "ist_empfaenger_abweichend": False,
        "vorname": "Anna",
        "nachname": "Müller",
        "strasse": "Hauptstraße 12",
        "plz": "97508",
        "ort": "Untereuerheim",
        "geburtsdatum": "14.03.1990",
        "mitgliedsnummer": "2026-117",
        "abteilung": "Fußball",
        "austritt_datum": "31.12.2026",
        "datum": "08.06.2026",
        "unterschrift_base64": "",
        "is_family": False,
        "familienmitglieder": [],
        "all_mitgliedsnummern": [],
        "club": CLUB,
        "notification_email": "info@sv-untereuerheim.de",
    }
    pages, text = _read(generate_cancellation_pdf(data))
    assert "Sehr geehrte Frau Müller" in text
    assert "Austritt" in text
    assert "31.12.2026" in text
    assert "Mit freundlichen Grüßen" in text
