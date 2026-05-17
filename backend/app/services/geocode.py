"""
Address geocoding for imported Linear Webverein members.

Uses HERE Geocoding & Search v7 (https://developer.here.com). HERE's
data heritage goes back to Navteq, the source most German automotive
navigation systems use, so its resolution on residential DE addresses
is the best mainstream option short of an enterprise contract. The
freemium tier (~250k requests/month) is effectively unlimited for a
sports club.

Authentication is via the ``HERE_API_KEY`` environment variable. The
worker refuses to start without it.

Precision tracking
------------------

HERE returns a ``resultType`` per item (``houseNumber``, ``street``,
``locality``, ``administrativeArea``, ``postalCodePoint``, ...) and,
for houseNumber hits, a ``houseNumberType`` of ``PA`` (point address,
geocoded to the actual building) or ``interpolated`` (estimated along
the street segment).

We collapse that into our internal precision enum:

  * ``"house"`` -- ``resultType=houseNumber``, ``houseNumberType=PA``,
    and the returned house number matches what we asked for. The dot
    sits on the building.
  * ``"street"`` -- ``resultType=street``, an interpolated houseNumber,
    or a houseNumber whose digits don't match. lat/lng is replaced
    with the PLZ centroid so it doesn't masquerade as on-house.
  * ``"city"`` -- ``locality`` / ``postalCodePoint`` /
    ``administrativeArea`` fallback. lat/lng replaced with PLZ centroid.
  * ``"none"`` -- no usable result at all (treated as failed).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models.imported import LwMember

logger = logging.getLogger(__name__)


HERE_GEOCODE_URL = "https://geocode.search.hereapi.com/v1/geocode"
USER_AGENT = "SVUMS/1.0 (https://github.com/Paul1404/svums)"
# HERE allows much higher concurrency than Photon. Eight in flight is
# comfortable for the freemium tier and keeps full club imports brisk.
CONCURRENCY = 8
# Retry budget when HERE answers 429 (rate limited) or 503 (busy).
HERE_MAX_RETRIES = 3

Precision = Literal["house", "street", "city", "none"]
GeocodeScope = Literal["pending", "approximate", "all"]

# HERE resultType values we treat as locality-level (good enough for a
# PLZ-centred dot, never for a house pin).
_LOCALITY_TYPES = {
    "locality",
    "administrativeArea",
    "postalCodePoint",
    "addressBlock",
}


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


def _classify(item: dict, expected_housenumber: str | None) -> Precision:
    """Map a HERE result item to our precision enum.

    A "house" verdict requires:
      * ``resultType == "houseNumber"``,
      * ``houseNumberType == "PA"`` (point address, not interpolated),
      * the returned house number matches the expected one (digit-wise
        plus suffix when both sides have a suffix; ``"12a"`` and
        ``"12 a"`` are treated as the same building, ``"12a"`` and
        ``"12b"`` are not).

    Otherwise we demote to ``"street"`` so the caller can snap the pin
    to the PLZ centroid instead of dropping a fake building hit.
    """
    result_type = (item.get("resultType") or "").strip()
    house_number_type = (item.get("houseNumberType") or "").strip()
    address = item.get("address") or {}
    returned_house = str(address.get("houseNumber") or "").strip()

    if result_type == "houseNumber":
        if house_number_type and house_number_type != "PA":
            # Interpolated hit -- HERE estimated a position along the
            # street segment. Honest mid-block guess at best.
            return "street"
        if expected_housenumber and returned_house:
            if not _housenumbers_match(expected_housenumber, returned_house):
                return "street"
        return "house"
    if result_type == "street":
        return "street"
    if result_type in _LOCALITY_TYPES:
        return "city"
    return "street"


def _housenumbers_match(expected: str, got: str) -> bool:
    """Tolerant equality for German house numbers.

    Compares the leading digit run; if both inputs also carry an alpha
    suffix (``"12a"`` style) the suffixes must agree. ``"12"`` matches
    ``"12 a"`` only if the expected value is also bare ``"12"``.
    """
    want_digits = "".join(c for c in expected if c.isdigit())
    got_digits = "".join(c for c in got if c.isdigit())
    if not want_digits or not got_digits:
        return False
    if want_digits != got_digits:
        return False
    want_suffix = "".join(c for c in expected if c.isalpha()).lower()
    got_suffix = "".join(c for c in got if c.isalpha()).lower()
    if want_suffix and got_suffix and want_suffix != got_suffix:
        return False
    return True


def _coords_from_item(item: dict | None) -> tuple[float, float] | None:
    """Pull (lat, lng) out of a HERE result item."""
    if not item:
        return None
    pos = item.get("position") or {}
    try:
        lat = float(pos["lat"])
        lng = float(pos["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    return lat, lng


async def _here_get(
    client: httpx.AsyncClient,
    params: dict[str, str],
) -> dict | None:
    """One HERE geocode request; returns the top result item or None.

    Retries with exponential backoff on 429 / 503 so a transient burst
    doesn't drop members on the floor.
    """
    settings = get_settings()
    api_key = settings.here_api_key
    if not api_key:
        # Should be caught earlier; defensive guard so the worker fails
        # fast instead of spamming HERE with empty keys.
        logger.error("HERE_API_KEY is not set; cannot geocode")
        return None
    full_params = {
        "lang": "de",
        "limit": "1",
        "in": "countryCode:DEU",
        **params,
        "apiKey": api_key,
    }
    log_params = {k: v for k, v in full_params.items() if k != "apiKey"}
    for attempt in range(HERE_MAX_RETRIES):
        try:
            resp = await client.get(
                HERE_GEOCODE_URL,
                params=full_params,
                headers={"User-Agent": USER_AGENT},
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("HERE request failed for %s: %s", log_params, exc)
            return None
        if resp.status_code in (429, 503):
            wait = 1.0 * (2**attempt)
            logger.info(
                "HERE returned %s, backing off %.1fs (attempt %d/%d)",
                resp.status_code, wait, attempt + 1, HERE_MAX_RETRIES,
            )
            await asyncio.sleep(wait)
            continue
        if resp.status_code == 401:
            logger.error("HERE rejected the API key (401). Check HERE_API_KEY.")
            return None
        if resp.status_code != 200:
            logger.warning("HERE returned %s for %s", resp.status_code, log_params)
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        items = body.get("items") if isinstance(body, dict) else None
        if not items:
            return None
        first = items[0]
        if not isinstance(first, dict):
            return None
        return first
    logger.warning("HERE kept returning rate-limit errors, giving up on %s", log_params)
    return None


def _address_key(member: LwMember) -> tuple[str, str, str, str]:
    """Normalised tuple used to group members at the same address.

    Whole families typically share Straße/Hausnummer/PLZ/Ort, so we
    geocode the address once and apply the result to all of them
    instead of firing N identical requests.
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
    item = await _here_get(client, {"qq": f"postalCode={plz};country=Germany"})
    coords = _coords_from_item(item)
    cache[plz] = coords
    return coords


