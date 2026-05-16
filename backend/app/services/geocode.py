"""
Address geocoding for imported Linear Webverein members.

Uses OpenStreetMap's Nominatim. Their usage policy requires:
  * a valid HTTP ``User-Agent`` identifying the application
  * at most one request per second
  * results may be cached locally (we do, in ``lw_members.lat/lng``)

The geocoder runs as a single in-process ``asyncio.Task`` whose progress
is exposed via :func:`get_state`. Re-running it only touches members that
don't already have coordinates, so it's safe to call repeatedly.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.imported import LwMember

logger = logging.getLogger(__name__)


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SVUMS/1.0 (https://github.com/Paul1404/svums)"
REQUEST_DELAY_SECONDS = 1.1  # Nominatim allows up to 1 req/sec — leave headroom


@dataclass
class GeocodeState:
    running: bool = False
    total: int = 0
    processed: int = 0
    found: int = 0
    failed: int = 0
    skipped: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_error: str | None = None
    last_address: str | None = None


_state = GeocodeState()
_state_lock = asyncio.Lock()
_task: asyncio.Task | None = None


def get_state() -> GeocodeState:
    return _state


def _build_query(member: LwMember) -> str | None:
    """Build a Nominatim query string from a member's address fields.

    Returns ``None`` when the member has no usable street/city information.
    """
    parts: list[str] = []
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    if street:
        parts.append(f"{street} {house}".strip())
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()
    if plz or ort:
        parts.append(f"{plz} {ort}".strip())
    if not parts:
        return None
    parts.append("Deutschland")
    return ", ".join(parts)


def _address_key(member: LwMember) -> str | None:
    """Normalised address key for deduplicating API calls."""
    q = _build_query(member)
    return q.lower() if q else None


async def _geocode_one(client: httpx.AsyncClient, query: str) -> tuple[float, float] | None:
    """Call Nominatim once and return ``(lat, lng)`` or ``None``."""
    try:
        resp = await client.get(
            NOMINATIM_URL,
            params={
                "format": "json",
                "q": query,
                "countrycodes": "de",
                "limit": "1",
                "addressdetails": "0",
            },
            headers={"User-Agent": USER_AGENT, "Accept-Language": "de"},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Nominatim request failed for %r: %s", query, exc)
        return None
    if resp.status_code != 200:
        logger.warning("Nominatim returned %s for %r", resp.status_code, query)
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    if not body:
        return None
    try:
        return float(body[0]["lat"]), float(body[0]["lon"])
    except (KeyError, ValueError, TypeError):
        return None


async def _run_geocoder():
    """Worker: iterate over unresolved members and fill in coordinates."""
    global _state
    db: Session = SessionLocal()
    try:
        async with httpx.AsyncClient() as client:
            unresolved = (
                db.query(LwMember)
                .filter(LwMember.lat.is_(None))
                .filter(
                    (LwMember.geocode_status.is_(None))
                    | (LwMember.geocode_status != "failed")
                )
                .all()
            )
            _state.total = len(unresolved)
            _state.processed = 0
            _state.found = 0
            _state.failed = 0
            _state.skipped = 0
            _state.last_error = None

            cache: dict[str, tuple[float, float]] = {}
            for m in db.query(LwMember).filter(LwMember.lat.isnot(None)).all():
                key = _address_key(m)
                if key and m.lat is not None and m.lng is not None:
                    cache[key] = (float(m.lat), float(m.lng))

            for member in unresolved:
                query = _build_query(member)
                if not query:
                    member.geocode_status = "no_address"
                    member.geocoded_at = datetime.utcnow()
                    _state.processed += 1
                    _state.skipped += 1
                    continue

                key = query.lower()
                _state.last_address = query
                if key in cache:
                    lat, lng = cache[key]
                    member.lat = lat
                    member.lng = lng
                    member.geocode_status = "found"
                    member.geocoded_at = datetime.utcnow()
                    _state.found += 1
                else:
                    coords = await _geocode_one(client, query)
                    if coords is None:
                        # Try a coarser fallback (just PLZ + Ort + Land)
                        plz = (member.plz or "").strip()
                        ort = (member.ort or "").strip()
                        if plz or ort:
                            fallback = ", ".join(p for p in [f"{plz} {ort}".strip(), "Deutschland"] if p)
                            await asyncio.sleep(REQUEST_DELAY_SECONDS)
                            coords = await _geocode_one(client, fallback)

                    if coords is None:
                        member.geocode_status = "failed"
                        member.geocoded_at = datetime.utcnow()
                        _state.failed += 1
                    else:
                        lat, lng = coords
                        member.lat = lat
                        member.lng = lng
                        member.geocode_status = "found"
                        member.geocoded_at = datetime.utcnow()
                        cache[key] = coords
                        _state.found += 1
                    await asyncio.sleep(REQUEST_DELAY_SECONDS)

                _state.processed += 1
                # Commit every 25 rows so partial progress is durable
                if _state.processed % 25 == 0:
                    db.commit()

            db.commit()
    except asyncio.CancelledError:
        logger.info("Geocoder cancelled by admin (processed=%d)", _state.processed)
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise
    except Exception as exc:
        logger.exception("Geocoder crashed: %s", exc)
        _state.last_error = str(exc)
        try:
            db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()
        _state.running = False
        _state.completed_at = datetime.utcnow()


async def start_geocoder() -> bool:
    """Kick off the background task. Returns True if started, False if already running."""
    global _task, _state
    async with _state_lock:
        if _state.running:
            return False
        _state = GeocodeState(
            running=True,
            started_at=datetime.utcnow(),
        )
        _task = asyncio.create_task(_run_geocoder())
        return True


async def stop_geocoder() -> bool:
    """Cancel the running task. Returns True if a task was cancelled."""
    global _task
    if _task is None or _task.done():
        return False
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None
    return True
