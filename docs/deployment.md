# Deployment & Konfiguration

## Railway Setup

Die App laeuft auf [Railway](https://railway.app) mit dem Dockerfile (Multi-Stage Build). Railway erkennt das Dockerfile automatisch.

### Schritt fuer Schritt

1. Neues Railway-Projekt erstellen, PostgreSQL hinzufuegen (oder externe [Neon](https://neon.tech) DB nutzen)
2. Repo verbinden -- Railway baut automatisch aus dem Dockerfile
3. Umgebungsvariablen setzen (siehe unten)
4. Health Check Pfad: `/api/health`
5. Fuer Datei-Uploads die S3/Tigris-Credentials hinzufuegen

Railway setzt `PORT` automatisch. Das Entrypoint-Script liest `$PORT` (Default 8000).

### Erster Start

1. Deployen (Push auf main oder Repo verbinden)
2. App-URL oeffnen unter `/admin`
3. Mit `ADMIN_PASSWORD` einloggen
4. Unter Settings SMTP konfigurieren (noetig fuer E-Mail-Versand)

## Umgebungsvariablen

### Pflicht

| Variable | Beschreibung |
|---|---|
| `DATABASE_URL` | PostgreSQL Connection String |
| `ADMIN_PASSWORD` | Passwort fuer das Admin-Panel |
| `COOKIE_SECRET` | Session-Signing + IBAN-Verschluesselung (min. 24 Zeichen). Generieren: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `PUBLIC_BASE_URL` | Oeffentliche URL der App (fuer E-Mail-Links) |
| `CORS_ORIGINS` | Erlaubte Origins, komma-getrennt |

### Optional

| Variable | Default | Beschreibung |
|---|---|---|
| `COOKIE_SECURE` | `true` | Auf `false` setzen fuer lokale Entwicklung (kein HTTPS) |
| `COOKIE_NAME` | `svums_admin_session` | Name des Session-Cookies |
| `ALLOW_INSECURE_DEFAULTS` | `false` | Auf `true` fuer lokale Entwicklung (umgeht Sicherheitschecks) |
| `FORWARDED_ALLOW_IPS` | -- | Trusted Proxy IPs fuer Forwarded-Header |

### S3/Tigris Storage

| Variable | Beschreibung |
|---|---|
| `AWS_ACCESS_KEY_ID` | S3/Tigris Access Key |
| `AWS_SECRET_ACCESS_KEY` | S3/Tigris Secret Key |
| `AWS_ENDPOINT_URL_S3` | S3/Tigris Endpoint URL |
| `AWS_REGION` | S3 Region (Default `auto`) |
| `BUCKET_NAME` | S3 Bucket Name (Default `svums-uploads`) |

### Analytics

Die Analyse laeuft client-seitig ueber Umami. Die Tracking-Skripte sind direkt
in `frontend/index.html` eingebettet, es werden keine Backend-Umgebungsvariablen
benoetigt.

## Datenpersistenz

| Daten | Speicherort |
|---|---|
| Antraege, Einstellungen | PostgreSQL (Neon) |
| Hochgeladene Dokumente | Tigris (S3-kompatibel) |
| Online-signierte PDFs | Tigris, Key: `{antragsnummer}_signed.pdf` |
| Genehmigungs-Dokumente | Tigris, Key: `{antragsnummer}_approved.pdf` |
| Kuendigungsbestatigungen | Tigris |
| Admin-Signatur (optional) | `app_settings.admin_signature_base64` in PostgreSQL |

SMTP-Einstellungen und die optionale Admin-Signatur liegen in der `app_settings`-Tabelle und ueberleben Restarts und Redeployments.

## Docker

```bash
# Lokaler Build
docker build -t svums .

# Mit docker-compose (inkl. Traefik)
docker-compose up
```

Das Dockerfile ist ein Multi-Stage Build:
1. **Stage 1**: Node -- baut das Frontend
2. **Stage 2**: Python -- installiert Backend-Dependencies, kopiert das gebaute Frontend nach `backend/static/`
