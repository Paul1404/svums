# SVUMS

Membership application system for German sports clubs (Sportvereine).
Applicants fill out a form online, sign digitally or on paper, and the club
admin processes everything from a web dashboard. Originally written for one
local club, then opened up so anyone can deploy it for theirs.

The whole UI is in German. Club name, address, fees, departments, SEPA
details, branding colors etc. are configured at runtime through the admin
panel, so no code changes are needed to set it up for a different club.

## What it does

For applicants:

- Three-step form: personal data, banking (IBAN with checksum validation
  and BIC lookup), then signature and consent.
- Picks the membership category from the date of birth (child, youth, young
  adult, adult, family) and calculates the annual fee.
- Family applications can include a partner and any number of children,
  each with their own departments.
- Two ways to sign: draw or upload the signature in the browser, or get the
  PDF by email and upload it back signed (link is valid for 30 days).
- Status page at `/status?nr=ANT-...` showing where the application is
  (received, document received, in review, approved/declined).
- Address autocomplete via OpenStreetMap Nominatim (PLZ → towns, street
  search).
- Duplicate check on name + date of birth before submitting.

For the club admin:

- Dashboard with stats: totals, breakdowns by status, department, age,
  membership type, gender, current month, approved revenue.
- List view with search, status filter, pagination, and a toggle to hide
  test applications.
- Application detail view: edit fields and notes, change status, approve
  with countersignature plus member number, decline with a reason that gets
  emailed to the applicant.
- Generated PDFs: membership application, approval page (merged onto the
  application), cancellation letter (Kündigungsbestätigung) with optional
  family members and a separate payer address.
- File handling: download the original or approved PDF, upload a document
  on behalf of the applicant, delete files.
- CSV export (semicolon-delimited, German headers, IBANs decrypted).
- Email log showing every send with type, recipient, status, and any error.
- Built-in test data generator for development.
- SMTP settings, notification address, and a stored admin signature are all
  edited from the panel; there's a test-send button.

Behind the scenes:

- IBANs are encrypted at rest with Fernet (key derived from `COOKIE_SECRET`).
  Plaintext rows are encrypted automatically on startup.
- CSRF protection on state-changing endpoints (double-submit cookie).
- Rate limit on the public application endpoint (3 per 10 min per IP) and
  on admin login (5 attempts per 15 min, 30 min lockout).
- Mandate reference and Antragsnummer are generated automatically.
- Client-side Umami analytics on form events. PII fields (names, email,
  IBAN, addresses, etc.) are stripped from custom events before they leave
  the browser.
- Optional S3-compatible storage (Tigris, MinIO, AWS S3) for uploaded and
  generated PDFs. Without it, file features are no-ops; everything else
  still works.

## Stack

| Layer        | Technology                                            |
|--------------|-------------------------------------------------------|
| Backend      | Python 3.14, FastAPI, SQLAlchemy 2.0, Uvicorn         |
| Frontend     | React 19, TypeScript, Vite, Tailwind CSS 4            |
| Database     | PostgreSQL in production, SQLite for local dev        |
| File storage | Any S3-compatible service (optional)                  |
| PDF          | WeasyPrint, rendered from Jinja2 HTML templates       |
| Email        | aiosmtplib (async SMTP), Jinja2 HTML templates        |
| Container    | Docker multi-stage build                              |

## Running it

### With Docker Compose

```bash
git clone https://github.com/paul1404/svums.git
cd svums
cp .env.example .env
# Edit .env. At minimum set ADMIN_PASSWORD and COOKIE_SECRET.
docker compose up -d
```

The app comes up on http://localhost:8000. Form is at `/`, admin panel at
`/admin`, public status lookup at `/status`.

For production with Traefik and HTTPS:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Local development

```bash
make setup          # creates the venv and installs node_modules
make backend        # backend on :8000
make frontend       # frontend on :5173 (proxies /api → :8000)
make test           # backend tests
make lint           # TypeScript type-check
```

The frontend dev server proxies `/api` to the backend, so use port 5173 in
your browser. With the Makefile defaults the admin password is `dev`.

## Configuration

Most things are configured at runtime through the admin panel. Only a small
set of values has to come from the environment:

| Variable                | Required | Default                 | Notes                                                  |
|-------------------------|----------|-------------------------|--------------------------------------------------------|
| `ADMIN_PASSWORD`        | yes      | —                       | Admin login password.                                  |
| `COOKIE_SECRET`         | yes      | —                       | Min 24 chars. Signs sessions and encrypts IBANs.       |
| `DATABASE_URL`          | no       | local SQLite            | PostgreSQL URI in production.                          |
| `PUBLIC_BASE_URL`       | no       | `http://localhost:8000` | Used when building links in emails.                    |
| `CORS_ORIGINS`          | no       | —                       | Comma-separated list of allowed origins.               |
| `COOKIE_SECURE`         | no       | `true`                  | Set to `false` for plain HTTP local dev.               |
| `AWS_*`, `BUCKET_NAME`  | no       | —                       | S3-compatible storage. Disable to skip uploads.        |

The full list with explanations is in [`.env.example`](.env.example).

In the admin panel under Vereinseinstellungen you can edit:

- Club name and short name, city, postal address, website
- Contact person (name, role, phone, email)
- Legal info: court of registration, registration number, tax ID, links to
  privacy policy, bylaws, and imprint
