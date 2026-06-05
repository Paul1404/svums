import logging
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from sqlalchemy import text

from app.config import get_settings
from app.database import Base, SessionLocal, engine, wait_for_db
from app.logging_config import setup_logging
from app.routers import admin, address, public, admin_imports
from app.services.rate_limit import consume_rate_limit, normalize_client_ip

# Configure logging before anything else uses it
setup_logging()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    # Wait for serverless DB to become available (handles Neon cold starts)
    wait_for_db()

    # Create all database tables
    Base.metadata.create_all(bind=engine)

    # SQLite-only: add new columns to existing databases that pre-date the model
    from app.config import get_settings as _get_cfg
    if _get_cfg().database_url.startswith("sqlite"):
        import sqlite3
        db_path = _get_cfg().database_url.replace("sqlite:///", "")
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(membership_applications)")
            columns = {row[1] for row in cursor.fetchall()}
            if "consent_at" not in columns:
                cursor.execute("ALTER TABLE membership_applications ADD COLUMN consent_at DATETIME")
                logger.info("Added consent_at column")
            if "admin_decline_reason" not in columns:
                cursor.execute("ALTER TABLE membership_applications ADD COLUMN admin_decline_reason TEXT")
                logger.info("Added admin_decline_reason column")
            if "admin_approved_file" not in columns:
                cursor.execute("ALTER TABLE membership_applications ADD COLUMN admin_approved_file VARCHAR(500)")
                logger.info("Added admin_approved_file column")
            if "mitgliedsnummer" not in columns:
                cursor.execute("ALTER TABLE membership_applications ADD COLUMN mitgliedsnummer VARCHAR(50)")
                logger.info("Added mitgliedsnummer column")
            for col_name, col_type in [
                ("geschlecht", "VARCHAR(10)"),
                ("partner_vorname", "VARCHAR(100)"),
                ("partner_nachname", "VARCHAR(100)"),
                ("partner_geburtsdatum", "DATE"),
                ("partner_abteilungen", "TEXT"),
            ]:
                if col_name not in columns:
                    cursor.execute(f"ALTER TABLE membership_applications ADD COLUMN {col_name} {col_type}")
                    logger.info(f"Added {col_name} column")
            for col_name, col_type in [
                ("datenschutz_accepted", "BOOLEAN"),
                ("satzung_accepted", "BOOLEAN"),
                ("consent_ip", "VARCHAR(45)"),
                ("is_test", "BOOLEAN DEFAULT 0"),
                ("source", "VARCHAR(20) NOT NULL DEFAULT 'online'"),
                ("uploaded_file_ocr", "TEXT"),
            ]:
                if col_name not in columns:
                    cursor.execute(f"ALTER TABLE membership_applications ADD COLUMN {col_name} {col_type}")
                    logger.info(f"Added {col_name} column")
            # lw_members may pre-date the geocoding columns
            try:
                cursor.execute("PRAGMA table_info(lw_members)")
                lw_columns = {row[1] for row in cursor.fetchall()}
                for col_name, col_type in [
                    ("lat", "NUMERIC"),
                    ("lng", "NUMERIC"),
                    ("geocoded_at", "DATETIME"),
                    ("geocode_status", "VARCHAR(20)"),
                    ("geocode_precision", "VARCHAR(10)"),
                    ("geocode_notes", "TEXT"),
                    ("geocode_ignored", "BOOLEAN DEFAULT 0"),
                ]:
                    if lw_columns and col_name not in lw_columns:
                        cursor.execute(f"ALTER TABLE lw_members ADD COLUMN {col_name} {col_type}")
                        logger.info(f"Added lw_members.{col_name} column")
            except sqlite3.OperationalError:
                pass

            cursor.execute("PRAGMA table_info(app_settings)")
            settings_columns = {row[1] for row in cursor.fetchall()}
            if "admin_signature_base64" not in settings_columns:
                cursor.execute("ALTER TABLE app_settings ADD COLUMN admin_signature_base64 TEXT")
                logger.info("Added admin_signature_base64 column")
            if "club_config" not in settings_columns:
                cursor.execute("ALTER TABLE app_settings ADD COLUMN club_config TEXT")
                logger.info("Added club_config column")
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Migration check: {e}")

    # PostgreSQL: widen columns that were created too narrow in earlier deployments
    if not _get_cfg().database_url.startswith("sqlite"):
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ALTER COLUMN iban TYPE VARCHAR(500)"
                ))
                conn.execute(text(
                    "ALTER TABLE app_settings "
                    "ADD COLUMN IF NOT EXISTS admin_signature_base64 TEXT"
                ))
                conn.execute(text(
                    "ALTER TABLE app_settings "
                    "ADD COLUMN IF NOT EXISTS club_config TEXT"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS admin_decline_reason TEXT"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS admin_approved_file VARCHAR(500)"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS mitgliedsnummer VARCHAR(500)"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ALTER COLUMN mitgliedsnummer TYPE VARCHAR(500)"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS datenschutz_accepted BOOLEAN"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS satzung_accepted BOOLEAN"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS consent_ip VARCHAR(45)"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'online'"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ALTER COLUMN email DROP NOT NULL"
                ))
                conn.execute(text(
                    "ALTER TABLE membership_applications "
                    "ADD COLUMN IF NOT EXISTS uploaded_file_ocr TEXT"
                ))
                # lw_members geocoding columns (no-op if table absent or columns already exist)
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7)"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7)"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS geocode_status VARCHAR(20)"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS geocode_precision VARCHAR(10)"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS geocode_notes TEXT"
                ))
                conn.execute(text(
                    "ALTER TABLE lw_members "
                    "ADD COLUMN IF NOT EXISTS geocode_ignored BOOLEAN DEFAULT FALSE"
                ))
            logger.info("Widened iban column to VARCHAR(500)")
        except Exception as e:
            # Will fail with a benign error once the column is already wide enough
            logger.debug(f"iban column migration (expected after first run): {e}")

    # Encrypt any plaintext IBANs
    try:
        from app.services.crypto import encrypt_iban
        from sqlalchemy.orm import Session as _Sess
        from app.database import SessionLocal as _SL
        _db = _SL()
        from app.models.application import MembershipApplication as _MA
        plain_ibans = _db.query(_MA).filter(~_MA.iban.like("enc:%")).all()
        for row in plain_ibans:
            row.iban = encrypt_iban(row.iban)
        if plain_ibans:
            _db.commit()
            logger.info(f"Encrypted {len(plain_ibans)} plaintext IBANs")

        # Migrate old 'bearbeitet' status to 'genehmigt'
        old_status = _db.query(_MA).filter(_MA.status == "bearbeitet").all()
        for row in old_status:
            row.status = "genehmigt"
        if old_status:
            _db.commit()
            logger.info(f"Migrated {len(old_status)} 'bearbeitet' -> 'genehmigt'")

        _db.close()
    except Exception as e:
        logger.warning(f"IBAN encryption migration: {e}")

    logger.info("Database tables created")

    yield
    logger.info("Application shutting down")


