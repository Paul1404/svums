# CLAUDE.md — LLM Onboarding

## What is this?

SVUMS (SV Untereuerheim Mitgliedschaft System) — online membership application system for a German sports club (Sportverein 1945 Untereuerheim e.V.). Applicants fill out a form, optionally sign digitally, and the club admin reviews/approves/declines through an admin panel.

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
# Backend (local dev)
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
ALLOW_INSECURE_DEFAULTS=true ADMIN_PASSWORD=dev COOKIE_SECRET=dev-secret-key-at-least-32-chars \
  COOKIE_SECURE=false CORS_ORIGINS=http://localhost:5173 \
  PUBLIC_BASE_URL=http://localhost:5173 \
  uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # runs on port 5173, proxies /api → localhost:8000

# Tests
cd backend && pytest

# Docker build
docker build -t svums .
```

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
        posthog.py        Analytics events
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

## Deployment

Deployed on Railway from Dockerfile. The entrypoint reads `$PORT` (default 8000). Health check at `/api/health`. All secrets configured via Railway dashboard environment variables.