- SEPA creditor ID and mandate reference prefix
- Fee schedule and the list of departments
- Primary brand color
- Subject prefix for outgoing emails

These are stored as JSON in the `app_settings` row, validated with Pydantic,
and served to both the frontend (`GET /api/club-config`) and the
PDF/email templates.

## Layout

```
svums/
  Dockerfile
  docker-compose.yml         simple standalone setup
  docker-compose.prod.yml    Traefik + HTTPS
  backend/
    app/
      main.py                FastAPI app, middlewares, startup migrations
      config.py              env-driven settings (Pydantic)
      database.py            SQLAlchemy engine + session
      models/                Application, AppSettings, EmailLog,
                             CancellationLetter, RateLimitBucket
      routers/               public, admin, address
      schemas/               request/response shapes incl. ClubConfig
      services/              email, pdf, fees, crypto, storage, urls,
                             rate_limit
      templates/             Jinja2 HTML for PDFs and emails
    tests/                   pytest suite
  frontend/
    src/
      App.tsx                routes
      pages/                 form, success, upload, status, admin pages
      context/               auth and club-config providers
      services/api.ts        API client with CSRF handling
```

A few things worth knowing if you start poking around:

- There is no Alembic. Schema changes happen at startup via plain
  `CREATE TABLE` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- The built React bundle is served by FastAPI from `backend/static/`.
  A catch-all route returns `index.html` so client-side routing works.
- WeasyPrint needs system libraries (`libpango`, `libcairo`, ...). They are
  installed in the Docker image; if you skip them locally, PDF generation
  will fail but everything else still runs.
- All UI strings, PDF templates, and email templates are German. There is
  no i18n layer.

## License

MIT.

---

# Deutsche Version

## SVUMS — Mitgliedschaftssystem für Sportvereine

Online-Mitgliedschaftsantrag für deutsche Sportvereine. Antragsteller füllen
ein Formular aus, unterschreiben digital oder auf Papier, und der Verein
bearbeitet alles über ein Admin-Panel. Ursprünglich für einen einzelnen
Verein geschrieben und inzwischen so verallgemeinert, dass jeder Verein es
ohne Codeänderungen selbst betreiben kann.

### Was es kann

Für Antragsteller:

- Dreistufiges Formular: Persönliche Daten, SEPA, Unterschrift und
  Einwilligungen.
- Beitragskategorie und Jahresbeitrag werden automatisch aus dem
  Geburtsdatum bestimmt (Kind, Jugendliche, junge Erwachsene, Erwachsene,
  Familie).
- Familienanträge mit Partner und beliebig vielen Kindern, jeweils mit
  eigenen Abteilungen.
- Zwei Unterschriftswege: direkt im Browser zeichnen oder hochladen, oder
  PDF per E-Mail erhalten und unterschrieben zurück hochladen
  (Link 30 Tage gültig).
- Statusseite unter `/status?nr=ANT-...` mit Fortschrittsanzeige.
- PLZ- und Straßen-Vervollständigung über OpenStreetMap Nominatim.
- Doppel-Antrags-Prüfung über Name plus Geburtsdatum.

Für die Vereinsverwaltung:

- Übersichts-Dashboard mit Auswertungen nach Status, Abteilung, Alter,
  Mitgliedschaftstyp, Geschlecht, Monat und genehmigtem Beitragsvolumen.
- Antragsliste mit Suche, Status-Filter, Paginierung und Filter für
  Test-Anträge.
- Antragsdetail: bearbeiten, Status ändern, genehmigen mit
  Gegenzeichnung und Mitgliedsnummer, ablehnen mit Begründung
  (geht per E-Mail an den Antragsteller).
- Erzeugte PDFs: Beitrittserklärung, Genehmigungsseite (wird hinten
  angehängt), Kündigungsbestätigung mit optionalen Familienmitgliedern und
  abweichendem Zahler.
- CSV-Export (Semikolon, deutsche Spaltennamen, IBANs entschlüsselt).
- E-Mail-Protokoll mit Empfänger, Betreff, Status und Fehlermeldung.
- SMTP-Einstellungen, Benachrichtigungs-E-Mail und gespeicherte
  Admin-Unterschrift im Panel pflegbar; Testversand inklusive.

Im Hintergrund:

- IBANs werden mit Fernet verschlüsselt gespeichert. Klartext-Werte werden
  beim Start automatisch verschlüsselt.
- CSRF-Schutz, Rate-Limit auf dem Antrags-Endpoint und beim Admin-Login.
- Client-seitige Umami-Analyse mit hartem PII-Filter.
- Optionaler S3-kompatibler Speicher (Tigris, MinIO, AWS S3) für PDFs.

### Schnellstart mit Docker

```bash
git clone https://github.com/paul1404/svums.git
cd svums
cp .env.example .env
# .env bearbeiten — mindestens ADMIN_PASSWORD und COOKIE_SECRET setzen
docker compose up -d
```

Anwendung unter http://localhost:8000.

### Anpassung für deinen Verein

Über das Admin-Panel konfigurierbar (kein Deployment nötig):

- Vereinsname, Adresse, Kontaktdaten
- Beiträge und Abteilungen
- SEPA-Gläubiger-ID und Mandatsreferenz-Präfix
- Rechtliche Angaben und Links zu Datenschutz, Satzung, Impressum
- Branding-Farben

### Lokale Entwicklung

```bash
make setup
make backend     # Port 8000
make frontend    # Port 5173
make test
```
