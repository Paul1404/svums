"""Tests for the public scan-only paper-form upload endpoint.

This endpoint lets applicants upload a scan of a filled-in paper
Beitrittserklärung without admin login and without transcribing any fields.
The backend creates a placeholder ``MembershipApplication`` row with status
``scan_eingegangen`` so the admin can transcribe the data from the scan
preview in the admin UI.
"""

import io
import json

from app.routers import public as public_router
from app.services import storage
from app.models.application import MembershipApplication


def _stub_storage(monkeypatch):
    bucket: dict[str, bytes] = {}

    def _upload(filename, data, content_type="application/octet-stream"):
        bucket[filename] = data

    def _download(filename):
        return bucket.get(filename)

    def _delete(filename):
        bucket.pop(filename, None)

    monkeypatch.setattr(storage, "upload_file", _upload)
    monkeypatch.setattr(storage, "download_file", _download)
    monkeypatch.setattr(storage, "delete_file", _delete)
    monkeypatch.setattr(public_router.storage, "upload_file", _upload)
    monkeypatch.setattr(public_router.storage, "download_file", _download)
    monkeypatch.setattr(public_router.storage, "delete_file", _delete)
    return bucket


def test_paper_form_upload_creates_placeholder_application(
    client, db_session, monkeypatch
):
    bucket = _stub_storage(monkeypatch)
    file_bytes = b"%PDF-1.4 scanned paper form"

    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("antrag-paul.pdf", io.BytesIO(file_bytes), "application/pdf")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["antragsnummer"].startswith("ANT-")
    assert "Scan erfolgreich hochgeladen" in body["message"]

    # A placeholder application row was created with the expected sentinel state.
    stored = (
        db_session.query(MembershipApplication)
        .filter(MembershipApplication.antragsnummer == body["antragsnummer"])
        .one()
    )
    assert stored.status == "scan_eingegangen"
    assert stored.source == "legacy"
    assert stored.uploaded_file is not None
    assert stored.uploaded_at is not None
    assert stored.uploaded_file in bucket
    assert bucket[stored.uploaded_file] == file_bytes
    # Suppresses later email dispatch attempts.
    assert stored.email_sent is True
    # Consent flags must be unset — the paper signature has not yet been
    # transcribed/verified by an admin.
    assert stored.datenschutz_accepted is None
    assert stored.satzung_accepted is None
    assert stored.consent_at is None


def test_paper_form_upload_accepts_image(client, db_session, monkeypatch):
    _stub_storage(monkeypatch)

    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("scan.jpg", io.BytesIO(b"fake-jpg-bytes"), "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["antragsnummer"].startswith("ANT-")


def test_paper_form_upload_rejects_invalid_extension(client, monkeypatch):
    _stub_storage(monkeypatch)

    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("malware.exe", io.BytesIO(b"\x00\x01"), "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Dateiformat" in response.json()["detail"]


def test_paper_form_upload_rejects_empty_file(client, monkeypatch):
    _stub_storage(monkeypatch)

    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")},
    )
    assert response.status_code == 400
    assert "Leere Datei" in response.json()["detail"]


def test_paper_form_upload_rejects_oversized_file(client, monkeypatch):
    _stub_storage(monkeypatch)

    huge = b"X" * (20 * 1024 * 1024 + 1)
    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("huge.pdf", io.BytesIO(huge), "application/pdf")},
    )
    assert response.status_code == 400
    assert "groß" in response.json()["detail"]


def test_paper_form_upload_does_not_require_csrf(client, monkeypatch):
    """The endpoint is intended for anonymous public use, like /api/upload/{token}.

    No csrf_token cookie + no X-CSRF-Token header should still succeed.
    """
    _stub_storage(monkeypatch)
    # TestClient does NOT carry cookies between requests unless we set them — so
    # this also implicitly verifies the CSRF middleware does not block.
    response = client.post(
        "/api/upload-paper-form",
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    assert response.status_code == 200, response.text


def test_legacy_application_email_optional(client, admin_cookie, monkeypatch):
    """The admin legacy import must accept submissions without an e-mail address."""
    _stub_storage(monkeypatch)

    payload = {
        "antragstyp": "einzel",
        "geschlecht": "Herr",
        "vorname": "Otto",
        "nachname": "Beispiel",
        "geburtsdatum": "1980-04-15",
        "strasse": "Hauptstrasse 7",
        "plz": "97528",
        "ort": "Sulzdorf",
        # email & telefon intentionally omitted
        "abteilungen": ["Fußball"],
        "mitgliedschaft_typ": "erwachsener",
        "elternteil_mitglied": None,
        "kontoinhaber": "Otto Beispiel",
        "iban": "DE02120300000000202051",
        "bic": "BYLADEM1001",
        "kreditinstitut": "Testbank",
    }
    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(payload)},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] in (None, "")
    assert body["telefon"] in (None, "")
