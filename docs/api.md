# API-Referenz

## Public Endpoints

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/health` | Health Check |
| GET | `/api/csrf-token` | CSRF-Token holen (setzt Cookie) |
| POST | `/api/apply` | Mitgliedsantrag einreichen |
| GET | `/api/fees/calculate` | Mitgliedsbeitrag berechnen |
| GET | `/api/iban/lookup` | IBAN validieren, BIC + Bank ermitteln |
| GET | `/api/address/plz/{plz}` | Ort nach PLZ suchen |
| GET | `/api/address/streets` | Strassen-Autocomplete |
| GET | `/api/status/{antragsnummer}` | Oeffentliche Status-Abfrage (inkl. Ablehnungsgrund) |
| GET | `/api/upload/{token}` | Upload-Info abrufen |
| POST | `/api/upload/{token}` | Unterschriebenes Dokument hochladen |

## Admin Endpoints (Session Cookie erforderlich)

### Authentifizierung

| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/admin/login` | Admin-Login |
| POST | `/api/admin/logout` | Admin-Logout |
| GET | `/api/admin/me` | Authentifizierung pruefen |

### Antraege

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/admin/applications` | Antragsliste |
| GET | `/api/admin/applications/{id}` | Einzelnen Antrag abrufen |
| PATCH | `/api/admin/applications/{id}` | Status/Notizen aktualisieren (Genehmigung/Ablehnung) |
| DELETE | `/api/admin/applications/{id}` | Antrag loeschen |
| POST | `/api/admin/applications/{id}/resend-email` | E-Mails erneut senden |
| GET | `/api/admin/applications/{id}/pdf` | PDF herunterladen (signiert wenn vorhanden) |

### Dokumente

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/admin/applications/{id}/upload` | Hochgeladenes Dokument ansehen |
| DELETE | `/api/admin/applications/{id}/upload` | Hochgeladenes Dokument loeschen |
| GET | `/api/admin/applications/{id}/approved` | Genehmigungs-Dokument ansehen |
| DELETE | `/api/admin/applications/{id}/approved` | Genehmigungs-Dokument loeschen |
| POST | `/api/admin/applications/{id}/admin-upload` | Admin-Upload eines Dokuments |

### Kuendigungen

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/admin/cancellation-documents` | Kuendigungsbestatigungen auflisten |
| GET | `/api/admin/cancellation-documents/{id}/download` | Kuendigungsbesteatigung herunterladen |
| DELETE | `/api/admin/cancellation-documents/{id}` | Kuendigungsbestaetigung loeschen |
| POST | `/api/admin/cancellation-pdf` | Kuendigungsbestaetigung erzeugen |

### Export & Einstellungen

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/admin/export` | CSV-Export |
| GET | `/api/admin/settings` | App-Einstellungen abrufen |
| PUT | `/api/admin/settings` | App-Einstellungen aktualisieren |
| POST | `/api/admin/settings/test-smtp` | Test-E-Mail senden |

## Formular-Inhalte

### Abteilungen

Fussball, Gymnastik, Combo, Kinderturnen, Korbball, Tischtennis, Yoga, Dart, Lauftreff, PingPongParkinson, Keine Abteilung

### Beitragskategorien

- **Kinder (bis 14, Elternteil Mitglied)**: 12,-- EUR/Jahr
- **Kinder (bis 14, Elternteil kein Mitglied)**: 24,-- EUR/Jahr
- **Jugendliche (14-18, Elternteil Mitglied)**: 24,-- EUR/Jahr
- **Jugendliche (14-18, Elternteil kein Mitglied)**: 36,-- EUR/Jahr
- **Junge Erwachsene (bis 25)**: 42,-- EUR/Jahr
- **Erwachsene (ab 25)**: 54,-- EUR/Jahr
- **Familie**: 96,-- EUR/Jahr

Stichtag fuer die Altersberechnung ist der 1. Januar.

### Einwilligungen

- DSGVO-konforme Datenschutz-Zustimmung (Link configurable via club config)
- Austritt zum Jahresende, 6 Wochen Frist, in Textform (E-Mail or post — configurable via club config)
