# SVUMS

**Mitgliedschaftsantrags-System fur den SV 1945 Untereuerheim e.V.**

Unser Verein brauchte eine digitale Losung fur Mitgliedsantrage. Vorher lief das alles uber Papierformulare, eingescannte PDFs per E-Mail, und viel manuelle Arbeit. SVUMS ersetzt das durch ein Online-Formular mit automatischer PDF-Erzeugung, digitalem Unterschreiben, und einem Admin-Panel zur Verwaltung.

---

## Was kann das Ding?

**Fur Antragsteller:**
- Mehrstufiges Formular (Einzel, Kind, Familie) mit automatischer Beitragsberechnung
- Adress-Autocomplete uber PLZ, IBAN-Validierung mit BIC/Bank-Erkennung
- Direkt am Bildschirm unterschreiben oder klassisch: ausdrucken, unterschreiben, hochladen
- Status-Seite zum Nachverfolgen des Antrags

**Fur den Vorstand:**
- Admin-Dashboard mit Suche, Filter, und Statusverwaltung
- Antrage genehmigen (mit eigener digitaler Unterschrift) oder ablehnen (mit Begrundung)
- PDF-Download, Dokumenten-Verwaltung, CSV-Export
- SMTP-Konfiguration direkt im Browser
- Kundigungsbestatigungen erstellen und verwalten

**Automatisch im Hintergrund:**
- PDF-Erzeugung (Beitrittserklearung, Genehmigung, Kundigung)
- E-Mail-Versand an Antragsteller und Verein bei jedem Statuswechsel
- IBAN-Verschlusselung in der Datenbank
- CSRF-Schutz, Rate-Limiting, sichere Sessions

## Tech Stack

| | |
|---|---|
| Backend | Python 3.14, FastAPI, SQLAlchemy 2.0 |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Datenbank | PostgreSQL (Neon) / SQLite lokal |
| Dateien | Tigris (S3-kompatibel) |
| PDF | WeasyPrint |
| Hosting | Railway, Docker |

## Schnellstart

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
ALLOW_INSECURE_DEFAULTS=true ADMIN_PASSWORD=dev COOKIE_SECRET=dev-secret-key-at-least-32-chars \
  COOKIE_SECURE=false CORS_ORIGINS=http://localhost:5173 \
  PUBLIC_BASE_URL=http://localhost:5173 \
  uvicorn app.main:app --reload --port 8000

# Frontend (zweites Terminal)
cd frontend
npm install
npm run dev
```

Frontend lauft auf `localhost:5173` und leitet `/api` an das Backend weiter. Admin-Panel unter `/admin`, Passwort ist was du bei `ADMIN_PASSWORD` gesetzt hast.

## Antrags-Ablauf (Kurzfassung)

1. Antragsteller fullt das Formular aus und wahlt eine Unterschriftsmethode
2. **Option A**: PDF kommt per E-Mail, ausdrucken, unterschreiben, Scan hochladen
3. **Option B**: Direkt am Bildschirm unterschreiben, fertig
4. Admin pruft den Antrag, genehmigt (mit eigener Unterschrift) oder lehnt ab
5. Antragsteller bekommt das Ergebnis per E-Mail

Den vollstandigen Workflow mit Mermaid-Diagramm gibt's in der [Workflow-Dokumentation](docs/workflow.md).

## Projekt-Struktur (Uberblick)

```
svums/
  Dockerfile            Multi-stage Build
  backend/
    app/
      main.py           FastAPI App + Startup-Migrationen
      config.py         Alle Env-Variablen
      models/           SQLAlchemy Models
      routers/          API-Routen (public, admin, address)
      services/         Business-Logik (E-Mail, PDF, Fees, Crypto, Storage)
      templates/        Jinja2-Templates fur PDFs und E-Mails
  frontend/
    src/
      pages/            React-Seiten
      services/api.ts   API-Client
```

## Deployment

Lauft auf [Railway](https://railway.app) mit Docker. Health-Check unter `/api/health`.

Die wichtigsten Umgebungsvariablen:
- `DATABASE_URL` -- PostgreSQL Connection String
- `ADMIN_PASSWORD` -- Passwort furs Admin-Panel
- `COOKIE_SECRET` -- Session-Key + IBAN-Verschlusselung (min. 24 Zeichen)
- `PUBLIC_BASE_URL` -- Offentliche URL (fur E-Mail-Links)
- `CORS_ORIGINS` -- Erlaubte Origins

Alles Weitere zum Deployment und die vollstandige Env-Var-Tabelle: [Deployment-Doku](docs/deployment.md)

## Dokumentation

| Thema | Link |
|---|---|
| Architektur & Patterns | [docs/architecture.md](docs/architecture.md) |
| API-Referenz | [docs/api.md](docs/api.md) |
| Deployment & Konfiguration | [docs/deployment.md](docs/deployment.md) |
| Antrags-Workflow (mit Diagramm) | [docs/workflow.md](docs/workflow.md) |
| Lokale Entwicklung | [docs/development.md](docs/development.md) |

## Lizenz

Internes Projekt fur den SV 1945 Untereuerheim e.V. Nicht fur externe Nutzung lizenziert.