settings = get_settings()

app = FastAPI(
    title="SVUMS - Vereins-Mitgliedschaft",
    version="1.0.0",
    docs_url="/api/docs" if not settings.cookie_secure else None,
    redoc_url="/api/redoc" if not settings.cookie_secure else None,
    openapi_url="/api/openapi.json" if not settings.cookie_secure else None,
    lifespan=lifespan,
)


# --- Middlewares ---

@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Log every HTTP request with method, path, status, and duration."""
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)

    # Skip noisy paths (health checks, static assets)
    path = request.url.path
    if path not in ("/api/health",) and not path.startswith("/assets"):
        logger.info(
            "%s %s %s (%.1fms)",
            request.method, path, response.status_code, duration_ms,
        )
    return response


_RATE_LIMITED_POST_PATHS = {
    "/api/apply": ("apply", 3, 600),
    "/api/upload-paper-form": ("upload_paper_form", 3, 600),
}


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Rate limit anonymous public POSTs by IP."""
    if request.method == "POST":
        config = _RATE_LIMITED_POST_PATHS.get(request.url.path)
        if config is not None:
            scope, limit, window = config
            db = SessionLocal()
            try:
                client_ip = normalize_client_ip(request.client.host if request.client else None)
                decision = consume_rate_limit(
                    db,
                    scope=scope,
                    key=client_ip,
                    limit=limit,
                    window_seconds=window,
                )
            finally:
                db.close()

            if not decision.allowed:
                logger.warning(
                    "Rate limit hit on %s from %s (retry_after=%ss)",
                    request.url.path, client_ip, decision.retry_after_seconds,
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut."
                    },
                )

    response = await call_next(request)
    return response


@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    """CSRF double-submit cookie validation for state-changing requests."""
    needs_csrf = False
    if request.method in ("POST", "PATCH", "DELETE", "PUT"):
        path = request.url.path
        if path == "/api/apply":
            needs_csrf = True
        elif path.startswith("/api/admin/") and path not in ("/api/admin/login", "/api/admin/logout"):
            needs_csrf = True

    if needs_csrf:
        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("x-csrf-token")
        if not cookie_token or not header_token or cookie_token != header_token:
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(
                "CSRF validation failed on %s %s from %s (cookie=%s, header=%s)",
                request.method, request.url.path,
                client_ip, bool(cookie_token), bool(header_token),
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Die Sitzung ist abgelaufen oder ungültig. Bitte laden Sie die Seite neu."},
            )
    response = await call_next(request)
    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com; "
        "font-src 'self'; "
        "connect-src 'self' https://*.basemaps.cartocdn.com; "
        "frame-src 'self' blob:; "
        "frame-ancestors 'self'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return response


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

# --- Routes ---

# CSRF token endpoint
@app.get("/api/csrf-token")
async def get_csrf_token(response: Response):
    token = secrets.token_hex(32)
    response.set_cookie(
        key="csrf_token",
        value=token,
        httponly=False,  # JS needs to read it
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=3600,
        path="/",
    )
    return {"csrf_token": token}


app.include_router(public.router)
app.include_router(address.router)
app.include_router(admin.router)
app.include_router(admin_imports.router)

# Serve static files (built frontend)
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA for any non-API route."""
        # Try to serve the exact file first
        file_path = (static_dir / full_path).resolve()
        static_root = static_dir.resolve()
        try:
            file_path.relative_to(static_root)
        except ValueError:
            logger.warning(f"Blocked path traversal attempt: {full_path}")
            return FileResponse(str(static_root / "index.html"))
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        # Fall back to index.html for SPA routing
        return FileResponse(str(static_root / "index.html"))
