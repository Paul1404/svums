# CLAUDE.md — LLM Onboarding

## What is this?

SVUMS — open-source online membership application system for German sports clubs (Sportvereine). Applicants fill out a form, optionally sign digitally, and the club admin reviews/approves/declines through an admin panel. All club-specific settings (name, fees, departments, SEPA, branding) are configurable via the admin panel at runtime.

**All UI text and error messages are in German.**

## Tech Stack

- **Backend**: Python 3.14, FastAPI, SQLAlchemy 2.0, Uvicorn
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4
- **Database**: Neon (serverless PostgreSQL) in production; SQLite for local dev
- **Storage**: Tigris (S3-compatible) via boto3 for PDFs and uploads
- **PDF**: WeasyPrint (HTML → PDF via Jinja2 templates)
- **Email**: aiosmtplib (async SMTP) with Jinja2 HTML templates
- **Deployment**: Railway, Docker multi-stage build

## Quick Commands

```bash
# One-time setup (or run anytime — idempotent)
make setup           # installs backend venv + frontend node_modules

# Development
make backend         # start backend on :8000 (env vars pre-set)
make frontend        # start frontend on :5173 (proxies /api → :8000)
make test            # run backend pytest (quick, -x stops on first failure)
make test-v          # verbose test output
make lint            # TypeScript type-check
make build           # production frontend build

# Manual alternative (without Make)
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
ALLOW_INSECURE_DEFAULTS=true ADMIN_PASSWORD=dev COOKIE_SECRET=dev-secret-key-at-least-32-chars \
  COOKIE_SECURE=false CORS_ORIGINS=http://localhost:5173 \
  PUBLIC_BASE_URL=http://localhost:5173 \
  uvicorn app.main:app --reload --port 8000

cd frontend
npm install
npm run dev          # runs on port 5173, proxies /api → localhost:8000

# Docker build
docker build -t svums .
```

## Claude Code Environment

A `SessionStart` hook in `.claude/settings.json` auto-runs `scripts/dev-setup.sh` when a new session begins. This ensures the venv, node_modules, and data directory are ready before any work starts.

**What the hook sets up:**
- `backend/venv/` — Python virtual environment with all deps
- `frontend/node_modules/` — npm packages
- `backend/data/` — directory for local SQLite database

**Running tests in Claude Code sessions:**
```bash
make test                          # quick run, stops on first failure
make test ARGS="-k test_legacy"    # run specific tests
make test ARGS="--tb=short"        # shorter tracebacks
```

**Known environment notes:**
- The project targets Python 3.14 but the Claude Code environment may have an older Python (3.11+). This is fine — no 3.14-specific syntax is used.
- WeasyPrint requires system libraries (`libpango`, `libcairo`, etc.). These may not be available in all environments — PDF generation tests may be skipped. The rest of the app works without them.
- S3/Tigris storage is optional locally. Without `AWS_*` env vars, file upload/download features are no-ops.
- The `ALLOW_INSECURE_DEFAULTS=true` flag is already set by the Makefile and test conftest — no need to export it manually.

## Project Structure

```
svums/
  Dockerfile              Multi-stage build (Node frontend + Python backend)
  docker-compose.yml      Local deployment with Traefik reverse proxy
  CLAUDE.md               This file
  backend/
    entrypoint.sh         Production server (uvicorn, reads $PORT)
    requirements.txt
    tests/                pytest tests
    app/
      main.py             FastAPI app, middlewares, startup migrations
      config.py           All settings via environment variables (Pydantic Settings)
      database.py         SQLAlchemy engine and session factory
      models/             SQLAlchemy models
        application.py      MembershipApplication
        settings.py         AppSettings (SMTP config, admin signature)
        cancellation_letter.py
        email_log.py
        rate_limit.py
      routers/
        public.py         Form submission, fees, IBAN lookup, upload, status, health check
        admin.py          Auth, CRUD, PDF download, CSV export, SMTP settings, approval/denial
        address.py        PLZ/street autocomplete
      schemas/            Pydantic request/response models
      services/
        email.py          All email sending
        fees.py           Fee calculation logic
        pdf.py            PDF generation (WeasyPrint)
        crypto.py         IBAN encrypt/decrypt (Fernet, key from COOKIE_SECRET)
        storage.py        S3/Tigris object storage (upload, download, delete)
        urls.py           Public URL builder (uses PUBLIC_BASE_URL)
        rate_limit.py     DB-backed rate limiter
      templates/          Jinja2 HTML templates for PDFs and emails
  frontend/
    src/
      App.tsx             Routes
      pages/              React page components
      services/api.ts     All API calls, CSRF handling
      context/            Admin auth context
```

## Key Patterns

- **Configuration**: All env vars defined in `backend/app/config.py` via `pydantic-settings`. Access via `get_settings()` (cached).
- **Database migrations**: Auto-run at startup in `main.py` lifespan handler. No Alembic — uses `CREATE TABLE` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- **CSRF**: Double-submit cookie pattern on `/api/apply`. Token issued at `/api/csrf-token`.
- **IBAN encryption**: Fernet AES at rest, key derived from `COOKIE_SECRET`. Plaintext IBANs auto-encrypted on startup.
- **Rate limiting**: DB-backed, 3 requests per 10 min per IP on `/api/apply`.
- **File storage**: All uploads/downloads through `services/storage.py` wrapping boto3 S3 client. Files stored in Tigris bucket.
- **PDF generation**: WeasyPrint renders Jinja2 HTML templates. Signature-aware — reuses stored signed PDFs instead of regenerating.
- **SPA serving**: FastAPI serves built frontend from `backend/static/` directory. Catch-all route returns `index.html` for client-side routing.

## Important Environment Variables

| Variable | Local Dev | Description |
|---|---|---|
| `ALLOW_INSECURE_DEFAULTS` | `true` | Bypasses password/secret/DB safety checks |
| `ADMIN_PASSWORD` | any string | Admin panel login password |
| `COOKIE_SECRET` | min 24 chars | Session signing + IBAN encryption key |
| `DATABASE_URL` | `sqlite:///./data/svums.db` (default) | PostgreSQL URI in production |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | Used in emails and generated links |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `COOKIE_SECURE` | `false` | Set `true` in production (HTTPS) |
| `AWS_*`, `BUCKET_NAME` | optional locally | S3/Tigris credentials for file storage |
| `HERE_API_KEY` | optional locally | HERE Geocoding API key. Required for the member map; without it the geocoder refuses to start. Sign up at developer.here.com (freemium, no card). |

## Deployment

Deployed on Railway from Dockerfile. The entrypoint reads `$PORT` (default 8000). Health check at `/api/health`. All secrets configured via Railway dashboard environment variables.