def _build_structured_query(
    street: str, house: str, plz: str, ort: str
) -> str:
    """Compose a HERE ``qq`` qualified-query value.

    Structured queries (``qq=street=X;houseNumber=Y;...``) parse
    German addresses far more reliably than free-text searches --
    abbreviations like ``Hauptstr.`` get matched against
    ``Hauptstraße`` cleanly, and house-number suffixes survive the
    round trip.
    """
    parts: list[str] = []
    if street:
        # Semicolons would split the qualified query, so strip them.
        parts.append(f"street={street.replace(';', ' ')}")
    if house:
        parts.append(f"houseNumber={house.replace(';', ' ')}")
    if plz:
        parts.append(f"postalCode={plz}")
    if ort:
        parts.append(f"city={ort.replace(';', ' ')}")
    parts.append("country=Germany")
    return ";".join(parts)


@dataclass
class GeocodeOutcome:
    """Result of one address lookup, with a human-readable diagnostic.

    ``coords`` and ``precision`` are ``None`` for a complete failure
    (HERE returned nothing AND we couldn't resolve the PLZ either).
    ``note`` is always set so the admin can see in the UI why a row
    landed in the "stuck" list -- a missing street, an interpolated
    HERE hit, a mismatched house number, etc.
    """

    coords: tuple[float, float] | None
    precision: Precision | None
    note: str


