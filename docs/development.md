# Lokale Entwicklung

## Voraussetzungen

- Python 3.14+
- Node.js 20+
- npm

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Starten:

```bash
ALLOW_INSECURE_DEFAULTS=true \
  ADMIN_PASSWORD=dev \
  COOKIE_SECRET=dev-secret-key-at-least-32-chars \
  COOKIE_SECURE=false \
  CORS_ORIGINS=http://localhost:5173 \
  PUBLIC_BASE_URL=http://localhost:5173 \
  FORWARDED_ALLOW_IPS=127.0.0.1,::1 \
  uvicorn app.main:app --reload --port 8000
```

Lokal wird automatisch SQLite genutzt (`data/svums.db`), kein PostgreSQL noetig.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Laueft auf `localhost:5173`. Der Vite Dev-Server proxied `/api` automatisch an `localhost:8000` (konfiguriert in `vite.config.ts`).

### Admin-Panel

Oeffne `http://localhost:5173/admin` und log dich mit dem bei `ADMIN_PASSWORD` gesetzten Passwort ein.

## Tests

```bash
cd backend
pytest
```

## Lokale Env-Variablen (Uebersicht)

| Variable | Wert | Warum |
|---|---|---|
| `ALLOW_INSECURE_DEFAULTS` | `true` | Umgeht Passwort/Secret/DB-Checks |
| `ADMIN_PASSWORD` | beliebig | Irgendein Passwort fuer lokales Testing |
| `COOKIE_SECRET` | min. 24 Zeichen | Session-Signing + IBAN-Verschluesselung |
| `COOKIE_SECURE` | `false` | Kein HTTPS lokal |
| `CORS_ORIGINS` | `http://localhost:5173` | Frontend-Origin |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | Fuer Links in E-Mails |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1,::1` | Trusted Proxies lokal |

S3/Tigris-Variablen (`AWS_*`, `BUCKET_NAME`) sind lokal optional. Ohne sie funktionieren PDF-Uploads und Dokumenten-Download nicht, aber das Formular und die Antragsverwaltung laufen trotzdem.

## Docker (lokal)

```bash
docker build -t svums .
docker-compose up
```

`docker-compose.yml` setzt ein lokales Setup mit Traefik als Reverse Proxy auf.
