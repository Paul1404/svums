# SVUMS - SV Untereuerheim Mitgliedschaft System

Online membership application system for Sportverein 1945 Untereuerheim e.V.

Applicants fill out a form and can either receive a PDF by email, print, sign,
and upload the signed document — or sign directly on-screen during submission.
The club admin reviews, approves, or declines each application through a
built-in admin panel.


## Features

**Public**

- Dynamic membership form (Einzel, Kind, Familie) with live fee calculation
- Address autocomplete (PLZ, Ort, Strasse) via German postal data
- IBAN validation with automatic BIC and bank name lookup
- PDF generation of the membership declaration (WeasyPrint)
- Email confirmation to applicant with PDF attachment
- **Inline digital signature** — applicant can sign on-screen before submitting;
  signed PDF is generated immediately and the application advances straight to
  "Dokument hochgeladen" status
- Upload page for signed documents (scan/photo) — the traditional alternative
- Public status page to track application progress by Antragsnummer

**Workflow — Option A (print/sign/upload)**

- Application submitted: status "Neu", unsigned PDF sent to applicant and club
- Applicant prints, signs, scans/photos, uploads via the upload link in the email
- Status auto-advances to "Dokument hochgeladen", confirmation email sent
- Admin sets "In Bearbeitung", "Genehmigt" (welcome email), or "Abgelehnt"

**Workflow — Option B (inline digital signature)**

- Applicant draws signature on-screen at the final step of the form
- On submit: signed PDF generated immediately, stored, and emailed to applicant
- Status is set to "Dokument hochgeladen" immediately (no upload step required)
- Admin receives notification with green "Online unterschrieben" badge
- All downstream emails and admin actions (resend, PDF download) are
  signature-aware: they re-use the stored signed PDF rather than regenerating
  an unsigned blank

**Admin Panel**

- Dashboard with search, filtering by status, and pagination
- Detail view per application with all personal, membership, and SEPA data
- Status management with notes
- PDF download (serves the signed PDF for online-signed applications) and
  uploaded document viewer
- Email resend button (sends correct email template for each signature flow)
- CSV export of all applications
- SMTP configuration and test email from the UI

**Security**

- CSRF protection (double-submit cookie) on form submission
- IBAN encryption at rest (Fernet AES, key derived from COOKIE_SECRET)
- Rate limiting on the submit endpoint (3 per 10 min per IP)
- Upload token expiry (30 days)
- Non-sequential, random Antragsnummer (prevents enumeration)
- Secure session cookies (HttpOnly, Secure, SameSite)
- Security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- Non-root container user


## Tech Stack

| Layer     | Technology                                                       |
|-----------|------------------------------------------------------------------|
| Backend   | Python 3.13, FastAPI 0.129, SQLAlchemy 2.0                      |
| Database  | Neon (serverless PostgreSQL)                                     |
| Storage   | Tigris object storage (S3-compatible) for uploaded/signed PDFs  |
| Frontend  | React 18, TypeScript, Vite 7, Tailwind CSS 3.4                  |
| Signature | react-signature-canvas (inline digital signing)                  |
| PDF       | WeasyPrint 68                                                    |
| Email     | aiosmtplib (async SMTP), Jinja2 HTML templates                   |
| Auth      | itsdangerous (signed session cookie)                             |
| Crypto    | cryptography (Fernet for IBAN encryption)                        |
| Hosting   | Fly.io (Frankfurt region), Docker multi-stage build              |


## Project Structure

```
svums/
  Dockerfile              Multi-stage build (Node frontend + Python backend)
  fly.toml                Fly.io deployment configuration
  backend/
    app/
      main.py             FastAPI app, middlewares, startup migrations
      config.py           Settings via environment variables
      database.py         SQLAlchemy engine and session
      models/             SQLAlchemy models (application, settings)
      routers/
        public.py         Form submission, fees, IBAN lookup, upload, status
        admin.py          Auth, CRUD, PDF, CSV export, SMTP settings
        address.py        PLZ/street autocomplete
      schemas/            Pydantic request/response models
      services/
        email.py          All email sending functions
        fees.py           Fee calculation logic
        pdf.py            PDF generation with WeasyPrint
        crypto.py         IBAN encrypt/decrypt (Fernet)
        storage.py        Tigris/S3 object storage (upload, download, delete)
      templates/
        beitrittserklaerung.html  PDF template (signature-aware)
        email.html                Admin notification email
        email_confirmation.html   Applicant confirmation (flow-aware)
        email_status.html         Status update emails
  frontend/
    src/
      App.tsx             Routes
      pages/
        ApplicationForm   Main membership form (incl. inline signature)
        Success           Post-submit confirmation (flow-aware)
        Upload            Signed document upload
        StatusPage        Public status lookup
        AdminLogin        Admin authentication
        AdminDashboard    Application list
        AdminApplicationDetail  Single application view
        AdminSettings     SMTP and app configuration
      services/api.ts     All API calls, CSRF token handling, formatFee utility
      context/            Admin auth context
```


