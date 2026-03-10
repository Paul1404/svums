"""PostHog analytics helpers with property sanitization."""
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import posthog
from fastapi import Request

from app.config import get_settings

logger = logging.getLogger(__name__)

_DISALLOWED_PROPERTY_KEYS = {
    "vorname",
    "nachname",
    "email",
    "telefon",
    "strasse",
    "plz",
    "ort",
    "iban",
    "bic",
    "recipient",
    "subject",
    "error_message",
    "decline_reason",
    "admin_decline_reason",
    "filename",
    "uploaded_file",
    "admin_approved_file",
    "cookie",
    "password",
    "smtp_password",
}
_ALLOWED_VALUE_TYPES = (str, int, float, bool, type(None))


def is_enabled() -> bool:
    return bool(get_settings().posthog_key)


def get_admin_distinct_id(request: Request | None) -> str:
    if request is None:
        return "admin"
    header_value = (request.headers.get("x-posthog-distinct-id") or "").strip()
    return header_value or "admin"


def _coerce_property_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (list, tuple, set)):
        return [_coerce_property_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): coerced
            for key, item in value.items()
            if str(key) not in _DISALLOWED_PROPERTY_KEYS
            if (coerced := _coerce_property_value(item)) is not None
        }
    if isinstance(value, _ALLOWED_VALUE_TYPES):
        return value
    return str(value)


def sanitize_properties(properties: dict[str, Any] | None) -> dict[str, Any]:
    if not properties:
        return {}
    sanitized: dict[str, Any] = {}
    for key, value in properties.items():
        normalized_key = str(key)
        if normalized_key in _DISALLOWED_PROPERTY_KEYS:
            continue
        coerced = _coerce_property_value(value)
        if coerced is None and value is not None:
            continue
        sanitized[normalized_key] = coerced
    return sanitized


def capture(event: str, distinct_id: str, properties: dict | None = None):
    """Capture an event to PostHog. No-ops when POSTHOG_KEY is not set."""
    if not is_enabled():
        return
    try:
        posthog.capture(
            event,
            distinct_id=distinct_id,
            properties=sanitize_properties(properties),
        )
    except Exception as exc:
        logger.debug("PostHog capture skipped: %s", exc)


def identify(distinct_id: str, properties: dict | None = None):
    """Identify a person in PostHog. No-ops when POSTHOG_KEY is not set."""
    if not is_enabled():
        return
    try:
        posthog.identify(
            distinct_id=distinct_id,
            properties=sanitize_properties(properties),
        )
    except Exception as exc:
        logger.debug("PostHog identify skipped: %s", exc)