def _describe_here_hit(
    item: dict,
    classified: Precision,
    expected_house: str,
) -> str:
    """Compose the German note we write to ``geocode_notes`` after a hit."""
    result_type = (item.get("resultType") or "?").strip() or "?"
    house_number_type = (item.get("houseNumberType") or "").strip()
    address = item.get("address") or {}
    returned_house = str(address.get("houseNumber") or "").strip()

    if classified == "house":
        return "Hausgenauer HERE-Treffer."
    if result_type == "houseNumber":
        if house_number_type and house_number_type != "PA":
            return (
                "HERE konnte die Hausnummer nur entlang der Straße schätzen "
                "(interpoliert); auf PLZ-Mittelpunkt zurückgestuft."
            )
        if expected_house and returned_house and not _housenumbers_match(
            expected_house, returned_house
        ):
            return (
                f"HERE lieferte Hausnummer {returned_house} statt "
                f"{expected_house}; auf PLZ-Mittelpunkt zurückgestuft."
            )
        return "HERE-Treffer auf Hausnummer, aber nicht punktgenau."
    if result_type == "street":
        return (
            "HERE kennt die Straße, aber nicht die Hausnummer; "
            "auf PLZ-Mittelpunkt gesetzt."
        )
    if result_type in _LOCALITY_TYPES:
        return (
            f"HERE-Treffer nur auf Orts-/PLZ-Ebene ({result_type}); "
            "Pin sitzt auf dem PLZ-Mittelpunkt."
        )
    return f"HERE-Treffer-Typ {result_type!r}; auf PLZ-Mittelpunkt gesetzt."


async def _geocode_member(
    client: httpx.AsyncClient,
    member: LwMember,
    plz_cache: dict[str, tuple[float, float] | None],
) -> GeocodeOutcome:
    """Geocode one member, snapping sub-house hits to the PLZ centroid."""
    street = (member.strasse or "").strip()
    house = (member.hausnummer or "").strip()
    plz = (member.plz or "").strip()
    ort = (member.ort or "").strip()

    if not street and not (plz or ort):
        return GeocodeOutcome(None, None, "Keine Adressfelder vorhanden.")

    item: dict | None = None
    if street and (plz or ort):
        qq = _build_structured_query(street, house, plz, ort)
        item = await _here_get(client, {"qq": qq})

    if item is not None:
        coords = _coords_from_item(item)
        if coords is not None:
            precision = _classify(item, house or None)
            note = _describe_here_hit(item, precision, house)
            lat, lng = coords
            if precision == "house":
                return GeocodeOutcome((lat, lng), precision, note)
            # Anything below house-level shouldn't pretend to be on a
            # building. Swap to the PLZ centroid so the dot lives in
            # an honestly approximate spot. Fall back to the raw
            # coordinate only if we can't resolve the PLZ.
            centroid = await _get_plz_centroid(client, plz, plz_cache)
            if centroid is not None:
                return GeocodeOutcome(centroid, precision, note)
            return GeocodeOutcome((lat, lng), precision, note)

    # No address-level hit at all. The PLZ centroid is the best we can
    # honestly offer.
    centroid = await _get_plz_centroid(client, plz, plz_cache)
    if centroid is not None:
        note = (
            "HERE kennt diese Adresse nicht; Pin sitzt auf dem PLZ-Mittelpunkt."
            if street
            else "Nur PLZ/Ort bekannt; Pin sitzt auf dem PLZ-Mittelpunkt."
        )
        return GeocodeOutcome(centroid, "city", note)

    return GeocodeOutcome(
        None,
        None,
        "Weder Adresse noch PLZ-Mittelpunkt bei HERE auffindbar.",
    )


