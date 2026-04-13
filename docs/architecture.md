# Architektur & Patterns

## Tech Stack im Detail

| Layer | Technologie | Warum |
|---|---|---|
| Backend | Python 3.14, FastAPI 0.135, SQLAlchemy 2.0 | Async, schnell, gute Type-Hints |
| Datenbank | Neon (Serverless PostgreSQL) | Kein DB-Server noetig, skaliert automatisch |
| Storage | Tigris (S3-kompatibel) via boto3 | Fuer PDFs und hochgeladene Dokumente |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4 | Moderner Standard-Stack |
| Signatur | react-signature-canvas | Touch-faehiges Unterschreiben im Browser |
| PDF | WeasyPrint 68 | HTML-Templates direkt zu PDF rendern |
| E-Mail | aiosmtplib + Jinja2 | Async SMTP, HTML-Templates |
| Auth | itsdangerous (Signed Session Cookie) | Einfach, kein JWT-Overhead |
| Crypto | cryptography (Fernet) | AES-Verschluesselung fuer IBANs |
| Hosting | Railway + Docker Multi-Stage | Push-to-deploy |

## Projekt-Struktur

```
svums/
  Dockerfile              Multi-stage Build (Node Frontend + Python Backend)
  docker-compose.yml      Lokales Setup mit Traefik Reverse Proxy
  backend/
    entrypoint.sh         Production-Server (uvicorn, liest $PORT)
    requirements.txt
    tests/                pytest Tests
    app/
      main.py             FastAPI App, Middlewares, Startup-Migrationen
      config.py           Alle Settings via Umgebungsvariablen (Pydantic Settings)
      database.py         SQLAlchemy Engine und Session Factory
      models/
        application.py      MembershipApplication
        settings.py         AppSettings (SMTP-Config, Admin-Signatur)
        cancellation_letter.py
        email_log.py
        rate_limit.py
      routers/
        public.py         Formular, Gebuehren, IBAN, Upload, Status, Health
        admin.py          Auth, CRUD, PDF, CSV, SMTP, Genehmigung/Ablehnung
        address.py        PLZ/Strassen-Autocomplete
      schemas/            Pydantic Request/Response Models
      services/
        email.py          E-Mail-Versand
        fees.py           Beitragsberechnung
        pdf.py            PDF-Erzeugung (WeasyPrint)
        crypto.py         IBAN Ver-/Entschluesselung (Fernet)
        storage.py        S3/Tigris Storage (Upload, Download, Delete)
        urls.py           URL-Builder (nutzt PUBLIC_BASE_URL)
        posthog.py        Analytics Events
        rate_limit.py     DB-basiertes Rate-Limiting
      templates/          Jinja2 HTML-Templates fuer PDFs und E-Mails
  frontend/
    src/
      App.tsx             Routing
      pages/
        ApplicationForm   Antragsformular (inkl. Inline-Signatur)
        Success           Bestaetigung nach Einreichung
        Upload            Upload fuer unterschriebenes Dokument
        StatusPage        Oeffentliche Status-Abfrage
        AdminLogin        Admin-Anmeldung
        AdminDashboard    Antragsliste
        AdminApplicationDetail  Einzelansicht (Genehmigung/Ablehnung)
        AdminSettings     SMTP, Admin-Signatur, Konfiguration
        AdminCancellation Kuendigungsbestaetigung erstellen
        AdminDocuments    Dokumenten-Uebersicht
      services/api.ts     API-Client, CSRF-Token-Handling
      context/            Admin Auth Context
```

## Zentrale Architektur-Entscheidungen

### Konfiguration

Alle Umgebungsvariablen sind in `backend/app/config.py` via `pydantic-settings` definiert. Zugriff ueberall ueber `get_settings()` (gecacht).

### Datenbank-Migrationen

Keine Migration-Library (kein Alembic). Die Migrationen laufen automatisch beim Startup in `main.py` als `CREATE TABLE` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Funktioniert fuer ein Projekt dieser Groesse einwandfrei und spart Komplexitaet.

### CSRF-Schutz

Double-Submit Cookie Pattern auf `/api/apply`. Token wird ueber `/api/csrf-token` ausgestellt.

