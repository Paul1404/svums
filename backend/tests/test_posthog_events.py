from datetime import datetime, timedelta

from app.routers import admin as admin_router
from app.routers import public as public_router


def test_status_change_emits_admin_application_status_changed(
    client,
    admin_cookie,
    application_factory,
    monkeypatch,
):
    app_row = application_factory(
        created_at=datetime.utcnow() - timedelta(days=2),
        uploaded_at=datetime.utcnow() - timedelta(hours=6),
    )
    captured: list[tuple[str, str, dict]] = []

    def fake_capture(event: str, distinct_id: str, properties: dict | None = None):
        captured.append((event, distinct_id, properties or {}))

    monkeypatch.setattr(admin_router, "posthog_capture", fake_capture)

    response = client.patch(
        f"/api/admin/applications/{app_row.id}",
        json={"status": "in_bearbeitung"},
        cookies=admin_cookie,
        headers={"X-PostHog-Distinct-Id": "admin-browser-1"},
    )

    assert response.status_code == 200
    matching = [entry for entry in captured if entry[0] == "admin_application_status_changed"]
    assert len(matching) == 1
    _, distinct_id, properties = matching[0]
    assert distinct_id == "admin-browser-1"
    assert properties["application_id"] == app_row.id
    assert properties["previous_status"] == "neu"
    assert properties["new_status"] == "in_bearbeitung"
    assert properties["hours_since_submission"] is not None
    assert properties["hours_since_upload"] is not None


def test_upload_invalid_and_expired_links_emit_events(
    client,
    application_factory,
    monkeypatch,
):
    captured: list[tuple[str, str, dict]] = []

    def fake_capture(event: str, distinct_id: str, properties: dict | None = None):
        captured.append((event, distinct_id, properties or {}))

    monkeypatch.setattr(public_router, "posthog_capture", fake_capture)

    invalid_response = client.get("/api/upload/does-not-exist")
    assert invalid_response.status_code == 404
    assert any(event == "membership_upload_link_invalid" for event, _, _ in captured)

    captured.clear()
    expired_app = application_factory(
        antragsnummer="ANT-2026-00002",
        created_at=datetime.utcnow() - timedelta(days=31),
    )
    expired_response = client.get(f"/api/upload/{expired_app.upload_token}")

    assert expired_response.status_code == 410
    matching = [entry for entry in captured if entry[0] == "membership_upload_link_expired"]
    assert len(matching) == 1
    assert matching[0][2]["antragsnummer"] == expired_app.antragsnummer
    assert matching[0][2]["reason"] == "expired_link"


def test_log_email_emits_sanitized_delivery_event(db_session, monkeypatch):
    captured: list[tuple[str, str, dict]] = []

    def fake_capture(event: str, distinct_id: str, properties: dict | None = None):
        captured.append((event, distinct_id, properties or {}))

    monkeypatch.setattr(admin_router, "posthog_capture", fake_capture)

    admin_router._log_email(
        db_session,
        "application_applicant",
        "user@example.com",
        "Subject line",
        False,
        Exception("smtp failed"),
        "ANT-2026-00003",
        "Max",
        "Mustermann",
    )

    assert len(captured) == 1
    event, distinct_id, properties = captured[0]
    assert event == "email_delivery_result"
    assert distinct_id == "ANT-2026-00003"
    assert properties["email_type"] == "application_applicant"
    assert properties["result"] == "failed"
    assert properties["has_application"] is True
    assert properties["has_error"] is True
    assert "recipient" not in properties
    assert "vorname" not in properties
    assert "nachname" not in properties
