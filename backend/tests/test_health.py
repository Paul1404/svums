import logging
from pathlib import Path

import pytest

from app.routers import public as public_router


@pytest.fixture(autouse=True)
def _reset_frontend_cache():
    public_router._FRONTEND_HEALTH_CACHE = None
    yield
    public_router._FRONTEND_HEALTH_CACHE = None


def test_health_returns_structured_payload(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["db"] == "ok"
    assert "status" in body
    assert "frontend" in body


def test_inspect_frontend_missing_static_dir(tmp_path):
    result = public_router._inspect_frontend(tmp_path / "does-not-exist")
    assert result["status"] == "missing_static_dir"


def test_inspect_frontend_missing_index(tmp_path):
    result = public_router._inspect_frontend(tmp_path)
    assert result["status"] == "missing_index_html"


def test_inspect_frontend_missing_asset(tmp_path):
    (tmp_path / "index.html").write_text(
        '<html><body><script type="module" src="/assets/index-GHOST.js"></script></body></html>',
        encoding="utf-8",
    )
    result = public_router._inspect_frontend(tmp_path)
    assert result["status"] == "missing_assets"
    assert result["missing"] == ["/assets/index-GHOST.js"]


def test_inspect_frontend_ok(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-OK.js").write_text("// ok", encoding="utf-8")
    (tmp_path / "index.html").write_text(
        '<html><body><script type="module" src="/assets/index-OK.js"></script></body></html>',
        encoding="utf-8",
    )
    result = public_router._inspect_frontend(tmp_path)
    assert result["status"] == "ok"
    assert result["assets"] == ["/assets/index-OK.js"]


def test_frontend_error_endpoint_logs_and_returns_ok(client, caplog):
    caplog.set_level(logging.ERROR, logger="app.routers.public")
    res = client.post(
        "/api/health/frontend-error",
        json={
            "error": {"message": "Minified React error #527", "stack": "at index.js:1:1"},
            "ua": "test-agent",
            "url": "http://test/",
        },
    )
    assert res.status_code == 200
    assert res.json() == {"received": True}
    assert any("frontend boot failure" in r.message for r in caplog.records)


def test_frontend_error_endpoint_handles_garbage(client):
    res = client.post(
        "/api/health/frontend-error",
        content=b"\x00\x01not-json",
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 200
    assert res.json() == {"received": True}
