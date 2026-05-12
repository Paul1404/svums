"""Tests for the OCR endpoints and service.

OCR depends on the Tesseract binary which isn't necessarily present in test
environments — we therefore mock the actual recognition layer and only verify
the routing, caching, and graceful-degradation logic.
"""

import io

import pytest

from app.routers import admin as admin_router
from app.services import ocr as ocr_service
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
    monkeypatch.setattr(admin_router.storage, "upload_file", _upload)
    monkeypatch.setattr(admin_router.storage, "download_file", _download)
    monkeypatch.setattr(admin_router.storage, "delete_file", _delete)
    return bucket


@pytest.fixture
def stub_ocr_available(monkeypatch):
    """Replace the OCR service so it pretends Tesseract works."""
    monkeypatch.setattr(ocr_service, "is_available", lambda: True)
    monkeypatch.setattr(admin_router.ocr_service, "is_available", lambda: True)

    def _extract(content: bytes, filename: str) -> str:
        return f"OCR-TEXT for {filename} ({len(content)} bytes)"

    monkeypatch.setattr(ocr_service, "extract_text", _extract)
    monkeypatch.setattr(admin_router.ocr_service, "extract_text", _extract)


@pytest.fixture
def stub_ocr_unavailable(monkeypatch):
    monkeypatch.setattr(ocr_service, "is_available", lambda: False)
    monkeypatch.setattr(admin_router.ocr_service, "is_available", lambda: False)


def test_ocr_endpoint_returns_text_and_caches(
    client, admin_cookie, application_factory, monkeypatch, db_session, stub_ocr_available
):
    bucket = _stub_storage(monkeypatch)
    bucket["paper.pdf"] = b"%PDF-fake"
    app = application_factory(uploaded_file="paper.pdf")

    res = client.get(
        f"/api/admin/applications/{app.id}/ocr",
        cookies=admin_cookie,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["available"] is True
    assert body["cached"] is False
    assert "OCR-TEXT for paper.pdf" in body["text"]

    # The text was persisted on the application row.
    db_session.expire_all()
    refreshed = db_session.query(MembershipApplication).filter_by(id=app.id).one()
    assert refreshed.uploaded_file_ocr == body["text"]

    # Second call without refresh comes straight from the cache and doesn't
    # touch the OCR service (this would otherwise re-run a 5-30s operation).
    def _fail(*args, **kwargs):
        raise AssertionError("OCR must not run when the cache is warm")

    monkeypatch.setattr(admin_router.ocr_service, "extract_text", _fail)

    res2 = client.get(
        f"/api/admin/applications/{app.id}/ocr",
        cookies=admin_cookie,
    )
    assert res2.status_code == 200
    body2 = res2.json()
    assert body2["cached"] is True
    assert body2["text"] == body["text"]


def test_ocr_endpoint_refresh_bypasses_cache(
    client, admin_cookie, application_factory, monkeypatch, db_session
):
    bucket = _stub_storage(monkeypatch)
    bucket["paper.pdf"] = b"%PDF-fake"
    app = application_factory(
        uploaded_file="paper.pdf", uploaded_file_ocr="old cached text"
    )

    monkeypatch.setattr(ocr_service, "is_available", lambda: True)
    monkeypatch.setattr(admin_router.ocr_service, "is_available", lambda: True)
    monkeypatch.setattr(
        admin_router.ocr_service, "extract_text", lambda c, n: "fresh new text"
    )

    res = client.get(
        f"/api/admin/applications/{app.id}/ocr?refresh=true",
        cookies=admin_cookie,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["cached"] is False
    assert body["text"] == "fresh new text"

    db_session.expire_all()
    refreshed = db_session.query(MembershipApplication).filter_by(id=app.id).one()
    assert refreshed.uploaded_file_ocr == "fresh new text"


def test_ocr_endpoint_when_tesseract_missing(
    client, admin_cookie, application_factory, monkeypatch, stub_ocr_unavailable
):
    bucket = _stub_storage(monkeypatch)
    bucket["paper.pdf"] = b"%PDF-fake"
    app = application_factory(uploaded_file="paper.pdf")

    res = client.get(
        f"/api/admin/applications/{app.id}/ocr",
        cookies=admin_cookie,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is False
    assert body["text"] is None
    assert "OCR" in body["error"]


def test_ocr_endpoint_requires_uploaded_file(
    client, admin_cookie, application_factory, monkeypatch, stub_ocr_available
):
    _stub_storage(monkeypatch)
    app = application_factory(uploaded_file=None)

    res = client.get(
        f"/api/admin/applications/{app.id}/ocr",
        cookies=admin_cookie,
    )
    assert res.status_code == 404


def test_ocr_endpoint_requires_admin(client, application_factory, monkeypatch):
    _stub_storage(monkeypatch)
    app = application_factory(uploaded_file="paper.pdf")

    res = client.get(f"/api/admin/applications/{app.id}/ocr")
    assert res.status_code == 401


def test_ocr_preview_endpoint(
    client, admin_cookie, monkeypatch, stub_ocr_available
):
    _stub_storage(monkeypatch)
    res = client.post(
        "/api/admin/ocr-preview",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["available"] is True
    assert "OCR-TEXT for scan.pdf" in body["text"]


def test_ocr_preview_rejects_invalid_extension(
    client, admin_cookie, monkeypatch, stub_ocr_available
):
    _stub_storage(monkeypatch)
    res = client.post(
        "/api/admin/ocr-preview",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        files={"file": ("foo.exe", io.BytesIO(b"x"), "application/octet-stream")},
    )
    assert res.status_code == 400


def test_ocr_preview_when_tesseract_missing(
    client, admin_cookie, monkeypatch, stub_ocr_unavailable
):
    _stub_storage(monkeypatch)
    res = client.post(
        "/api/admin/ocr-preview",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
        files={"file": ("scan.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is False
    assert body["text"] is None


def test_ocr_cache_cleared_on_delete_upload(
    client, admin_cookie, application_factory, monkeypatch, db_session
):
    bucket = _stub_storage(monkeypatch)
    bucket["paper.pdf"] = b"%PDF-fake"
    app = application_factory(
        uploaded_file="paper.pdf", uploaded_file_ocr="stale ocr"
    )

    res = client.delete(
        f"/api/admin/applications/{app.id}/upload",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200

    db_session.expire_all()
    refreshed = db_session.query(MembershipApplication).filter_by(id=app.id).one()
    assert refreshed.uploaded_file is None
    assert refreshed.uploaded_file_ocr is None


def test_ocr_service_returns_none_when_dependencies_missing(monkeypatch):
    """If pytesseract/Pillow can't be imported, extract_text returns None."""
    import builtins

    real_import = builtins.__import__

    def _blocking_import(name, *args, **kwargs):
        if name in ("pytesseract", "PIL"):
            raise ImportError(f"simulated missing {name}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _blocking_import)
    assert ocr_service.extract_text(b"data", "scan.jpg") is None


def test_ocr_service_is_available_probes_tesseract(monkeypatch):
    """is_available() should be False when pytesseract can't find the binary."""
    import pytesseract

    def _raise(*_args, **_kwargs):
        raise pytesseract.TesseractNotFoundError()

    monkeypatch.setattr(pytesseract, "get_tesseract_version", _raise)
    assert ocr_service.is_available() is False
