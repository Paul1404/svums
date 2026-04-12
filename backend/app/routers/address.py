"""
Address lookup endpoints using OpenStreetMap Nominatim API.
Provides PLZ→Ort resolution and street autocomplete for German addresses.
"""

import logging
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/address", tags=["address"])

# --- Configuration ---
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "SVUMS/1.0 (Vereins-Mitgliedschaft)",
    "Accept-Language": "de",
}
# Rate limiting: Nominatim allows max 1 req/sec. We enforce this globally.
_last_nominatim_call: float = 0.0

# --- In-memory cache for PLZ lookups (PLZ rarely change) ---
_plz_cache: dict[str, dict] = {}  # plz -> {orte: [...], timestamp: float}
PLZ_CACHE_TTL = 86400 * 30  # 30 days


async def _nominatim_search(params: dict) -> list[dict]:
    """Call Nominatim search API with rate limiting."""
    global _last_nominatim_call
    now = time.time()
    wait = max(0, 1.05 - (now - _last_nominatim_call))
    if wait > 0:
        import asyncio
        await asyncio.sleep(wait)

    params["format"] = "jsonv2"
    params["addressdetails"] = "1"
    params["countrycodes"] = "de"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                NOMINATIM_URL, params=params, headers=NOMINATIM_HEADERS
            )
            _last_nominatim_call = time.time()
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.warning(f"Nominatim request failed: {e}")
            return []
        except Exception as e:
            logger.warning(f"Nominatim parsing error: {e}")
            return []


@router.get("/plz/{plz}")
async def lookup_plz(plz: str):
    """
    Look up Ort(e) for a German PLZ.
    Returns a list of matching city/town names.
    """
    if not plz or len(plz) != 5 or not plz.isdigit():
        raise HTTPException(status_code=400, detail="PLZ muss 5 Ziffern haben")

    # Check cache
    now = time.time()
    if plz in _plz_cache and (now - _plz_cache[plz]["timestamp"]) < PLZ_CACHE_TTL:
        return _plz_cache[plz]["data"]

    results = await _nominatim_search({
        "postalcode": plz,
        "limit": 20,
    })

    # Extract unique Ort names from results
    orte: list[str] = []
    seen = set()
    for r in results:
        addr = r.get("address", {})
        # Nominatim returns various levels: city, town, village, municipality
        ort_name = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or addr.get("hamlet")
        )
        if ort_name and ort_name.lower() not in seen:
            seen.add(ort_name.lower())
            orte.append(ort_name)

    # If Nominatim returns nothing, still return a valid response
    response = {
        "plz": plz,
        "orte": sorted(orte),
        "found": len(orte) > 0,
    }

    # Cache the result
    _plz_cache[plz] = {"data": response, "timestamp": now}

    return response


@router.get("/streets")
async def search_streets(
    q: str = Query(..., min_length=2, max_length=100, description="Street name search query"),
    plz: Optional[str] = Query(None, min_length=5, max_length=5, description="PLZ to scope the search"),
    ort: Optional[str] = Query(None, min_length=1, max_length=100, description="City name to scope the search"),
):
    """
    Search for streets within a given PLZ/Ort area.
    Returns a list of matching street names with full addresses.
    """
    # Build the search query
    search_parts = [q]
    if ort:
        search_parts.append(ort)
    if plz:
        search_parts.append(plz)

    results = await _nominatim_search({
        "q": ", ".join(search_parts),
        "limit": 8,
    })

    # Also try structured search if free-text didn't yield good results
    if len(results) < 3:
        struct_params = {"street": q, "limit": 8}
        if plz:
            struct_params["postalcode"] = plz
        if ort:
            struct_params["city"] = ort
        struct_results = await _nominatim_search(struct_params)
        # Merge, deduplicating by display_name
        existing_names = {r.get("display_name", "") for r in results}
        for sr in struct_results:
            if sr.get("display_name", "") not in existing_names:
                results.append(sr)

    # Extract and deduplicate street suggestions
    streets: list[dict] = []
    seen_streets = set()

    for r in results:
        addr = r.get("address", {})
        road = addr.get("road")
        if not road:
            continue

        # Get the house number range if available
        house_number = addr.get("house_number", "")

        ort_name = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or ""
        )
        postcode = addr.get("postcode", "")

        # Build a unique key for deduplication
        street_key = f"{road.lower()}|{postcode}"
        if street_key in seen_streets:
            continue
        seen_streets.add(street_key)

        streets.append({
            "strasse": road,
            "hausnummer": house_number,
            "plz": postcode,
            "ort": ort_name,
            "display": f"{road}, {postcode} {ort_name}".strip(),
        })

    return {
        "query": q,
        "results": streets[:8],
    }