### IBAN-Verschluesselung

IBANs werden mit Fernet (AES) verschluesselt in der Datenbank gespeichert. Der Schluessel wird aus `COOKIE_SECRET` abgeleitet. Klartext-IBANs werden beim Startup automatisch nachverschluesselt.

### Rate-Limiting

DB-basiert: 3 Antraege pro 10 Minuten pro IP auf `/api/apply`.

### Datei-Storage

Alle Uploads/Downloads laufen ueber `services/storage.py`, ein Wrapper um den boto3 S3-Client. Dateien liegen im Tigris Bucket.

### PDF-Erzeugung

WeasyPrint rendert Jinja2 HTML-Templates zu PDF. Signatur-aware: Bei online-unterschriebenen Antraegen wird das gespeicherte signierte PDF wiederverwendet statt neu generiert.

### SPA-Serving

FastAPI serviert das gebaute Frontend aus `backend/static/`. Eine Catch-All Route liefert `index.html` fuer Client-Side Routing.

### Beitrags-Formatierung

Alle Betraege im deutschen Format via `formatFee` Utility:
- Ganze Euro-Betraege: `54,-- EUR`
- Mit Cent: `54,50 EUR`

## Inline-Signatur: Technische Details

### Frontend (`ApplicationForm.tsx`)

- `SignatureCanvas` liegt in einem Container mit `ResizeObserver`, der die Canvas-Pixelabmessungen mit der CSS-Breite synchron haelt. Das verhindert den Touch-Offset-Bug auf Mobilgeraeten.
- Canvas wird bei Groessenaenderung geleert (verhindert verzerrte Signaturen).
- `touch-none` (Tailwind) verhindert, dass Scroll/Zoom-Gesten das Zeichnen stoeren.
- Bestaetigunstext ("Mit meiner Unterschrift erklaere ich...") ist immer sichtbar.
- Bei Absenden: `getTrimmedCanvas().toDataURL("image/png")` liefert die Signatur als Base64.

### Backend (`public.py`, `admin.py`)

- `ApplicationCreate` akzeptiert `unterschrift_base64: Optional[str] = None`.
- Bei Einreichung mit Signatur: Signiertes PDF wird erzeugt, unter `{antragsnummer}_signed.pdf` in Tigris gespeichert, Status sofort auf `dokument_hochgeladen`.
- Das `_signed.pdf` Suffix dient als persistentes Signal fuer online-unterschriebene Antraege.
- Resend-Email und PDF-Download holen das gespeicherte signierte PDF aus Tigris statt ein neues unsigniertes zu erzeugen.

### Genehmigungs-Dokument (`genehmigung_seite.html`)

- Formelle "Bestaetigung der Mitgliedschaft" mit persoenlicher Anrede
- Administrative Hinweise: Satzung (PDF-Link), Mandatsreferenz, Datenaenderungen
- Kontakt: configurable via club config (notification_email)
- Wird mit dem signierten Antrags-PDF zusammengefuehrt und als `{antragsnummer}_approved.pdf` gespeichert

### E-Mail-Templates

- Alle Templates bekommen ein `signed_online` Boolean.
- Applicant-Bestaetigung: Gruene "Antrag vollstaendig" Karte (Option B) vs. rote "drucken/unterschreiben/hochladen" Karte (Option A).
- Admin-Benachrichtigung: Gruenes "Online unterschrieben" Badge bei Option B.
- PDF-Template: Signatur-Bild wird in beide Unterschriftsfelder eingebettet, Upload-Hinweise werden durch "Antrag vollstaendig" Box ersetzt.

## Sicherheit

- CSRF-Schutz (Double-Submit Cookie) auf Formular-Einreichung
- IBAN-Verschluesselung at rest (Fernet AES)
- Rate-Limiting auf dem Submit-Endpoint (3/10min/IP)
- Upload-Token mit 30-Tage-Ablauf
- Zufaellige, nicht-sequenzielle Antragsnummern (verhindert Enumeration)
- Sichere Session-Cookies (HttpOnly, Secure, SameSite)
- Security-Header (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- Non-Root Container User
