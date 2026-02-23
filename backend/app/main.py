import logging
import secrets
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import Base, engine
from app.routers import admin, address, public

logger = logging.getLogger(__name__)

# Rate limiting storage
_rate_limit_store: dict[str, list[float]] = defaultdict(list)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
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
            cursor.execute("PRAGMA table_info(app_settings)")
            settings_columns = {row[1] for row in cursor.fetchall()}
            if "admin_signature_base64" not in settings_columns:
                cursor.execute("ALTER TABLE app_settings ADD COLUMN admin_signature_base64 TEXT")
                logger.info("Added admin_signature_base64 column")
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Migration check: {e}")

    # PostgreSQL: widen columns that were created too narrow in earlier deployments
    if not _get_cfg().database_url.startswith("sqlite"):
        try:
            with engine.begin() as conn:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE membership_applications "
                    "ALTER COLUMN iban TYPE VARCHAR(500)"
                ))
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE app_settings "
                    "ADD COLUMN IF NOT EXISTS admin_signature_base64 TEXT"
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
    title="SVUMS - SV Untereuerheim Mitgliedschaft",
    version="1.0.0",
    docs_url="/api/docs" if not settings.cookie_secure else None,
    redoc_url="/api/redoc" if not settings.cookie_secure else None,
    openapi_url="/api/openapi.json" if not settings.cookie_secure else None,
    lifespan=lifespan,
)


# --- Middlewares ---

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Rate limit on /api/apply — 3 requests per 10 minutes per IP."""
    if request.url.path == "/api/apply" and request.method == "POST":
        client_ip = request.headers.get("x-forwarded-for", request.client.host)
        now = time.time()
        window = 600  # 10 minutes
        max_requests = 3
        key = f"apply:{client_ip}"

        # Clean old entries
        _rate_limit_store[key] = [
            t for t in _rate_limit_store[key] if now - t < window
        ]

        if len(_rate_limit_store[key]) >= max_requests:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut."
                },
            )

        _rate_limit_store[key].append(now)

    response = await call_next(request)
    return response


@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    """CSRF double-submit cookie validation for /api/apply."""
    if request.url.path == "/api/apply" and request.method == "POST":
        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("x-csrf-token")
        if not cookie_token or not header_token or cookie_token != header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "Ungültiges CSRF-Token. Bitte laden Sie die Seite neu."},
            )
    response = await call_next(request)
    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
