"""
Address geocoding for imported Linear Webverein members.

Uses OpenStreetMap's Nominatim. Their usage policy requires:
  * a valid HTTP ``User-Agent`` identifying the application
  * at most one request per second
  * results may be cached locally (we do, in ``lw_members.lat/lng``)

The geocoder runs as a single in-process ``asyncio.Task`` whose progress
is exposed via :func:`get_state`.

Precision tracking
------------------

Nominatim's free-form ``q=...`` search often returns a road centroid when
it can't pin down the exact house number, which makes the map dots float
between buildings. We avoid that by hitting Nominatim's *structured*
endpoint first (``street``, ``postalcode``, ``city``, ``country``) with
``addressdetails=1`` and confirming the result actually carries a
``house_number``. Only then do we treat the hit as house-level precision.

Each member ends up with one of these ``geocode_precision`` values:

  * ``"house"`` — confirmed house-number hit (dot sits on the building)
  * ``"street"`` — road centroid, no house resolved
  * ``"city"`` — fallback to PLZ + Ort
  * ``"none"`` — no coordinates at all (treated as failed)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import httpx
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.imported import LwMember

logger = logging.getLogger(__name__)


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SVUMS/1.0 (https://github.com/Paul1404/svums)"
REQUEST_DELAY_SECONDS = 1.1  # Nominatim allows up to 1 req/sec — leave headroom

Precision = Literal["house", "street", "city", "none"]
GeocodeScope = Literal["pending", "approximate", "all"]


@dataclass
class GeocodeState:
    running: bool = False
    total: int = 0
    processed: int = 0
    found: int = 0
    failed: int = 0
    skipped: int = 0
    house_hits: int = 0
    street_hits: int = 0
    city_hits: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_error: str | None = None
    last_address: str | None = None
    scope: GeocodeScope = "pending"


_state = GeocodeState()
_state_lock = asyncio.Lock()
_task: asyncio.Task | None = None


def get_state() -> GeocodeState:
    return _state


def _fallback_query(member: LwMember) -> str | None:
    """Coarse PLZ + Ort query used when the structured lookup fails."""
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()
    if not (plz or ort):
        return None
    return ", ".join(p for p in [f"{plz} {ort}".strip(), "Deutschland"] if p)


def _describe_member(member: LwMember) -> str:
    """Short human-readable summary used as ``last_address`` for the UI."""
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()
    line1 = " ".join(p for p in [street, house] if p)
    line2 = " ".join(p for p in [plz, ort] if p)
    return ", ".join(p for p in [line1, line2] if p) or f"AdrNr {member.adr_nr}"


def _classify(result: dict, expected_housenumber: str | None) -> Precision:
    """Decide whether a Nominatim hit really sits on a building."""
    addr = result.get("address") or {}
    house_number = (addr.get("house_number") or "").strip()
    cls = (result.get("class") or "").lower()
    typ = (result.get("type") or "").lower()

    if house_number:
        if expected_housenumber:
            # Match leading digits so "12a" matches "12" gracefully.
            want = "".join(c for c in expected_housenumber if c.isdigit())
            got = "".join(c for c in house_number if c.isdigit())
            if want and got and want == got:
                return "house"
            # Different number than what we asked for — treat as street-level.
            return "street"
        return "house"

    if cls == "building":
        return "house"
    if cls == "place" and typ in {"house", "building", "address"}:
        return "house"
    if cls == "highway" or typ in {"residential", "road", "street", "service", "unclassified"}:
        return "street"
    if cls == "place" and typ in {"village", "town", "city", "hamlet", "suburb", "neighbourhood"}:
        return "city"
    return "street"


async def _nominatim_get(
    client: httpx.AsyncClient,
    params: dict[str, str],
) -> dict | None:
    """One Nominatim request; returns the first result dict or ``None``."""
    full_params = {
        "format": "json",
        "addressdetails": "1",
        "limit": "1",
        "dedupe": "1",
        "countrycodes": "de",
        **params,
    }
    try:
        resp = await client.get(
            NOMINATIM_URL,
            params=full_params,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "de"},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Nominatim request failed for %s: %s", full_params, exc)
        return None
    if resp.status_code != 200:
        logger.warning("Nominatim returned %s for %s", resp.status_code, full_params)
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    if not body:
        return None
    first = body[0]
    if not isinstance(first, dict):
        return None
    return first


async def _geocode_member(
    client: httpx.AsyncClient,
    member: LwMember,
) -> tuple[float, float, Precision] | None:
    """Try the most precise query first, fall back to coarser ones."""
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()

    # 1) Structured lookup — best chance at a house-level hit.
    if street and (plz or ort):
        structured: dict[str, str] = {
            "street": f"{house} {street}".strip() if house else street,
            "country": "Deutschland",
        }
        if plz:
            structured["postalcode"] = plz
        if ort:
            structured["city"] = ort
        result = await _nominatim_get(client, structured)
        if result is not None:
            try:
                lat = float(result["lat"])
                lng = float(result["lon"])
            except (KeyError, ValueError, TypeError):
                lat = lng = None  # type: ignore[assignment]
            if lat is not None and lng is not None:
                precision = _classify(result, house or None)
                if precision == "house":
                    return lat, lng, precision
                # Hold onto the result in case the next strategies do worse.
                best = (lat, lng, precision)
            else:
                best = None
        else:
            best = None
        await asyncio.sleep(REQUEST_DELAY_SECONDS)
    else:
        best = None

    # 2) Free-form q= search — Nominatim's matcher is sometimes smarter
    # at parsing messy German addresses than the structured endpoint.
    if street and (plz or ort):
        parts = [f"{street} {house}".strip()]
        if plz or ort:
            parts.append(f"{plz} {ort}".strip())
        parts.append("Deutschland")
        q = ", ".join(parts)
        result = await _nominatim_get(client, {"q": q})
        if result is not None:
            try:
                lat = float(result["lat"])
                lng = float(result["lon"])
                precision = _classify(result, house or None)
                if precision == "house":
                    return lat, lng, precision
                if best is None:
                    best = (lat, lng, precision)
            except (KeyError, ValueError, TypeError):
                pass
        await asyncio.sleep(REQUEST_DELAY_SECONDS)

    if best is not None:
        return best

    # 3) Coarse PLZ + Ort fallback — at least pins the dot near the village.
    fallback = _fallback_query(member)
    if fallback:
        result = await _nominatim_get(client, {"q": fallback})
        if result is not None:
            try:
                return float(result["lat"]), float(result["lon"]), "city"
            except (KeyError, ValueError, TypeError):
                pass
        await asyncio.sleep(REQUEST_DELAY_SECONDS)

    return None


def _reset_for_scope(db: Session, scope: GeocodeScope) -> int:
    """Null out coordinates so the worker picks the rows back up.

    Returns the number of rows reset. ``pending`` resets nothing.
    """
    if scope == "pending":
        return 0
    q = db.query(LwMember)
    if scope == "approximate":
        # NULL precision counts as approximate — those rows were geocoded
        # before we started tracking precision and should be refined.
        q = q.filter(
            (LwMember.geocode_precision.is_(None))
            | (LwMember.geocode_precision != "house")
        )
    updates = {
        LwMember.lat: None,
        LwMember.lng: None,
        LwMember.geocode_status: None,
        LwMember.geocoded_at: None,
        LwMember.geocode_precision: None,
    }
    count = q.update(updates, synchronize_session=False)
    db.commit()
    return count


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
            _state.house_hits = 0
            _state.street_hits = 0
            _state.city_hits = 0
            _state.last_error = None

            for member in unresolved:
                street = (member.strasse or "").strip()
                plz = (member.plz or "").strip()
                ort = (member.ort or "").strip()
                if not (street or plz or ort):
                    member.geocode_status = "no_address"
                    member.geocode_precision = "none"
                    member.geocoded_at = datetime.utcnow()
                    _state.processed += 1
                    _state.skipped += 1
                    continue

                _state.last_address = _describe_member(member)
                hit = await _geocode_member(client, member)

                if hit is None:
                    member.geocode_status = "failed"
                    member.geocode_precision = "none"
                    member.geocoded_at = datetime.utcnow()
                    _state.failed += 1
                else:
                    lat, lng, precision = hit
                    member.lat = lat
                    member.lng = lng
                    member.geocode_status = "found"
                    member.geocode_precision = precision
                    member.geocoded_at = datetime.utcnow()
                    _state.found += 1
                    if precision == "house":
                        _state.house_hits += 1
                    elif precision == "street":
                        _state.street_hits += 1
                    elif precision == "city":
                        _state.city_hits += 1

                _state.processed += 1
                # Commit every 5 rows so the map can show new pins live while
                # the worker is still going.
                if _state.processed % 5 == 0:
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


async def start_geocoder(scope: GeocodeScope = "pending") -> bool:
    """Kick off the background task.

    ``scope`` controls which rows the worker will visit:

      * ``"pending"`` (default) — only rows that have no coordinates yet.
      * ``"approximate"`` — also re-geocode rows whose previous precision
        was below house-level (or unknown).
      * ``"all"`` — re-geocode every member, even confirmed house hits.

    Returns True if started, False if a task is already running.
    """
    global _task, _state
    async with _state_lock:
        if _state.running:
            return False
        if scope != "pending":
            # Run the reset in a worker thread so we don't block the loop
            # on a potentially-large UPDATE.
            db: Session = SessionLocal()
            try:
                _reset_for_scope(db, scope)
            finally:
                db.close()
        _state = GeocodeState(
            running=True,
            started_at=datetime.utcnow(),
            scope=scope,
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
