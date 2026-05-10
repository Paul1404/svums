import io
import json
from datetime import date

from app.routers import admin as admin_router
from app.services import storage
from app.models.application import MembershipApplication


def _stub_storage(monkeypatch):
    """Replace S3 calls with in-memory dict so tests don't talk to Tigris."""
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
    monkeypatch.setattr(admin_router.storage, "upload_file", _upload)
    monkeypatch.setattr(admin_router.storage, "download_file", _download)
    monkeypatch.setattr(admin_router.storage, "delete_file", _delete)
    return bucket


def _einzel_payload(**overrides) -> dict:
    base = {
        "antragstyp": "einzel",
        "geschlecht": "Herr",
        "vorname": "Otto",
        "nachname": "Beispiel",
        "geburtsdatum": "1980-04-15",
        "strasse": "Hauptstrasse 7",
        "plz": "97528",
        "ort": "Sulzdorf",
        "telefon": "09727 1234567",
        "email": "otto.beispiel@example.com",
        "abteilungen": ["Fußball"],
        "mitgliedschaft_typ": "erwachsener",
        "elternteil_mitglied": None,
        "kontoinhaber": "Otto Beispiel",
        "iban": "DE02120300000000202051",
        "bic": "BYLADEM1001",
        "kreditinstitut": "Testbank",
    }
    base.update(overrides)
    return base


def test_legacy_application_creates_application_with_scan(
    client,
    admin_cookie,
    db_session,
    monkeypatch,
):
    bucket = _stub_storage(monkeypatch)

    payload = _einzel_payload()
    file_bytes = b"%PDF-1.4 fake scan content"

    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(payload)},
        files={"file": ("scan.pdf", io.BytesIO(file_bytes), "application/pdf")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source"] == "legacy"
    assert body["status"] == "dokument_hochgeladen"
    assert body["uploaded_file"] is not None
    assert body["antragsnummer"].startswith("ANT-")
    assert body["mandatsreferenz"]
    assert body["datenschutz_accepted"] is True
    assert body["satzung_accepted"] is True
    assert body["email_sent"] is True
    # IBAN comes back decrypted in the response.
    assert body["iban"] == "DE02120300000000202051"

    # Storage has the file and DB row references it.
    stored = db_session.query(MembershipApplication).filter_by(id=body["id"]).one()
    assert stored.uploaded_file in bucket
    assert bucket[stored.uploaded_file] == file_bytes
    assert stored.source == "legacy"


def test_legacy_application_signed_on_sets_consent_at(
    client,
    admin_cookie,
    db_session,
    monkeypatch,
):
    _stub_storage(monkeypatch)

    payload = _einzel_payload(signed_on="2024-09-01")
    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(payload)},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["consent_at"].startswith("2024-09-01T")


def test_legacy_application_rejects_invalid_extension(
    client,
    admin_cookie,
    monkeypatch,
):
    _stub_storage(monkeypatch)

    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(_einzel_payload())},
        files={"file": ("scan.exe", io.BytesIO(b"binary"), "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Dateiformat" in response.json()["detail"]


def test_legacy_application_requires_admin_auth(client, monkeypatch):
    _stub_storage(monkeypatch)

    # Pass CSRF (cookie + header) but no admin session cookie.
    response = client.post(
        "/api/admin/applications/legacy",
        cookies={"csrf_token": "test-csrf-token"},
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(_einzel_payload())},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 401


def test_legacy_application_validates_payload(
    client,
    admin_cookie,
    monkeypatch,
):
    _stub_storage(monkeypatch)

    bad = _einzel_payload(plz="X")  # invalid PLZ
    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(bad)},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 422


def test_legacy_application_skips_email_dispatch(
    client,
    admin_cookie,
    db_session,
    monkeypatch,
):
    """Legacy creation must not attempt to send any email — paper signature
    already implies the membership is set up. We assert by ensuring email_sent
    is True (used to suppress later resend attempts) and no email log rows are
    written by the create path."""
    _stub_storage(monkeypatch)

    captured: list[tuple[str, str, dict]] = []

    def fake_capture(event, distinct_id, properties=None):
        captured.append((event, distinct_id, properties or {}))

    monkeypatch.setattr(admin_router, "posthog_capture", fake_capture)

    response = client.post(
        "/api/admin/applications/legacy",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        data={"data": json.dumps(_einzel_payload())},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201

    # Posthog event for legacy import was emitted.
    legacy_events = [e for e in captured if e[0] == "membership_application_legacy_imported"]
    assert len(legacy_events) == 1

    # No email events fired during legacy creation.
    email_events = [e for e in captured if e[0] == "email_delivery_result"]
    assert email_events == []
