# SVUMS — Club Membership System

**A full-stack membership application system for German sports clubs (Sportvereine).** Built with FastAPI, React, and TypeScript — handles everything from multi-step application forms and digital signatures to PDF generation, email notifications, and an admin dashboard.

Originally built for a local sports club, now open-source and configurable for any club.

---

## Features

- **Multi-step application forms** — Individual, child, and family memberships with automatic fee calculation
- **Digital signatures** — Sign on-screen or print/scan/upload the classic way
- **Admin dashboard** — Review, approve (with countersignature), or decline applications
- **PDF generation** — Membership applications, approval letters, and cancellation confirmations (WeasyPrint)
- **Email notifications** — Automatic emails at every status change with PDF attachments
- **Fully configurable** — Club name, address, fees, departments, branding, SEPA details — all editable via admin panel at runtime
- **IBAN encryption** — Bank data encrypted at rest (Fernet AES)
- **CSRF protection + rate limiting** — Production-ready security
- **Address autocomplete** — German PLZ/street lookup via OpenStreetMap Nominatim
- **SEPA mandate generation** — Creditor ID, mandate reference, full SEPA form in PDF

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.14, FastAPI, SQLAlchemy 2.0, Uvicorn |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Database | PostgreSQL (recommended) or SQLite |
| File Storage | Any S3-compatible service (Tigris, MinIO, AWS S3) |
| PDF | WeasyPrint (HTML → PDF via Jinja2) |
| Email | aiosmtplib (async SMTP) with HTML templates |
| Container | Docker multi-stage build |

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/paul1404/svums.git
cd svums
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD and COOKIE_SECRET at minimum
docker compose up -d
```

Open **http://localhost:8000** — the application form is at `/`, the admin panel at `/admin`.

### Local Development

```bash
# One-time setup
make setup

# Start backend (port 8000) and frontend (port 5173) in separate terminals
make backend
make frontend

# Run tests
make test
```

The frontend dev server proxies `/api` requests to the backend. Admin password is whatever you set in `ADMIN_PASSWORD` (or `dev` with the Makefile defaults).

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | Yes | — | Admin panel login password |
| `COOKIE_SECRET` | Yes | — | Session signing + IBAN encryption key (min 24 chars) |
| `DATABASE_URL` | No | SQLite | PostgreSQL connection string for production |
| `PUBLIC_BASE_URL` | No | `http://localhost:8000` | Public URL used in email links |
| `AWS_*`, `BUCKET_NAME` | No | — | S3-compatible storage for file uploads |
| `POSTHOG_KEY` | No | — | Optional analytics |

See [`.env.example`](.env.example) for the full list.

### Club Settings (Admin Panel)

All club-specific settings are configurable at runtime through the admin panel — no code changes needed:

- **Identity** — Club name, abbreviation, city, address, website
- **Contact** — Chairman/contact person name, role, phone, email
- **Legal** — Court of registration, registration number, tax ID, privacy/bylaws/imprint URLs
- **SEPA** — Creditor ID, mandate reference prefix
- **Fees** — Complete fee schedule (categories, amounts, labels)
- **Departments** — List of available departments/sections
- **Branding** — Primary colors
- **Email** — Subject line prefix

These are stored in the database and served to both the frontend and PDF/email templates.

**API endpoint:** `GET /api/club-config` (public) · `PUT /api/admin/club-config` (admin)

### Production Deployment (Traefik + HTTPS)

For production with Traefik reverse proxy and automatic HTTPS:

```bash
cp .env.example .env
# Fill in all production values including PUBLIC_BASE_URL, DATABASE_URL, etc.
docker compose -f docker-compose.prod.yml up -d
```

See [`docker-compose.prod.yml`](docker-compose.prod.yml) for the Traefik configuration.

## Architecture

```
svums/
  Dockerfile              Multi-stage build (Node frontend → Python backend)
  docker-compose.yml      Simple standalone setup
  docker-compose.prod.yml Traefik + HTTPS production setup
  backend/
    app/
      main.py             FastAPI app, middlewares, startup migrations
      config.py           Environment variable settings (Pydantic)
      models/             SQLAlchemy models (Application, Settings, etc.)
      routers/            API routes — public, admin, address
      schemas/            Pydantic request/response schemas + ClubConfig
      services/           Business logic — email, PDF, fees, crypto, storage
      templates/          Jinja2 HTML templates for PDFs and emails
    tests/                pytest test suite
  frontend/
    src/
      pages/              React page components
      context/            React contexts (Auth, ClubConfig)
      services/api.ts     API client with CSRF handling
```

### Key Patterns

- **Club config** — All club-specific values stored as JSON in the database, validated by Pydantic, served via API
- **Database migrations** — Auto-run at startup (`CREATE TABLE` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`)
- **CSRF** — Double-submit cookie pattern on state-changing endpoints
- **IBAN encryption** — Fernet AES at rest, plaintext auto-encrypted on startup
- **Rate limiting** — DB-backed, 3 requests per 10 min on the application endpoint
- **SPA serving** — FastAPI serves the built React frontend, catch-all route for client-side routing

## License

MIT

---

# Deutsche Version

## SVUMS — Vereins-Mitgliedschaftssystem

**Ein vollständiges Mitgliedschaftsantrags-System für deutsche Sportvereine.** Gebaut mit FastAPI, React und TypeScript — von mehrstufigen Antragsformularen und digitalen Unterschriften bis hin zu PDF-Erzeugung, E-Mail-Benachrichtigungen und einem Admin-Dashboard.

### Schnellstart mit Docker

```bash
git clone https://github.com/paul1404/svums.git
cd svums
cp .env.example .env
# .env bearbeiten — mindestens ADMIN_PASSWORD und COOKIE_SECRET setzen
docker compose up -d
```

Öffne **http://localhost:8000** — Antragsformular unter `/`, Admin-Panel unter `/admin`.

### Anpassung für deinen Verein

Alle vereinsspezifischen Einstellungen sind über das Admin-Panel konfigurierbar:

- Vereinsname, Adresse, Kontaktdaten
- Beitragsstruktur und Abteilungen
- SEPA-Gläubiger-ID und Mandatsreferenz-Präfix
- Rechtliche Angaben (Registergericht, Steuernummer, Links zu Datenschutz/Satzung/Impressum)
- Branding-Farben

Kein Code muss geändert werden — einfach deployen und im Admin-Panel konfigurieren.

### Lokale Entwicklung

```bash
make setup      # Einmalig: venv + node_modules installieren
make backend    # Backend starten (Port 8000)
make frontend   # Frontend starten (Port 5173)
make test       # Tests ausführen
```

### Funktionen

- Mehrstufige Formulare (Einzel, Kind, Familie) mit automatischer Beitragsberechnung
- Digitale Unterschrift am Bildschirm oder klassisch: ausdrucken, unterschreiben, hochladen
- Admin-Dashboard mit Genehmigung (mit Gegenzeichnung) oder Ablehnung
- PDF-Erzeugung (Beitrittserklärung, Genehmigung, Kündigungsbestätigung)
- Automatische E-Mail-Benachrichtigungen bei jedem Statuswechsel
- IBAN-Verschlüsselung, CSRF-Schutz, Rate-Limiting
- PLZ-basierte Adress-Vervollständigung
