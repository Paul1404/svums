"""
Address geocoding for imported Linear Webverein members.

Uses Photon (Komoot), https://photon.komoot.io, an OSM-backed,
Elasticsearch-powered geocoder. Photon parses messy German addresses
("Hauptstr. 12, 12345 Musterstadt") far more reliably than Nominatim's
free instance and the public endpoint has no formal rate limit. We
still throttle modestly so we stay a good neighbour.

Precision tracking
------------------

Each Photon feature carries a ``properties.type`` field with values
like ``house``, ``street``, ``locality``, ``district``, ``city``,
``county``, ``state`` or ``country``. We collapse that into our
internal precision enum (``house`` / ``street`` / ``city``).

For anything below house precision the geocoded coordinate is replaced
with the PLZ centroid before being stored. A "street" hit from Photon
otherwise drops the pin on whatever road segment matched, which on the
map reads as "wrong house". PLZ-centred dots are honestly approximate
and aggregate cleanly inside their postal area.

Precision values written to the DB:

  * ``"house"`` -- confirmed house-number hit, dot sits on the building
  * ``"street"`` -- road centroid; lat/lng snapped to PLZ centroid
  * ``"city"`` -- locality fallback; lat/lng snapped to PLZ centroid
  * ``"none"`` -- no coordinates at all (treated as failed)
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


PHOTON_URL = "https://photon.komoot.io/api/"
USER_AGENT = "SVUMS/1.0 (https://github.com/Paul1404/svums)"
# How many Photon requests we keep in flight at once. Photon's public
# instance has no hard rate limit but the Komoot team asks callers to
# be polite; 3 in-flight requests is well within "casual use".
CONCURRENCY = 3
# Retry budget when Photon answers 429 (rate limited) or 503 (busy).
PHOTON_MAX_RETRIES = 3
# Rough Germany bounding box (minLon, minLat, maxLon, maxLat). Photon
# accepts this to bias / restrict results, replacing Nominatim's
# countrycodes=de filter (which Photon doesn't support).
GERMANY_BBOX = "5.866,47.270,15.041,55.058"

Precision = Literal["house", "street", "city", "none"]
GeocodeScope = Literal["pending", "approximate", "all"]

# Photon "type" values that we treat as locality-level (good enough for
# a PLZ-centred dot but never for a house pin).
_LOCALITY_TYPES = {"locality", "district", "city", "county", "state", "country"}


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


def _describe_member(member: LwMember) -> str:
    """Short human-readable summary used as ``last_address`` for the UI."""
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()
    line1 = " ".join(p for p in [street, house] if p)
    line2 = " ".join(p for p in [plz, ort] if p)
    return ", ".join(p for p in [line1, line2] if p) or f"AdrNr {member.adr_nr}"


def _classify(feature: dict, expected_housenumber: str | None) -> Precision:
    """Map a Photon feature's ``properties.type`` to our precision enum.

    A "house" hit is only accepted as house-level if the returned
    house number matches what we asked for; otherwise it's demoted to
    street precision so the caller can swap the pin to the PLZ
    centroid instead.
    """
    props = feature.get("properties") or {}
    typ = (props.get("type") or "").lower()
    housenumber = (props.get("housenumber") or "").strip()

    if typ == "house":
        if expected_housenumber and housenumber:
            # Match leading digits so "12a" matches "12" gracefully.
            want = "".join(c for c in expected_housenumber if c.isdigit())
            got = "".join(c for c in housenumber if c.isdigit())
            if want and got and want != got:
                return "street"
        return "house"
    if typ == "street":
        return "street"
    if typ in _LOCALITY_TYPES:
        return "city"
    return "street"


def _coords_from_feature(feature: dict | None) -> tuple[float, float] | None:
    """Pull (lat, lng) out of a Photon GeoJSON feature."""
    if not feature:
        return None
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    try:
        lon = float(coords[0])
        lat = float(coords[1])
    except (TypeError, ValueError):
        return None
    return lat, lon


async def _photon_get(
    client: httpx.AsyncClient,
    params: dict[str, str],
) -> dict | None:
    """One Photon search request; returns the first feature or None.

    Retries with exponential backoff on transient rate-limit / busy
    responses so we don't drop members on a momentary blip.
    """
    full_params = {
        "lang": "de",
        "limit": "1",
        "bbox": GERMANY_BBOX,
        **params,
    }
    for attempt in range(PHOTON_MAX_RETRIES):
        try:
            resp = await client.get(
                PHOTON_URL,
                params=full_params,
                headers={"User-Agent": USER_AGENT},
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("Photon request failed for %s: %s", full_params, exc)
            return None
        if resp.status_code in (429, 503):
            wait = 1.0 * (2**attempt)
            logger.info(
                "Photon returned %s, backing off %.1fs (attempt %d/%d)",
                resp.status_code, wait, attempt + 1, PHOTON_MAX_RETRIES,
            )
            await asyncio.sleep(wait)
            continue
        if resp.status_code != 200:
            logger.warning("Photon returned %s for %s", resp.status_code, full_params)
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        features = body.get("features") if isinstance(body, dict) else None
        if not features:
            return None
        first = features[0]
        if not isinstance(first, dict):
            return None
        return first
    logger.warning("Photon kept returning rate-limit errors, giving up on %s", full_params)
    return None


def _address_key(member: LwMember) -> tuple[str, str, str, str]:
    """Normalised tuple used to group members at the same address.

    Whole families typically share Straße/Hausnummer/PLZ/Ort, so we
    geocode the address once and apply the result to all of them
    instead of firing N identical Photon requests.
    """
    return (
        (member.strasse or "").strip().lower(),
        (member.hausnummer or "").strip().lower(),
        (member.plz or "").strip(),
        (member.ort or "").strip().lower(),
    )


async def _get_plz_centroid(
    client: httpx.AsyncClient,
    plz: str,
    cache: dict[str, tuple[float, float] | None],
) -> tuple[float, float] | None:
    """Centroid of a German PLZ, memoised for the lifetime of a run."""
    plz = (plz or "").strip()
    if not plz:
        return None
    if plz in cache:
        return cache[plz]
    feature = await _photon_get(client, {"q": f"{plz} Deutschland"})
    coords = _coords_from_feature(feature)
    cache[plz] = coords
    return coords


async def _geocode_member(
    client: httpx.AsyncClient,
    member: LwMember,
    plz_cache: dict[str, tuple[float, float] | None],
) -> tuple[float, float, Precision] | None:
    """Geocode one member, snapping sub-house hits to the PLZ centroid."""
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()

    feature: dict | None = None
    if street and (plz or ort):
        parts = [f"{street} {house}".strip()]
        if plz or ort:
            parts.append(f"{plz} {ort}".strip())
        parts.append("Deutschland")
        q = ", ".join(p for p in parts if p)
        feature = await _photon_get(client, {"q": q})

    if feature is not None:
        coords = _coords_from_feature(feature)
        if coords is not None:
            precision = _classify(feature, house or None)
            lat, lng = coords
            if precision == "house":
                return lat, lng, precision
            # Anything below house-level shouldn't pretend to be on a
            # building. Swap to the PLZ centroid so the dot lives in
            # an honestly approximate spot. Fall back to the raw
            # coordinate only if we can't resolve the PLZ.
            centroid = await _get_plz_centroid(client, plz, plz_cache)
            if centroid is not None:
                return centroid[0], centroid[1], precision
            return lat, lng, precision

    # No address-level hit at all. The PLZ centroid is the best we can
    # honestly offer.
    centroid = await _get_plz_centroid(client, plz, plz_cache)
    if centroid is not None:
        return centroid[0], centroid[1], "city"

    return None


def _reset_for_scope(db: Session, scope: GeocodeScope) -> int:
    """Null out coordinates so the worker picks the rows back up.

    Returns the number of rows reset. ``pending`` resets nothing.
    """
    if scope == "pending":
        return 0
    q = db.query(LwMember)
    if scope == "approximate":
        # NULL precision counts as approximate -- those rows were geocoded
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


def _apply_hit(
    members: list[LwMember],
    hit: tuple[float, float, Precision] | None,
    ts: datetime,
) -> None:
    """Write a geocode result onto every member sharing the same address."""
    if hit is None:
        for member in members:
            member.geocode_status = "failed"
            member.geocode_precision = "none"
            member.geocoded_at = ts
            _state.failed += 1
            _state.processed += 1
        return
    lat, lng, precision = hit
    for member in members:
        member.lat = lat
        member.lng = lng
        member.geocode_status = "found"
        member.geocode_precision = precision
        member.geocoded_at = ts
        _state.found += 1
        _state.processed += 1
        if precision == "house":
            _state.house_hits += 1
        elif precision == "street":
            _state.street_hits += 1
        elif precision == "city":
            _state.city_hits += 1


async def _run_geocoder():
    """Worker: iterate over unresolved members and fill in coordinates."""
    global _state
    db: Session = SessionLocal()
    # Cache PLZ centroids for the lifetime of one run so we don't hit
    # Photon hundreds of times for the same Ort.
    plz_cache: dict[str, tuple[float, float] | None] = {}
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

            # Bucket members by normalised address. Whole families
            # collapse into a single Photon request.
            groups: dict[tuple[str, str, str, str], list[LwMember]] = {}
            empty: list[LwMember] = []
            for member in unresolved:
                street = (member.strasse or "").strip()
                plz = (member.plz or "").strip()
                ort = (member.ort or "").strip()
                if not (street or plz or ort):
                    empty.append(member)
                    continue
                groups.setdefault(_address_key(member), []).append(member)

            now = datetime.utcnow()
            for member in empty:
                member.geocode_status = "no_address"
                member.geocode_precision = "none"
                member.geocoded_at = now
                _state.processed += 1
                _state.skipped += 1

            logger.info(
                "Geocoder: %d members, %d unique addresses, %d skipped",
                len(unresolved), len(groups), len(empty),
            )

            sem = asyncio.Semaphore(CONCURRENCY)

            async def with_sem(coro):
                async with sem:
                    return await coro

            # Pre-warm PLZ centroids so the main loop never races two
            # workers on the same PLZ. Most clubs have far fewer
            # distinct PLZs than addresses, so this is cheap.
            distinct_plzs = {
                m.plz.strip()
                for ms in groups.values()
                for m in ms
                if m.plz and m.plz.strip()
            }
            if distinct_plzs:
                await asyncio.gather(
                    *(
                        with_sem(_get_plz_centroid(client, p, plz_cache))
                        for p in distinct_plzs
                    )
                )

            async def process_group(
                members: list[LwMember],
            ) -> tuple[list[LwMember], tuple[float, float, Precision] | None]:
                async with sem:
                    _state.last_address = _describe_member(members[0])
                    hit = await _geocode_member(client, members[0], plz_cache)
                return members, hit

            tasks = [
                asyncio.create_task(process_group(members))
                for members in groups.values()
            ]
            try:
                groups_done = 0
                for fut in asyncio.as_completed(tasks):
                    members, hit = await fut
                    _apply_hit(members, hit, datetime.utcnow())
                    groups_done += 1
                    # Commit roughly every 10 groups so the map can
                    # show new pins live while the worker keeps going.
                    if groups_done % 10 == 0:
                        db.commit()
            finally:
                # On cancel / error make sure no Photon request keeps
                # running after the worker has bailed.
                for t in tasks:
                    if not t.done():
                        t.cancel()
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)

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

      * ``"pending"`` (default) -- only rows that have no coordinates yet.
      * ``"approximate"`` -- also re-geocode rows whose previous precision
        was below house-level (or unknown).
      * ``"all"`` -- re-geocode every member, even confirmed house hits.

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
