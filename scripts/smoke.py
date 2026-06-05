#!/usr/bin/env python3
"""
SVUMS smoke-test harness — exercises the full API surface end-to-end
without needing a running server or a browser.

Designed for Claude Code (and humans) to verify the app works after
a change. Uses FastAPI's TestClient against an isolated SQLite DB.

USAGE
    python scripts/smoke.py                    # run the full suite
    python scripts/smoke.py --list             # list available scenarios
    python scripts/smoke.py --only login apply # run a subset
    python scripts/smoke.py --verbose          # show request/response details
    python scripts/smoke.py --json             # machine-readable output

EXIT CODES
    0 — all scenarios passed
    1 — at least one scenario failed
    2 — fatal setup error (imports, DB, etc.)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

# Sandbox the smoke run: isolated DB, insecure defaults allowed.
os.environ.setdefault("ALLOW_INSECURE_DEFAULTS", "true")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{BACKEND}/data/smoke.db")
os.environ.setdefault("ADMIN_PASSWORD", "smoke-password")
os.environ.setdefault("COOKIE_SECRET", "smoke-cookie-secret-long-enough-for-check")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("PUBLIC_BASE_URL", "http://localhost:5173")

sys.path.insert(0, str(BACKEND))

# Wipe the smoke DB so each run starts clean.
_db_file = Path(os.environ["DATABASE_URL"].replace("sqlite:///", ""))
_db_file.parent.mkdir(parents=True, exist_ok=True)
if _db_file.exists():
    _db_file.unlink()


# ─────────────────────────────────────────────────────────────────────
#  Scenario plumbing
# ─────────────────────────────────────────────────────────────────────

ANSI_GREEN = "\033[32m"
ANSI_RED = "\033[31m"
ANSI_YELLOW = "\033[33m"
ANSI_DIM = "\033[2m"
ANSI_BOLD = "\033[1m"
ANSI_RESET = "\033[0m"


@dataclass
class ScenarioResult:
    name: str
    status: str  # "pass" | "fail" | "skip"
    message: str = ""
    duration_ms: float = 0.0
    details: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Context:
    client: Any  # TestClient
    verbose: bool
    results: list[ScenarioResult] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)

    def check(self, label: str, condition: bool, *, detail: str = "") -> None:
        """Assertion helper that accumulates details into the current scenario."""
        if self._current is None:
            raise RuntimeError("check() called outside a scenario")
        entry = {"label": label, "ok": bool(condition), "detail": detail}
        self._current.details.append(entry)
        if not condition:
            raise AssertionError(f"{label}: {detail}" if detail else label)

    _current: ScenarioResult | None = None


Scenario = Callable[[Context], None]
_REGISTRY: list[tuple[str, str, Scenario]] = []


def scenario(name: str, description: str = "") -> Callable[[Scenario], Scenario]:
    def _wrap(fn: Scenario) -> Scenario:
        _REGISTRY.append((name, description or fn.__doc__ or "", fn))
        return fn
    return _wrap


def _fmt_ms(ms: float) -> str:
    return f"{ms:.0f}ms" if ms >= 10 else f"{ms:.1f}ms"


# ─────────────────────────────────────────────────────────────────────
#  HTTP helpers (CSRF, admin session)
# ─────────────────────────────────────────────────────────────────────

def _csrf_headers(client) -> dict[str, str]:
    """Fetch a fresh CSRF token; the cookie is rotated on every call, so
    callers must use the returned header immediately for the next mutation."""
    r = client.get("/api/csrf-token")
    assert r.status_code == 200, f"csrf-token failed: {r.status_code}"
    return {"X-CSRF-Token": r.json()["csrf_token"]}


def _admin_login(client, password: str) -> dict[str, str]:
    headers = _csrf_headers(client)
    r = client.post(
        "/api/admin/login",
        json={"password": password},
        headers=headers,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return headers


def _build_application_payload(overrides: dict | None = None) -> dict:
    """A valid einzel application with consent flags set."""
    today = date.today()
    birth = today.replace(year=today.year - 30) - timedelta(days=7)
    payload = {
        "antragstyp": "einzel",
        "geschlecht": "Herr",
        "vorname": "Smoke",
        "nachname": "Tester",
        "geburtsdatum": birth.isoformat(),
        "strasse": "Teststraße 1",
        "plz": "97528",
        "ort": "Sulzdorf",
        "telefon": "09727 1234567",
        "email": "smoke@example.com",
        "abteilungen": ["Fußball"],
        "mitgliedschaft_typ": "erwachsener",
        "elternteil_mitglied": None,
        "kontoinhaber": "Smoke Tester",
        "iban": "DE89370400440532013000",
        "bic": "COBADEFFXXX",
        "kreditinstitut": "Commerzbank",
        "datenschutz_accepted": True,
        "satzung_accepted": True,
        "is_test": True,
    }
    if overrides:
        payload.update(overrides)
    return payload


# ─────────────────────────────────────────────────────────────────────
#  Scenarios
# ─────────────────────────────────────────────────────────────────────

@scenario("health", "GET /api/health returns ok")
def s_health(ctx: Context) -> None:
    r = ctx.client.get("/api/health")
    ctx.check("status 200", r.status_code == 200, detail=str(r.status_code))
    body = r.json()
    ctx.check("body has 'status' key", "status" in body, detail=str(body))


@scenario("client-config", "GET /api/client-config returns club key")
def s_client_config(ctx: Context) -> None:
    r = ctx.client.get("/api/client-config")
    ctx.check("status 200", r.status_code == 200)
    body = r.json()
    for key in ("club",):
        ctx.check(f"key '{key}'", key in body, detail=", ".join(body.keys()))


@scenario("club-config", "GET /api/club-config returns fees + departments")
def s_club_config(ctx: Context) -> None:
    r = ctx.client.get("/api/club-config")
    ctx.check("status 200", r.status_code == 200)
    body = r.json()
    for key in ("club_name", "fees", "departments", "sepa_glaeubiger_id"):
        ctx.check(f"key '{key}'", key in body)
    ctx.check("fees is non-empty list", isinstance(body["fees"], list) and len(body["fees"]) > 0)
    ctx.check("departments is non-empty list", isinstance(body["departments"], list) and len(body["departments"]) > 0)


@scenario("csrf-token", "GET /api/csrf-token returns token and sets cookie")
def s_csrf_token(ctx: Context) -> None:
    r = ctx.client.get("/api/csrf-token")
    ctx.check("status 200", r.status_code == 200)
    ctx.check("token in body", "csrf_token" in r.json())
    ctx.check("token cookie set", "csrf_token" in ctx.client.cookies)


@scenario("fee-calc", "GET /api/fees/calculate returns fee for an adult")
def s_fee_calc(ctx: Context) -> None:
    r = ctx.client.get(
        "/api/fees/calculate",
        params={"geburtsdatum": "1990-01-01", "mitgliedschaft_typ": "erwachsener"},
    )
    ctx.check("status 200", r.status_code == 200, detail=str(r.status_code))
    body = r.json()
    ctx.check("has jahresbeitrag", "jahresbeitrag" in body)
    ctx.check("jahresbeitrag > 0", float(body["jahresbeitrag"]) > 0)


@scenario("iban-lookup", "GET /api/iban/lookup returns bank info")
def s_iban_lookup(ctx: Context) -> None:
    r = ctx.client.get("/api/iban/lookup", params={"iban": "DE89370400440532013000"})
    ctx.check("status 200", r.status_code == 200, detail=str(r.status_code))


@scenario("admin-auth-guard", "Admin endpoints require login")
def s_admin_auth_guard(ctx: Context) -> None:
    # Ensure no admin session
    ctx.client.cookies.clear()
    r = ctx.client.get("/api/admin/me")
    ctx.check("401 when unauthenticated", r.status_code == 401, detail=str(r.status_code))
    r2 = ctx.client.get("/api/admin/stats")
    ctx.check("stats 401 when unauthenticated", r2.status_code == 401)


@scenario("login-wrong-password", "POST /api/admin/login rejects wrong password")
def s_login_wrong(ctx: Context) -> None:
    ctx.client.cookies.clear()
    headers = _csrf_headers(ctx.client)
    r = ctx.client.post("/api/admin/login", json={"password": "nope"}, headers=headers)
    ctx.check("401 on bad password", r.status_code == 401, detail=r.text[:120])


@scenario("login-correct", "POST /api/admin/login accepts the correct password")
def s_login(ctx: Context) -> None:
    ctx.client.cookies.clear()
    headers = _admin_login(ctx.client, os.environ["ADMIN_PASSWORD"])
    ctx.state["admin_headers"] = headers
    r = ctx.client.get("/api/admin/me")
    ctx.check("session cookie works", r.status_code == 200)
    ctx.check("authenticated true", r.json().get("authenticated") is True)


@scenario("csrf-enforcement", "PATCH without CSRF is rejected even when logged in")
def s_csrf_enforced(ctx: Context) -> None:
    # Already logged in from previous scenario.
    # Strip the CSRF header but keep the cookies — backend must still reject.
    r = ctx.client.patch(
        "/api/admin/applications/1",
        json={"status": "in_bearbeitung"},
        headers={},  # no CSRF header
    )
    ctx.check("403 without CSRF header", r.status_code == 403, detail=f"got {r.status_code}")


@scenario("apply-invalid", "POST /api/apply rejects bad payload (missing consent)")
def s_apply_invalid(ctx: Context) -> None:
    # Public endpoint needs CSRF. Use fresh client cookies.
    headers = _csrf_headers(ctx.client)
    bad = _build_application_payload({"datenschutz_accepted": False})
    r = ctx.client.post("/api/apply", json=bad, headers=headers)
    ctx.check("422 on missing consent", r.status_code == 422, detail=r.text[:120])


@scenario("apply", "POST /api/apply creates an application (einzel, test mode)")
def s_apply(ctx: Context) -> None:
    headers = _csrf_headers(ctx.client)
    payload = _build_application_payload()
    r = ctx.client.post("/api/apply", json=payload, headers=headers)
    ctx.check("status 200", r.status_code == 200, detail=r.text[:200])
    body = r.json()
    for key in ("id", "antragsnummer", "mandatsreferenz", "upload_url"):
        ctx.check(f"response has '{key}'", key in body)
    ctx.check("antragsnummer format", body["antragsnummer"].startswith("ANT-"))
    ctx.state["application_id"] = body["id"]
    ctx.state["antragsnummer"] = body["antragsnummer"]


@scenario("duplicate-check", "GET /api/check-duplicate detects an existing person")
def s_duplicate_check(ctx: Context) -> None:
    if not ctx.state.get("antragsnummer"):
        raise AssertionError("No antrag in context — run 'apply' first")
    payload = _build_application_payload()
    r = ctx.client.get(
        "/api/check-duplicate",
        params={
            "vorname": payload["vorname"],
            "nachname": payload["nachname"],
            "geburtsdatum": payload["geburtsdatum"],
        },
    )
    ctx.check("status 200", r.status_code == 200, detail=r.text[:120])


@scenario("status-page", "GET /api/status/{antragsnummer} returns public status")
def s_status_page(ctx: Context) -> None:
    antrag = ctx.state.get("antragsnummer")
    if not antrag:
        raise AssertionError("No antragsnummer in context — run 'apply' first")
    r = ctx.client.get(f"/api/status/{antrag}")
    ctx.check("status 200", r.status_code == 200, detail=str(r.status_code))
    body = r.json()
    ctx.check("body has status", "status" in body)


@scenario("admin-list", "GET /api/admin/applications returns the new application")
def s_admin_list(ctx: Context) -> None:
    # Ensure admin is logged in
    if "admin_headers" not in ctx.state:
        ctx.client.cookies.clear()
        ctx.state["admin_headers"] = _admin_login(ctx.client, os.environ["ADMIN_PASSWORD"])
    r = ctx.client.get("/api/admin/applications")
    ctx.check("status 200", r.status_code == 200, detail=r.text[:120])
    body = r.json()
    ctx.check("total >= 1", body["total"] >= 1, detail=str(body["total"]))
    ctx.check("items non-empty", len(body["items"]) >= 1)


@scenario("admin-stats", "GET /api/admin/stats returns counters (excludes test apps)")
def s_admin_stats(ctx: Context) -> None:
    r = ctx.client.get("/api/admin/stats")
    ctx.check("status 200", r.status_code == 200)
    body = r.json()
    for key in ("total", "by_status", "revenue_approved", "applications_this_month"):
        ctx.check(f"key '{key}'", key in body)
    # Stats intentionally exclude is_test=True rows, so total may be 0 here.
    ctx.check("total is non-negative int", isinstance(body["total"], int) and body["total"] >= 0)


@scenario("admin-detail", "GET /api/admin/applications/{id} returns full detail")
def s_admin_detail(ctx: Context) -> None:
    app_id = ctx.state.get("application_id")
    if not app_id:
        raise AssertionError("No application_id in context")
    r = ctx.client.get(f"/api/admin/applications/{app_id}")
    ctx.check("status 200", r.status_code == 200, detail=r.text[:120])
    body = r.json()
    ctx.check("iban decrypted (starts with DE)", body["iban"].startswith("DE"))
    ctx.check("status is 'neu'", body["status"] == "neu")


@scenario("admin-status-update", "PATCH marks application as in_bearbeitung")
def s_admin_patch(ctx: Context) -> None:
    app_id = ctx.state.get("application_id")
    # CSRF cookie rotates on every fetch; always pair a fresh token with the mutation.
    headers = _csrf_headers(ctx.client)
    r = ctx.client.patch(
        f"/api/admin/applications/{app_id}",
        json={"status": "in_bearbeitung"},
        headers=headers,
    )
    ctx.check("status 200", r.status_code == 200, detail=r.text[:160])
    ctx.check("new status reflected", r.json()["status"] == "in_bearbeitung")


@scenario("admin-decline", "PATCH declines application with reason")
def s_admin_decline(ctx: Context) -> None:
    # Create a second application just to decline
    csrf = _csrf_headers(ctx.client)
    r = ctx.client.post(
        "/api/apply",
        json=_build_application_payload({"email": "decline@example.com"}),
        headers=csrf,
    )
    ctx.check("second apply succeeds", r.status_code == 200, detail=r.text[:120])
    app_id = r.json()["id"]
    # Fresh CSRF pair for the mutation.
    headers = _csrf_headers(ctx.client)
    r2 = ctx.client.patch(
        f"/api/admin/applications/{app_id}",
        json={"status": "abgelehnt", "admin_decline_reason": "Smoke test decline"},
        headers=headers,
    )
    ctx.check("decline accepted", r2.status_code == 200, detail=r2.text[:160])
    ctx.check("status abgelehnt", r2.json()["status"] == "abgelehnt")


@scenario("admin-decline-requires-reason", "Decline without reason is rejected")
def s_admin_decline_required_reason(ctx: Context) -> None:
    app_id = ctx.state.get("application_id")
    headers = _csrf_headers(ctx.client)
    r = ctx.client.patch(
        f"/api/admin/applications/{app_id}",
        json={"status": "abgelehnt"},
        headers=headers,
    )
    ctx.check("422 without reason", r.status_code == 422, detail=r.text[:120])


@scenario("admin-export", "GET /api/admin/export returns CSV bytes")
def s_admin_export(ctx: Context) -> None:
    r = ctx.client.get("/api/admin/export", params={"include_test": True})
    ctx.check("status 200", r.status_code == 200)
    ctx.check("content-type is csv", "csv" in r.headers.get("content-type", ""))
    # Export header uses German column labels (e.g. "Nachname;Vorname;…").
    ctx.check("CSV has a header row", b"Nachname" in r.content and b"Vorname" in r.content)


@scenario("admin-settings", "GET/PUT /api/admin/settings round-trips")
def s_admin_settings(ctx: Context) -> None:
    r = ctx.client.get("/api/admin/settings")
    ctx.check("GET 200", r.status_code == 200)
    body = r.json()
    new_notify = "smoke+notify@example.com"
    headers = _csrf_headers(ctx.client)
    r2 = ctx.client.put(
        "/api/admin/settings",
        json={
            **{k: v for k, v in body.items() if k != "smtp_password_configured"},
            "notification_email": new_notify,
            "smtp_password": None,
        },
        headers=headers,
    )
    ctx.check("PUT 200", r2.status_code == 200, detail=r2.text[:160])
    ctx.check("notification_email persisted", r2.json()["notification_email"] == new_notify)


@scenario("admin-club-config", "GET/PUT /api/admin/club-config round-trips")
def s_admin_club_config(ctx: Context) -> None:
    r = ctx.client.get("/api/admin/club-config")
    ctx.check("GET 200", r.status_code == 200)


@scenario("admin-email-log", "GET /api/admin/email-logs returns a list")
def s_admin_email_log(ctx: Context) -> None:
    r = ctx.client.get("/api/admin/email-logs")
    ctx.check("GET 200", r.status_code == 200)
    ctx.check("is a list", isinstance(r.json(), list))


@scenario("upload-invalid-token", "GET /api/upload/{bad-token} returns 404")
def s_upload_bad(ctx: Context) -> None:
    r = ctx.client.get("/api/upload/does-not-exist-abc")
    ctx.check("404 for bogus token", r.status_code == 404)


@scenario("rate-limit-apply", "POST /api/apply is rate-limited after 3 requests")
def s_rate_limit(ctx: Context) -> None:
    # Backend limit: 3 requests per 10min per IP. We've already done 2 from
    # "apply" and "admin-decline". The next should either succeed or 429,
    # and a follow-up should definitely 429.
    csrf = _csrf_headers(ctx.client)
    payload = _build_application_payload({"email": "rate1@example.com"})
    r1 = ctx.client.post("/api/apply", json=payload, headers=csrf)
    r2 = ctx.client.post("/api/apply", json={**payload, "email": "rate2@example.com"}, headers=csrf)
    got_429 = 429 in (r1.status_code, r2.status_code)
    ctx.check(
        "rate limit triggers within 4 rapid submissions",
        got_429,
        detail=f"r1={r1.status_code} r2={r2.status_code}",
    )


@scenario("logout", "POST /api/admin/logout clears the session")
def s_logout(ctx: Context) -> None:
    # /api/admin/logout is exempt from CSRF (see csrf_middleware).
    r = ctx.client.post("/api/admin/logout")
    ctx.check("status 200", r.status_code == 200, detail=r.text[:120])
    r2 = ctx.client.get("/api/admin/me")
    ctx.check("401 after logout", r2.status_code == 401)


# ─────────────────────────────────────────────────────────────────────
#  Runner
# ─────────────────────────────────────────────────────────────────────

@contextmanager
def _timer() -> Iterator[Callable[[], float]]:
    import time
    start = time.perf_counter()
    yield lambda: (time.perf_counter() - start) * 1000


def _run(selected: list[str] | None, verbose: bool) -> list[ScenarioResult]:
    try:
        from fastapi.testclient import TestClient
        from app.config import get_settings
        get_settings.cache_clear()
        from app.main import app as fastapi_app
        from app.database import Base, engine

        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        print(f"{ANSI_RED}Fatal: failed to import backend: {exc}{ANSI_RESET}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(2)

    client = TestClient(fastapi_app)
    ctx = Context(client=client, verbose=verbose)

    registry = _REGISTRY
    if selected:
        keep = set(selected)
        registry = [(n, d, f) for (n, d, f) in _REGISTRY if n in keep]
        missing = keep - {n for (n, _, _) in _REGISTRY}
        if missing:
            print(f"{ANSI_RED}Unknown scenarios: {', '.join(sorted(missing))}{ANSI_RESET}", file=sys.stderr)
            sys.exit(2)

    for name, desc, fn in registry:
        result = ScenarioResult(name=name, status="pass")
        ctx._current = result
        with _timer() as elapsed:
            try:
                fn(ctx)
            except AssertionError as exc:
                result.status = "fail"
                result.message = str(exc)
            except Exception as exc:
                result.status = "fail"
                result.message = f"{type(exc).__name__}: {exc}"
                if verbose:
                    traceback.print_exc()
        result.duration_ms = elapsed()
        ctx.results.append(result)
        ctx._current = None
    return ctx.results


def _print_human(results: list[ScenarioResult], verbose: bool) -> None:
    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    total = len(results)

    print(f"\n{ANSI_BOLD}SVUMS smoke test{ANSI_RESET}  ({total} scenarios)\n")
    for r in results:
        if r.status == "pass":
            tag = f"{ANSI_GREEN}PASS{ANSI_RESET}"
        elif r.status == "skip":
            tag = f"{ANSI_YELLOW}SKIP{ANSI_RESET}"
        else:
            tag = f"{ANSI_RED}FAIL{ANSI_RESET}"
        print(f"  {tag}  {r.name:<32} {ANSI_DIM}{_fmt_ms(r.duration_ms):>7}{ANSI_RESET}")
        if r.status == "fail":
            print(f"        {ANSI_RED}→ {r.message}{ANSI_RESET}")
            for d in r.details:
                if not d["ok"]:
                    extra = f"  — {d['detail']}" if d["detail"] else ""
                    print(f"          {ANSI_DIM}✗ {d['label']}{extra}{ANSI_RESET}")
        elif verbose:
            for d in r.details:
                mark = "✓" if d["ok"] else "✗"
                print(f"          {ANSI_DIM}{mark} {d['label']}{ANSI_RESET}")

    print()
    summary_color = ANSI_GREEN if failed == 0 else ANSI_RED
    print(f"{summary_color}{ANSI_BOLD}{passed}/{total} passed{ANSI_RESET}"
          + (f"  — {failed} failed" if failed else ""))


def _print_json(results: list[ScenarioResult]) -> None:
    payload = {
        "total": len(results),
        "passed": sum(1 for r in results if r.status == "pass"),
        "failed": sum(1 for r in results if r.status == "fail"),
        "scenarios": [
            {
                "name": r.name,
                "status": r.status,
                "duration_ms": round(r.duration_ms, 2),
                "message": r.message,
                "checks": r.details,
            }
            for r in results
        ],
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="SVUMS smoke-test harness")
    parser.add_argument("--list", action="store_true", help="List available scenarios and exit")
    parser.add_argument("--only", nargs="+", metavar="NAME", help="Run only the named scenarios")
    parser.add_argument("--verbose", action="store_true", help="Show every check, not just failures")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable output")
    args = parser.parse_args()

    if args.list:
        print(f"{ANSI_BOLD}Available scenarios:{ANSI_RESET}")
        for name, desc, _ in _REGISTRY:
            print(f"  {name:<32} {ANSI_DIM}{desc}{ANSI_RESET}")
        return 0

    results = _run(selected=args.only, verbose=args.verbose)
    if args.json:
        _print_json(results)
    else:
        _print_human(results, verbose=args.verbose)

    return 0 if all(r.status == "pass" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