## Deployment

The app is hosted on [Fly.io](https://fly.io) in the Frankfurt (`fra`) region.

### Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated
- A [Neon](https://neon.tech) PostgreSQL database
- Fly.io account

### Initial Setup (one-time)

```bash
# Create the Fly app
flyctl apps create svums --org personal

# Set required secrets
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  ADMIN_PASSWORD="your-secure-password" \
  COOKIE_SECRET="your-random-secret-min-32-chars"

# Provision Tigris object storage (sets S3 secrets automatically)
flyctl storage create -a svums
```

Generate a secure cookie secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Deploy

```bash
flyctl deploy
```

### Data Persistence

| Data | Where |
|------|-------|
| Applications, settings | Neon PostgreSQL (external, always persistent) |
| Uploaded signed documents | Tigris object storage (S3-compatible, always persistent) |
| Online-signed PDFs | Tigris object storage, key: `{antragsnummer}_signed.pdf` |

SMTP settings are stored in the `app_settings` table in Neon and survive
restarts and redeployments.

### Environment Variables / Secrets

| Name | How set | Description |
|------|---------|-------------|
| `DATABASE_URL` | `flyctl secrets set` | Neon connection string |
| `ADMIN_PASSWORD` | `flyctl secrets set` | Admin panel password |
| `COOKIE_SECRET` | `flyctl secrets set` | Session signing key (min 32 chars) |
| `AWS_ACCESS_KEY_ID` | auto (Tigris) | Set by `flyctl storage create` |
| `AWS_SECRET_ACCESS_KEY` | auto (Tigris) | Set by `flyctl storage create` |
| `AWS_ENDPOINT_URL_S3` | auto (Tigris) | Set by `flyctl storage create` |
| `AWS_REGION` | auto (Tigris) | Set by `flyctl storage create` |
| `BUCKET_NAME` | auto (Tigris) | Set by `flyctl storage create` |
| `CORS_ORIGINS` | `fly.toml [env]` | Allowed CORS origins |
| `COOKIE_SECURE` | `fly.toml [env]` | Set to `true` in production |
| `COOKIE_NAME` | `fly.toml [env]` | Session cookie name |

### First-Time Setup

1. Run `flyctl deploy`
2. Go to `https://svums.fly.dev/admin` (or your custom domain)
3. Log in with the password from `ADMIN_PASSWORD`
4. Navigate to Settings and configure SMTP (required for email delivery)


## Antrag-Workflow

```mermaid
flowchart TD
    START([Antragsteller ruft das Formular auf])
    START --> S0

    subgraph S0["Schritt 1 – Persönliche Daten & Mitgliedschaft"]
        direction TB
        P1[Geburtsdatum eingeben]
        P1 --> AGE{Alter am 1. Jan.?}

        AGE -->|"< 18 Jahre"| KIND["Antragstyp: Kind<br/>(Erziehungsberechtigte/r erforderlich)"]
        AGE -->|"≥ 18 Jahre"| ADULT[Erwachsener]

        ADULT --> FAM{"Kinder + 2. Elternteil<br/>angegeben?"}
        FAM -->|Ja| FAMILIE["Antragstyp: Familie<br/>96,– € / Jahr"]
        FAM -->|Nein| EINZEL[Antragstyp: Einzel]

        KIND --> KINDKAT{"Elternteil<br/>auch Mitglied?"}
        KINDKAT -->|"Ja – bis 14 J."| K1["12,– € / Jahr"]
        KINDKAT -->|"Nein – bis 14 J."| K2["24,– € / Jahr"]
        KINDKAT -->|"Ja – 14–18 J."| K3["24,– € / Jahr"]
        KINDKAT -->|"Nein – 14–18 J."| K4["36,– € / Jahr"]

        EINZEL --> EINZELKAT{"Altersgruppe<br/>am Stichtag?"}
        EINZELKAT -->|"bis 25 J."| E1["42,– € / Jahr"]
        EINZELKAT -->|"ab 25 J."| E2["54,– € / Jahr"]
    end

    S0 --> S1

    subgraph S1["Schritt 2 – SEPA-Lastschrift"]
        IBAN[IBAN eingeben]
        IBAN --> IBANVAL{IBAN gültig?}
        IBANVAL -->|Ja| AUTOFILL["BIC & Kreditinstitut<br/>automatisch befüllt"]
        IBANVAL -->|Nein| IBANFIX[Korrektur durch Antragsteller]
        IBANFIX --> AUTOFILL
    end

    S1 --> S2

    subgraph S2["Schritt 3 – Zusammenfassung & Unterschrift"]
        CONSENT[Datenschutz-Zustimmung]
        CONSENT --> SIGCHOICE{Unterschriftsmethode?}

        SIGCHOICE -->|"Option A (Standard)"| OPTSUB["Jetzt einreichen –<br/>später drucken & unterschreiben"]
        SIGCHOICE -->|"Option B"| OPTDRAW["Unterschrift auf dem<br/>Bildschirm zeichnen"]
        OPTDRAW --> CANVASVAL{"Unterschrift<br/>vorhanden?"}
        CANVASVAL -->|Nein| CANVASERR[Fehlermeldung]
        CANVASERR --> OPTDRAW
        CANVASVAL -->|Ja| OPTSIG["Antrag mit digitaler<br/>Unterschrift einreichen"]
    end

    OPTSUB --> SUBMIT_A
    OPTSIG --> SUBMIT_B

    subgraph SUBMIT_A["Einreichung – Option A"]
        SA1["Status: Neu"]
        SA2["E-Mail an Antragsteller:<br/>unsigniertes PDF + Upload-Link"]
        SA3["E-Mail an Verein:<br/>Neuer Antrag"]
        SA1 --> SA2 --> SA3
    end

    subgraph SUBMIT_B["Einreichung – Option B"]
        SB1["Signiertes PDF sofort erzeugt<br/>& gespeichert"]
        SB2["Status: Dokument hochgeladen"]
        SB3["E-Mail an Antragsteller:<br/>signiertes PDF als Anhang"]
        SB4["E-Mail an Verein:<br/>Neuer Antrag ✓ Online unterschrieben"]
        SB1 --> SB2 --> SB3 --> SB4
    end

    SA3 --> UPLOAD_STEP
    subgraph UPLOAD_STEP["Upload-Schritt (nur Option A)"]
        UL1[Antragsteller druckt & unterschreibt PDF]
        UL2["Scan/Foto über Upload-Link hochladen<br/>(Link aus E-Mail oder Erfolgsseite)"]
        UL3["Status: Dokument hochgeladen"]
        UL4["E-Mail an Antragsteller: Bestätigung"]
        UL5["E-Mail an Verein: Dokument eingegangen"]
        UL1 --> UL2 --> UL3 --> UL4 --> UL5
    end

    SB4 --> ADMIN_REVIEW
    UL5 --> ADMIN_REVIEW

    subgraph ADMIN_REVIEW["Admin-Prüfung"]
        AR1["Admin öffnet Antrag im Dashboard"]
        AR2["Status: In Bearbeitung"]
        AR3{Entscheidung}
        AR1 --> AR2 --> AR3
    end

    AR3 -->|Genehmigen| APPROVED
    AR3 -->|Ablehnen| DECLINED

    subgraph APPROVED["Genehmigt"]
        AP1["Status: Genehmigt"]
        AP2["E-Mail an Antragsteller:<br/>Willkommen im Verein!"]
        AP1 --> AP2
    end

    subgraph DECLINED["Abgelehnt"]
        DC1["Status: Abgelehnt"]
        DC2["E-Mail an Antragsteller:<br/>Ablehnung"]
        DC1 --> DC2
    end

    AP2 --> DONE([Mitglied ✓])
    DC2 --> CLOSED([Antrag abgeschlossen])
```

Der Bearbeitungsstand kann jederzeit unter `/status` mit der Antragsnummer
abgefragt werden (in jeder E-Mail enthalten).


## Fee Formatting

All fee amounts across the application (form, calculator, summary, admin panel,
and emails) use a consistent German locale format via the `formatFee` utility:

- Whole euro amounts: `54,– €`
- Amounts with cents: `54,50 €`

The utility handles Pydantic v2's serialisation of Python `Decimal` fields as
JSON strings (e.g. `"54.00"`).


## API Endpoints

### Public

| Method | Path                        | Description                     |
|--------|-----------------------------|---------------------------------|
| GET    | /api/health                 | Health check                    |
| GET    | /api/csrf-token             | Get CSRF token (sets cookie)    |
| POST   | /api/apply                  | Submit membership application   |
| GET    | /api/fees/calculate         | Calculate membership fee        |
| GET    | /api/iban/lookup            | Validate IBAN, get BIC and bank |
| GET    | /api/address/plz/{plz}      | Lookup city by PLZ              |
| GET    | /api/address/streets        | Street autocomplete             |
| GET    | /api/status/{antragsnummer} | Public status lookup            |
| GET    | /api/upload/{token}         | Get upload info                 |
| POST   | /api/upload/{token}         | Upload signed document          |

### Admin (requires session cookie)

| Method | Path                                       | Description                         |
|--------|--------------------------------------------|-------------------------------------|
| POST   | /api/admin/login                           | Admin login                         |
| POST   | /api/admin/logout                          | Admin logout                        |
| GET    | /api/admin/me                              | Check authentication                |
| GET    | /api/admin/applications                    | List applications                   |
| GET    | /api/admin/applications/{id}               | Get single application              |
| PATCH  | /api/admin/applications/{id}               | Update status/notes                 |
| DELETE | /api/admin/applications/{id}               | Delete application                  |
| POST   | /api/admin/applications/{id}/resend-email  | Resend emails (flow-aware)          |
| GET    | /api/admin/applications/{id}/pdf           | Download PDF (signed if applicable) |
| GET    | /api/admin/applications/{id}/upload        | View uploaded document              |
| GET    | /api/admin/export                          | CSV export                          |
| GET    | /api/admin/settings                        | Get app settings                    |
| PUT    | /api/admin/settings                        | Update app settings                 |
| POST   | /api/admin/settings/test-smtp              | Send test email                     |


## Inline Signature — Implementation Notes

The inline signature feature (`react-signature-canvas`) was added as an
alternative to the print/sign/upload flow. Key implementation details:

**Frontend (`ApplicationForm.tsx`)**
- `SignatureCanvas` is rendered in a container tracked by `ResizeObserver`,
  which keeps the canvas's internal pixel dimensions in sync with its CSS width.
  This prevents the touch-coordinate offset bug on mobile (where a fixed-size
  canvas scaled by CSS causes strokes to appear at the wrong position).
- Canvas clears itself on resize to prevent distorted signatures.
- The `touch-none` Tailwind class prevents scroll/zoom gestures interfering
  with drawing on mobile.
- The confirmation text ("Mit meiner Unterschrift erkläre ich...") is always
  visible above the canvas and cannot be skipped.
- On submit, `getTrimmedCanvas().toDataURL("image/png")` captures the signature
  as a base64 data URL, which is included in the JSON payload to the backend.

**Backend (`public.py`, `admin.py`)**
- `ApplicationCreate` schema accepts `unterschrift_base64: Optional[str] = None`.
- On submission with a signature: a signed PDF is generated, uploaded to Tigris
  under the key `{antragsnummer}_signed.pdf`, and the application status is set
  to `dokument_hochgeladen` immediately.
- The `_signed.pdf` filename suffix is used as the persistent signal that an
  application was signed online. This allows the email resend and admin PDF
  download endpoints to detect the signed status without storing the base64
  in the database.
- The resend-email and download-PDF endpoints retrieve the stored signed PDF
  from Tigris rather than regenerating an unsigned blank form.
- All file I/O (upload, download, delete) goes through `services/storage.py`,
  which wraps the Tigris S3-compatible API via boto3.

**Email templates**
- All templates receive a `signed_online` boolean.
- `email_confirmation.html` (applicant): shows a green "Antrag vollständig"
  card with 2 steps for Option B, or the red "print/sign/upload" card with
  upload button for Option A.
- `email.html` (admin notification): shows a green "Online unterschrieben –
  kein Upload erforderlich" badge in the header for Option B applications.
- `beitrittserklaerung.html` (PDF): conditionally embeds the base64 signature
  image in both signature fields, and replaces the "Nächste Schritte" upload
  instructions with a "Antrag vollständig" green box.


## Development

For local development without Docker:

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
ADMIN_PASSWORD=dev COOKIE_SECRET=dev-secret-key-at-least-32-chars \
  COOKIE_SECURE=false CORS_ORIGINS=http://localhost:5173 \
  uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The frontend dev server runs on port 5173 and proxies `/api` to the backend
(configured in `vite.config.ts`).


## License

Internal project for Sportverein 1945 Untereuerheim e.V. Not licensed for
external use.