def _not_ignored(q):
    """Add the ``geocode_ignored IS NOT TRUE`` filter to a query.

    Members the admin has marked as ignored are excluded from worker
    queries and from the "stuck" counters. NULL counts as not-ignored
    so legacy rows behave normally.
    """
    return q.filter(
        (LwMember.geocode_ignored.is_(None)) | (LwMember.geocode_ignored.is_(False))
    )


def _reset_for_scope(db: Session, scope: GeocodeScope) -> int:
    """Null out coordinates so the worker picks the rows back up.

    Returns the number of rows reset. ``pending`` resets nothing.
    Ignored rows are never touched -- the admin took them out of the
    rotation on purpose.
    """
    if scope == "pending":
        return 0
    q = _not_ignored(db.query(LwMember))
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
        LwMember.geocode_notes: None,
    }
    count = q.update(updates, synchronize_session=False)
    db.commit()
    return count


def clear_member_geocode(db: Session, adr_nr: int) -> bool:
    """Wipe a single member's coordinates so it disappears from the map.

    Returns True if the row was found and updated, False otherwise.
    """
    member = db.query(LwMember).filter(LwMember.adr_nr == adr_nr).first()
    if member is None:
        return False
    member.lat = None
    member.lng = None
    member.geocode_status = None
    member.geocoded_at = None
    member.geocode_precision = None
    member.geocode_notes = None
    db.commit()
    return True


def set_member_ignored(db: Session, adr_nr: int, ignored: bool) -> bool:
    """Toggle the ``geocode_ignored`` flag for one member.

    Returns True if the row was found, False otherwise. When ignored is
    set the row disappears from both the pending and approximate
    counters, and the worker stops picking it up.
    """
    member = db.query(LwMember).filter(LwMember.adr_nr == adr_nr).first()
    if member is None:
        return False
    member.geocode_ignored = bool(ignored)
    db.commit()
    return True


def _apply_outcome(
    members: list[LwMember],
    outcome: GeocodeOutcome,
    ts: datetime,
) -> None:
    """Write a geocode outcome onto every member sharing the same address."""
    if outcome.coords is None:
        for member in members:
            member.geocode_status = "failed"
            member.geocode_precision = "none"
            member.geocode_notes = outcome.note
            member.geocoded_at = ts
            _state.failed += 1
            _state.processed += 1
        return
    lat, lng = outcome.coords
    precision = outcome.precision or "city"
    for member in members:
        member.lat = lat
        member.lng = lng
        member.geocode_status = "found"
        member.geocode_precision = precision
        member.geocode_notes = outcome.note
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
    # HERE hundreds of times for the same Ort.
    plz_cache: dict[str, tuple[float, float] | None] = {}
    try:
        async with httpx.AsyncClient() as client:
            unresolved = (
                _not_ignored(
                    db.query(LwMember)
                    .filter(LwMember.lat.is_(None))
                    .filter(
                        (LwMember.geocode_status.is_(None))
                        | (
                            LwMember.geocode_status.notin_(["failed", "no_address"])
                        )
                    )
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
            # collapse into a single HERE request.
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
                member.geocode_notes = "Keine Adressfelder vorhanden."
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
            ) -> tuple[list[LwMember], GeocodeOutcome]:
                async with sem:
                    _state.last_address = _describe_member(members[0])
                    outcome = await _geocode_member(client, members[0], plz_cache)
                return members, outcome

            tasks = [
                asyncio.create_task(process_group(members))
                for members in groups.values()
            ]
            try:
                groups_done = 0
                for fut in asyncio.as_completed(tasks):
                    members, outcome = await fut
                    _apply_outcome(members, outcome, datetime.utcnow())
                    groups_done += 1
                    # Commit roughly every 10 groups so the map can
                    # show new pins live while the worker keeps going.
                    if groups_done % 10 == 0:
                        db.commit()
            finally:
                # On cancel / error make sure no HERE request keeps
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

    Returns True if started, False if a task is already running or the
    HERE API key is missing.
    """
    global _task, _state
    if not get_settings().here_api_key:
        logger.warning("Geocoder refused to start: HERE_API_KEY is not set")
        return False
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
