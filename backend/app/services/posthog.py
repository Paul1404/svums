"""PostHog analytics - safe capture that no-ops when not configured."""
import logging

import posthog

from app.config import get_settings

logger = logging.getLogger(__name__)


def capture(event: str, distinct_id: str, properties: dict | None = None):
    """Capture an event to PostHog. No-ops when POSTHOG_KEY is not set."""
    try:
        if get_settings().posthog_key:
            posthog.capture(event, distinct_id=distinct_id, properties=properties or {})
    except Exception as e:
        logger.debug("PostHog capture skipped: %s", e)
