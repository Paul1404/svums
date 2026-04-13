from app.services import posthog as posthog_service


def test_client_config_disabled_without_posthog_key(client, monkeypatch):
    monkeypatch.setenv("POSTHOG_KEY", "")
    monkeypatch.setenv("POSTHOG_HOST", "https://eu.i.posthog.com")
    posthog_service.get_settings.cache_clear()

    response = client.get("/api/client-config")

    assert response.status_code == 200
    data = response.json()
    assert data["posthog_enabled"] is False
    assert data["posthog_key"] is None
    assert data["posthog_host"] is None
    assert "club" in data


def test_capture_noops_when_disabled(monkeypatch):
    calls: list[dict] = []

    def fake_capture(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})

    monkeypatch.setenv("POSTHOG_KEY", "")
    posthog_service.get_settings.cache_clear()
    monkeypatch.setattr(posthog_service.posthog, "capture", fake_capture)

    posthog_service.capture(
        "membership_application_submitted",
        "ANT-2026-00001",
        {"application_id": 1, "email": "forbidden@example.com"},
    )

    assert calls == []


def test_capture_sanitizes_properties(monkeypatch):
    calls: list[dict] = []

    def fake_capture(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})

    monkeypatch.setenv("POSTHOG_KEY", "test-key")
    posthog_service.get_settings.cache_clear()
    monkeypatch.setattr(posthog_service.posthog, "capture", fake_capture)

    posthog_service.capture(
        "email_delivery_result",
        "ANT-2026-00001",
        {
            "application_id": 1,
            "email": "forbidden@example.com",
            "nested": {"result": "success", "recipient": "nope@example.com"},
        },
    )

    assert len(calls) == 1
    properties = calls[0]["kwargs"]["properties"]
    assert properties["application_id"] == 1
    assert "email" not in properties
    assert properties["nested"] == {"result": "success"}
