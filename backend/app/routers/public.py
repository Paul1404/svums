import json
import logging
import os
import uuid
from datetime import date, datetime
from pathlib import Path

from app.config import get_settings
from app.services.posthog import capture as posthog_capture
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, UploadFile, File, Form

from app.services import storage
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.application import MembershipApplication
from app.models.settings import AppSettings
from app.schemas.application import (
    ApplicationCreate,
    ApplicationSubmitResponse,
    FeeCalculationResponse,
)
from app.services.fees import calculate_fee, determine_mitgliedschaft_typ, calculate_age
from app.services.pdf import generate_pdf
from app.services.email import (
    send_application_email,
    send_paper_scan_received,
    send_upload_notification,
)
from app.services.crypto import encrypt_iban, decrypt_iban_safe
from app.services.urls import build_public_url, public_host_display

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["public"])


def _hours_since(ts: datetime | None) -> float | None:
    if not ts:
        return None
    return round((datetime.utcnow() - ts).total_seconds() / 3600, 3)


def _days_since(ts: datetime | None) -> int | None:
    if not ts:
        return None
    return max((datetime.utcnow() - ts).days, 0)


def _format_iban(iban: str) -> str:
    """Format IBAN with spaces every 4 characters."""
    cleaned = iban.replace(" ", "")
    return " ".join(cleaned[i : i + 4] for i in range(0, len(cleaned), 4))


def _compute_anrede(app: MembershipApplication) -> str:
    """Compute a formal salutation string for the contact person of an application."""
    antragstyp = app.antragstyp or "einzel"
    geschlecht = app.geschlecht or ""
    if geschlecht == "Herr":
        prefix = "Sehr geehrter Herr"
    elif geschlecht == "Frau":
        prefix = "Sehr geehrte Frau"
    else:
        # Keine Angabe / divers: address with full name, no gendered title
        if antragstyp == "kind":
            first = app.erziehungsberechtigter_vorname or app.vorname
            last = app.erziehungsberechtigter_nachname or app.nachname
        else:
            first = app.vorname
            last = app.nachname
        return f"Guten Tag {first} {last}"
    last_name = (
        app.erziehungsberechtigter_nachname or app.nachname
        if antragstyp == "kind"
        else app.nachname
    )
    return f"{prefix} {last_name}"


def _build_application_data(app: MembershipApplication, club_config: dict | None = None) -> dict:
    """Build template data dict from application model."""
    fee_amount, fee_label = calculate_fee(
        app.mitgliedschaft_typ, app.elternteil_mitglied
    )

    if club_config is None:
        from app.schemas.club_config import ClubConfig
        club_config = ClubConfig().to_template_dict()

    antragstyp = app.antragstyp or "einzel"

    data = {
        "id": app.id,
        "antragsnummer": app.antragsnummer or "",
        "antragstyp": antragstyp,
        "geschlecht": app.geschlecht or "",
        "anrede": _compute_anrede(app),
        "mandatsreferenz": app.mandatsreferenz or "",
        "glaeubiger_id": club_config.get("sepa_glaeubiger_id", ""),
        "upload_token": app.upload_token or "",
        "upload_url": build_public_url(f"/upload/{app.upload_token}") if app.upload_token else "",
        "status_url": build_public_url(f"/status?nr={app.antragsnummer}") if app.antragsnummer else "",
        "logo_url": build_public_url("/logo_svu-241x300.png"),
        "site_host_display": public_host_display(),
        "club": club_config,
        "vorname": app.vorname,
        "nachname": app.nachname,
        "geburtsdatum": app.geburtsdatum,
        "geburtsdatum_formatted": app.geburtsdatum.strftime("%d.%m.%Y"),
        "strasse": app.strasse,
        "plz": app.plz,
        "ort": app.ort,
        "telefon": app.telefon,
        "email": app.email,
        "abteilungen": app.get_abteilungen(),
        "abteilungen_display": ", ".join(app.get_abteilungen()),
        "mitgliedschaft_typ": app.mitgliedschaft_typ,
        "elternteil_mitglied": app.elternteil_mitglied,
        "jahresbeitrag": int(app.jahresbeitrag),
        "fee_label": fee_label,
        "kontoinhaber": app.kontoinhaber,
        "iban": decrypt_iban_safe(app.iban),
        "iban_formatted": _format_iban(decrypt_iban_safe(app.iban)),
        "bic": app.bic,
        "kreditinstitut": app.kreditinstitut,
        "datum": date.today().strftime("%d.%m.%Y"),
        "consent_at": app.consent_at,
        "consent_at_formatted": app.consent_at.strftime("%d.%m.%Y um %H:%M Uhr") if app.consent_at else None,
        "datenschutz_accepted": app.datenschutz_accepted,
        "satzung_accepted": app.satzung_accepted,
    }

    # Guardian info for Kind type
    if antragstyp == "kind":
        data["erziehungsberechtigter_vorname"] = app.erziehungsberechtigter_vorname or ""
        data["erziehungsberechtigter_nachname"] = app.erziehungsberechtigter_nachname or ""
        data["erziehungsberechtigter_name"] = (
            f"{app.erziehungsberechtigter_nachname or ''}, {app.erziehungsberechtigter_vorname or ''}"
        )

    # Children for Familie type
    if antragstyp == "familie":
        kinder = app.get_kinder()
        for k in kinder:
            if isinstance(k.get("geburtsdatum"), str):
                try:
                    dob = date.fromisoformat(k["geburtsdatum"])
                    k["geburtsdatum_formatted"] = dob.strftime("%d.%m.%Y")
                    k["age"] = calculate_age(dob)
                except (ValueError, TypeError):
                    k["geburtsdatum_formatted"] = k["geburtsdatum"]
                    k["age"] = None
            k["abteilungen_display"] = ", ".join(k.get("abteilungen", []))
        data["kinder"] = kinder

        # Partner / second parent
        if app.partner_vorname and app.partner_nachname:
            data["partner_vorname"] = app.partner_vorname
            data["partner_nachname"] = app.partner_nachname
            data["partner_name"] = f"{app.partner_nachname}, {app.partner_vorname}"
            if app.partner_geburtsdatum:
                data["partner_geburtsdatum"] = app.partner_geburtsdatum
                data["partner_geburtsdatum_formatted"] = app.partner_geburtsdatum.strftime("%d.%m.%Y")
            data["partner_abteilungen"] = app.get_partner_abteilungen()
            data["partner_abteilungen_display"] = ", ".join(app.get_partner_abteilungen())

    return data


async def _send_email_task(application_id: int, db_url: str, unterschrift_base64: str | None = None):
    """Background task to generate PDF and send email."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    _kwargs = {"connect_args": {"check_same_thread": False}} if db_url.startswith("sqlite") else {}
    eng = create_engine(db_url, **_kwargs)
    SessionLocal = sessionmaker(bind=eng)
    db = SessionLocal()

    try:
        app = db.query(MembershipApplication).filter(
            MembershipApplication.id == application_id
        ).first()
        if not app:
            logger.error(f"Application {application_id} not found for email")
            return

        settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
        if not settings or not settings.smtp_host:
            logger.warning("SMTP not configured, skipping email")
            return

        club = settings.get_club_config()
        club_dict = club.to_template_dict()

        data = _build_application_data(app, club_config=club_dict)
        data["notification_email"] = settings.notification_email

        # Detect online-signed: either the caller passes the raw base64 (fresh submission),
        # or the stored filename ends with "_signed.pdf" (resend after the fact).
        is_online_signed = bool(unterschrift_base64) or bool(
            app.uploaded_file and app.uploaded_file.endswith("_signed.pdf")
        )
        data["signed_online"] = is_online_signed

        if unterschrift_base64:
            # Fresh submission: embed the signature and regenerate the PDF.
            data["unterschrift_base64"] = unterschrift_base64
            pdf_bytes = generate_pdf(data)
        elif is_online_signed and app.uploaded_file:
            # Resend: reuse the stored signed PDF so the attachment still carries the signature.
            pdf_bytes = storage.download_file(app.uploaded_file) or generate_pdf(data)
        else:
            pdf_bytes = generate_pdf(data)

        from app.routers.admin import _log_email

        club_subject = (
            f"Neue Beitrittserklärung: {app.nachname}, {app.vorname}"
        )
        applicant_subject = f"Ihre Beitrittserklärung – {club.email_subject_prefix}"
        send_error: Exception | None = None
        success = False
        try:
            success = await send_application_email(
                smtp_host=settings.smtp_host,
                smtp_port=settings.smtp_port,
                smtp_user=settings.smtp_user,
                smtp_password=settings.smtp_password,
                smtp_from=settings.smtp_from,
                smtp_use_tls=settings.smtp_use_tls,
                notification_email=settings.notification_email,
                applicant_email=app.email,
                application_data=data,
                pdf_bytes=pdf_bytes,
            )
        except Exception as e:
            send_error = e
            success = False

        _log_email(db, "application_club", settings.notification_email,
                   club_subject, success, send_error,
                   app.antragsnummer, app.vorname, app.nachname)
        _log_email(db, "application_applicant", app.email,
                   applicant_subject, success, send_error,
                   app.antragsnummer, app.vorname, app.nachname)

        if success:
            app.email_sent = True
            db.commit()
    except Exception as e:
        logger.error(f"Email task error: {e}")
    finally:
        db.close()
        eng.dispose()


@router.post("/apply", response_model=ApplicationSubmitResponse)
async def submit_application(
    data: ApplicationCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Submit a new membership application."""
    # Calculate fee
    fee_amount, fee_label = calculate_fee(
        data.mitgliedschaft_typ, data.elternteil_mitglied
    )

    # Create application
    application = MembershipApplication(
        antragstyp=data.antragstyp,
        geschlecht=data.geschlecht,
        vorname=data.vorname,
        nachname=data.nachname,
        geburtsdatum=data.geburtsdatum,
        strasse=data.strasse,
        plz=data.plz,
        ort=data.ort,
        telefon=data.telefon,
        email=data.email,
        erziehungsberechtigter_vorname=data.erziehungsberechtigter_vorname,
        erziehungsberechtigter_nachname=data.erziehungsberechtigter_nachname,
        partner_vorname=data.partner_vorname,
        partner_nachname=data.partner_nachname,
        partner_geburtsdatum=data.partner_geburtsdatum,
        partner_abteilungen=json.dumps(data.partner_abteilungen) if data.partner_abteilungen else None,
        kinder=json.dumps([k.model_dump(mode="json") for k in data.kinder]) if data.kinder else None,
        abteilungen=json.dumps(data.abteilungen),
        mitgliedschaft_typ=data.mitgliedschaft_typ,
        elternteil_mitglied=data.elternteil_mitglied,
        jahresbeitrag=fee_amount,
        kontoinhaber=data.kontoinhaber,
        iban=encrypt_iban(data.iban),
        bic=data.bic,
        kreditinstitut=data.kreditinstitut,
        consent_at=datetime.utcnow(),
        datenschutz_accepted=data.datenschutz_accepted,
        satzung_accepted=data.satzung_accepted,
        consent_ip=request.client.host if request.client else None,
        is_test=data.is_test,
    )

    db.add(application)
    db.flush()  # get the id

    # Generate Antragsnummer: ANT-YYYY-XXXXXX (random, non-sequential)
    import secrets
    import string
    year = date.today().year
    _charset = string.ascii_uppercase + string.digits
    _charset = _charset.replace("O", "").replace("I", "").replace("L", "").replace("0", "")  # remove ambiguous
    for _attempt in range(20):
        rand_part = "".join(secrets.choice(_charset) for _ in range(6))
        candidate = f"ANT-{year}-{rand_part}"
        exists = db.query(MembershipApplication.id).filter(
            MembershipApplication.antragsnummer == candidate
        ).first()
        if not exists:
            application.antragsnummer = candidate
            break
    else:
        # Fallback: use uuid hex
        application.antragsnummer = f"ANT-{year}-{uuid.uuid4().hex[:8].upper()}"

    # Generate upload token
    application.upload_token = str(uuid.uuid4())

    # Load club config for mandate prefix and template data
    _app_settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    _club = _app_settings.get_club_config() if _app_settings else __import__("app.schemas.club_config", fromlist=["ClubConfig"]).ClubConfig()
    _club_dict = _club.to_template_dict()

    # Generate Mandatsreferenz using the DB row id to avoid concurrency races.
    year = date.today().year
    mandate_prefix = _club.sepa_mandate_prefix
    application.mandatsreferenz = f"{mandate_prefix}{year}-{application.id:05d}"

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Antrag konnte wegen einer Kollision nicht gespeichert werden. Bitte erneut versuchen.",
        )
    db.refresh(application)

    # Option B: inline signature provided → generate signed PDF, store it,
    # and advance status to "dokument_hochgeladen" immediately.
    if data.unterschrift_base64:
        try:
            app_data = _build_application_data(application, club_config=_club_dict)
            app_data["notification_email"] = _app_settings.notification_email if _app_settings else ""
            app_data["unterschrift_base64"] = data.unterschrift_base64
            pdf_bytes = generate_pdf(app_data)

            signed_filename = f"{application.antragsnummer}_signed.pdf"
            storage.upload_file(signed_filename, pdf_bytes, content_type="application/pdf")

            application.uploaded_file = signed_filename
            application.uploaded_at = datetime.utcnow()
            application.status = "dokument_hochgeladen"
            try:
                db.commit()
            except Exception:
                db.rollback()
                storage.delete_file(signed_filename)
                raise
            db.refresh(application)
            logger.info(f"Inline-signed PDF saved for {application.antragsnummer}")
        except Exception as exc:
            logger.error(f"Failed to generate inline-signed PDF: {exc}")
            # Non-fatal: continue without embedding; status stays "neu"

    # Track membership application submission
    posthog_capture(
        "membership_application_submitted",
        application.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": application.id,
            "antragsnummer": application.antragsnummer,
            "antragstyp": application.antragstyp or "einzel",
            "mitgliedschaft_typ": application.mitgliedschaft_typ,
            "jahresbeitrag": float(application.jahresbeitrag),
            "abteilungen_count": len(application.get_abteilungen()),
            "online_signed": bool(data.unterschrift_base64),
            "signature_mode": "inline" if data.unterschrift_base64 else "paper_upload",
            "status_after_submit": application.status,
            "hours_to_submit": 0,
        },
    )

    # Send email in background (signature forwarded so PDF in email also carries it)
    from app.config import get_settings
    settings = get_settings()
    background_tasks.add_task(
        _send_email_task,
        application.id,
        settings.database_url,
        data.unterschrift_base64,
    )

    return ApplicationSubmitResponse(
        id=application.id,
        antragsnummer=application.antragsnummer,
        mandatsreferenz=application.mandatsreferenz,
        upload_url=build_public_url(f"/upload/{application.upload_token}"),
        message="Ihre Beitrittserklärung wurde erfolgreich eingereicht.",
    )


@router.get("/fees/calculate", response_model=FeeCalculationResponse)
async def calculate_membership_fee(
    geburtsdatum: date,
    mitgliedschaft_typ: str,
    elternteil_mitglied: bool | None = None,
):
    """Calculate the annual membership fee."""
    try:
        fee_amount, fee_label = calculate_fee(mitgliedschaft_typ, elternteil_mitglied)
        return FeeCalculationResponse(
            jahresbeitrag=fee_amount,
            mitgliedschaft_typ=mitgliedschaft_typ,
            label=fee_label,
        )
    except ValueError as e:
        logger.warning("Fee calculation error: %s", e)
        raise HTTPException(
            status_code=400,
            detail="Beitrag konnte nicht berechnet werden. Bitte überprüfen Sie Ihre Angaben.",
        )


@router.get("/iban/lookup")
async def lookup_iban(iban: str):
    """Validate IBAN and look up BIC + bank name."""
    cleaned = iban.replace(" ", "").upper()
    result = {"valid": False, "iban": cleaned, "bic": None, "bank_name": None}
    try:
        from schwifty import IBAN as SchwiftyIBAN
        iban_obj = SchwiftyIBAN(cleaned)
        result["valid"] = True
        result["country"] = iban_obj.country_code
        try:
            bic_obj = iban_obj.bic
            result["bic"] = bic_obj.compact
            try:
                names = bic_obj.bank_names
                if isinstance(names, list) and names:
                    result["bank_name"] = names[0]
                elif isinstance(names, dict) and names:
                    result["bank_name"] = list(names.values())[0]
                elif names:
                    result["bank_name"] = str(names)
            except Exception:
                pass
        except Exception:
            pass
    except Exception as e:
        logger.debug("IBAN lookup failed for input %r: %s", cleaned, e)
    return result


_FRONTEND_HEALTH_CACHE: dict | None = None


def _inspect_frontend(static_dir: Path) -> dict:
    """Pure function for testing: inspect a static dir without touching cache."""
    import re
    index_html = static_dir / "index.html"
    result: dict = {"static_dir": str(static_dir)}

    if not static_dir.exists():
        result["status"] = "missing_static_dir"
        return result
    if not index_html.exists():
        result["status"] = "missing_index_html"
        return result

    try:
        html = index_html.read_text(encoding="utf-8")
    except Exception as e:
        result["status"] = "index_unreadable"
        result["error"] = str(e)
        return result

    script_srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    if not script_srcs:
        result["status"] = "no_script_tag"
        return result

    missing_assets = [
        src for src in script_srcs
        if not (static_dir / src.lstrip("/")).exists()
    ]
    if missing_assets:
        result["status"] = "missing_assets"
        result["missing"] = missing_assets
        return result

    result["status"] = "ok"
    result["assets"] = script_srcs
    return result


def _frontend_health() -> dict:
    """Verify the built frontend exists and is internally consistent.

    Catches: missing static dir, missing index.html, index.html that references
    a JS bundle that isn't on disk (broken deploy / partial copy). Does NOT
    catch runtime JS errors; the boot probe handles that.
    """
    global _FRONTEND_HEALTH_CACHE
    if _FRONTEND_HEALTH_CACHE is not None:
        return _FRONTEND_HEALTH_CACHE
    static_dir = Path(__file__).resolve().parent.parent.parent / "static"
    _FRONTEND_HEALTH_CACHE = _inspect_frontend(static_dir)
    return _FRONTEND_HEALTH_CACHE


@router.post("/health/frontend-error")
async def report_frontend_error(request: Request):
    """Receive boot-probe reports from index.html when React fails to mount.

    Logged at ERROR so it surfaces in monitoring. Best-effort: never raises,
    never trusts the payload beyond size limits.
    """
    try:
        raw = await request.body()
        if len(raw) > 8192:
            raw = raw[:8192]
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            payload = {"_raw": raw.decode("utf-8", errors="replace")}
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "?")
        )
        logger.error(
            "frontend boot failure: ip=%s ua=%r url=%r error=%r",
            client_ip,
            (payload.get("ua") or "")[:200],
            (payload.get("url") or "")[:200],
            payload.get("error"),
        )
    except Exception as e:
        logger.error("frontend-error endpoint failed: %s", e)
    return {"received": True}


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check.

    - Keeps the DB connection warm (prevents Neon cold-start).
    - Verifies the built frontend is present and references existing JS assets.
    Returns 200 always so Railway's healthcheck won't kill the container on
    transient DB blips; the response body carries the detail.
    """
    from sqlalchemy import text
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"

    fe = _frontend_health()
    overall = "ok" if db_status == "ok" and fe["status"] == "ok" else "degraded"
    return {"status": overall, "db": db_status, "frontend": fe}


@router.get("/client-config")
async def client_config(db: Session = Depends(get_db)):
    env = get_settings()
    posthog_enabled = bool(env.posthog_key)

    app_settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    from app.schemas.club_config import ClubConfig
    club = app_settings.get_club_config() if app_settings else ClubConfig()

    return {
        "posthog_enabled": posthog_enabled,
        "posthog_key": env.posthog_key if posthog_enabled else None,
        "posthog_host": env.posthog_host if posthog_enabled else None,
        "club": club.to_template_dict(),
    }


@router.get("/club-config")
async def get_club_config(db: Session = Depends(get_db)):
    """Public endpoint returning club configuration (non-sensitive)."""
    from app.schemas.club_config import ClubConfig

    app_settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    club = app_settings.get_club_config() if app_settings else ClubConfig()
    return club.to_template_dict()


@router.get("/check-duplicate")
async def check_duplicate(
    vorname: str,
    nachname: str,
    geburtsdatum: date,
    db: Session = Depends(get_db),
):
    """Check if an application with the same name and DOB already exists."""
    existing = (
        db.query(MembershipApplication.id)
        .filter(
            func.lower(MembershipApplication.vorname) == vorname.strip().lower(),
            func.lower(MembershipApplication.nachname) == nachname.strip().lower(),
            MembershipApplication.geburtsdatum == geburtsdatum,
        )
        .first()
    )
    if existing:
        return {"duplicate": True}
    return {"duplicate": False}


# --- Upload signed document ---

from app.constants import ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_FILE_SIZE


def _check_upload_expiry(app: MembershipApplication) -> None:
    """Raise HTTP 410 if the upload link has expired (30 days)."""
    if not app.created_at:
        return
    days_since = (datetime.utcnow() - app.created_at).days
    if days_since > 30:
        posthog_capture(
            "membership_upload_link_expired",
            app.antragsnummer or "public",
            properties={
                "app_area": "public",
                "source": "backend",
                "application_id": app.id,
                "antragsnummer": app.antragsnummer,
                "days_since_submission": days_since,
                "reason": "expired_link",
            },
        )
        raise HTTPException(
            status_code=410,
            detail="Der Upload-Link ist abgelaufen (30 Tage). Bitte kontaktieren Sie den Verein."
        )


@router.get("/upload/{token}")
async def get_upload_info(token: str, db: Session = Depends(get_db)):
    """Get application info for an upload token (used by the upload page)."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.upload_token == token
    ).first()
    if not app:
        posthog_capture(
            "membership_upload_link_invalid",
            "public",
            properties={"app_area": "public", "source": "backend", "reason": "not_found"},
        )
        raise HTTPException(status_code=404, detail="Ungültiger Upload-Link")

    _check_upload_expiry(app)

    return {
        "antragsnummer": app.antragsnummer,
        "vorname": app.vorname,
        "nachname": app.nachname,
        "antragstyp": app.antragstyp,
        "already_uploaded": app.uploaded_file is not None,
        "uploaded_at": app.uploaded_at.isoformat() if app.uploaded_at else None,
    }


@router.post("/upload/{token}")
async def upload_signed_document(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a signed membership application document."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.upload_token == token
    ).first()
    if not app:
        posthog_capture(
            "membership_upload_link_invalid",
            "public",
            properties={"app_area": "public", "source": "backend", "reason": "not_found"},
        )
        raise HTTPException(status_code=404, detail="Ungültiger Upload-Link")

    _check_upload_expiry(app)

    # Validate file extension
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Nicht erlaubtes Dateiformat. Erlaubt: {', '.join(ALLOWED_UPLOAD_EXTENSIONS)}"
        )

    # Read and validate size
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Datei zu groß (max. 20 MB)")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")

    # Save file to Tigris
    filename = f"{app.antragsnummer}_{uuid.uuid4().hex[:8]}{ext}"
    content_type = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic", ".heif": "image/heif",
    }.get(ext, "application/octet-stream")
    storage.upload_file(filename, contents, content_type=content_type)

    # Update application
    old_filename = app.uploaded_file

    app.uploaded_file = filename
    app.uploaded_at = datetime.utcnow()
    # Drop the previous OCR cache — it belongs to the file we're replacing.
    app.uploaded_file_ocr = None
    # Auto-advance status
    if app.status == "neu":
        app.status = "dokument_hochgeladen"
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_file(filename)
        raise

    # Delete previous upload only after new DB state has been committed.
    if old_filename:
        storage.delete_file(old_filename)

    logger.info(f"Upload received for {app.antragsnummer}: {filename} ({len(contents)} bytes)")

    # Track document upload
    posthog_capture(
        "membership_document_uploaded",
        app.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "status_after_upload": app.status,
            "file_extension": ext,
            "file_size_bytes": len(contents),
        },
    )

    # Send notifications
    try:
        settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
        if settings and settings.smtp_host:
            import asyncio
            from app.config import get_settings as _get_cfg_upload
            from app.routers.admin import _log_email as _log

            _u_db_url = _get_cfg_upload().database_url
            _u_smtp = settings
            _u_antragsnummer = app.antragsnummer
            _u_vorname = app.vorname
            _u_nachname = app.nachname
            _u_filename = filename
            _u_notification_email = settings.notification_email
            _u_applicant_email = app.email
            _u_anrede = _compute_anrede(app)

            async def _notify_admin_and_log():
                from sqlalchemy.orm import sessionmaker as _sm2
                from app.routers.admin import _make_engine
                _eng2 = _make_engine(_u_db_url)
                _ldb2 = _sm2(bind=_eng2)()
                _subject2 = f"Dokument hochgeladen: {_u_antragsnummer}"
                _ok2, _err2 = False, None
                try:
                    await send_upload_notification(
                        smtp_host=_u_smtp.smtp_host,
                        smtp_port=_u_smtp.smtp_port,
                        smtp_user=_u_smtp.smtp_user,
                        smtp_password=_u_smtp.smtp_password,
                        smtp_from=_u_smtp.smtp_from,
                        smtp_use_tls=_u_smtp.smtp_use_tls,
                        notification_email=_u_notification_email,
                        antragsnummer=_u_antragsnummer,
                        vorname=_u_vorname,
                        nachname=_u_nachname,
                        filename=_u_filename,
                    )
                    _ok2 = True
                except Exception as _e2:
                    _err2 = _e2
                finally:
                    _log(_ldb2, "upload_notification", _u_notification_email, _subject2,
                         _ok2, _err2, _u_antragsnummer, _u_vorname, _u_nachname)
                    _ldb2.close()
                    _eng2.dispose()

            async def _confirm_upload_and_log():
                from sqlalchemy.orm import sessionmaker as _sm3
                from app.services.email import send_status_email as _sse
                from app.routers.admin import _make_engine
                _eng3 = _make_engine(_u_db_url)
                _ldb3 = _sm3(bind=_eng3)()
                _subject3 = "Ihr Dokument wurde empfangen"
                _ok3, _err3 = False, None
                try:
                    await _sse(
                        smtp_host=_u_smtp.smtp_host,
                        smtp_port=_u_smtp.smtp_port,
                        smtp_user=_u_smtp.smtp_user,
                        smtp_password=_u_smtp.smtp_password,
                        smtp_from=_u_smtp.smtp_from,
                        smtp_use_tls=_u_smtp.smtp_use_tls,
                        applicant_email=_u_applicant_email,
                        vorname=_u_vorname,
                        nachname=_u_nachname,
                        antragsnummer=_u_antragsnummer,
                        status="dokument_hochgeladen",
                        anrede=_u_anrede,
                    )
                    _ok3 = True
                except Exception as _e3:
                    _err3 = _e3
                finally:
                    _log(_ldb3, "upload_notification", _u_applicant_email, _subject3,
                         _ok3, _err3, _u_antragsnummer, _u_vorname, _u_nachname)
                    _ldb3.close()
                    _eng3.dispose()

            asyncio.ensure_future(_notify_admin_and_log())
            asyncio.ensure_future(_confirm_upload_and_log())
    except Exception as e:
        logger.error(f"Failed to send upload notification: {e}")

    return {
        "message": "Dokument erfolgreich hochgeladen",
        "filename": filename,
        "antragsnummer": app.antragsnummer,
    }


# --- Public paper-form scan upload (legacy form, no auth, no metadata) ---

_PAPER_PLACEHOLDER_IBAN = ""  # encrypts/decrypts to "" — admin must transcribe.
_PAPER_PLACEHOLDER_VORNAME = "(Papier-Antrag)"
_PAPER_PLACEHOLDER_NACHNAME = "noch nicht erfasst"
_PAPER_PLACEHOLDER_ADDR = "—"
_PAPER_PLACEHOLDER_PLZ = "00000"


_EMAIL_RE = __import__("re").compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@router.post("/upload-paper-form")
async def upload_paper_form(
    request: Request,
    file: UploadFile = File(...),
    email: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Unauthenticated upload of a scanned legacy paper Beitrittserklärung.

    The applicant uploads the scan and may optionally provide an email so the
    club can send a "Scan eingegangen" confirmation. A placeholder
    MembershipApplication row is created with ``status='scan_eingegangen'`` and
    ``source='legacy'`` so the admin sees it in the queue and can transcribe
    the fields from the scan preview.
    """
    import secrets
    import string

    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Nicht erlaubtes Dateiformat. Erlaubt: {', '.join(ALLOWED_UPLOAD_EXTENSIONS)}",
        )
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Datei zu groß (max. 20 MB)")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")

    applicant_email = (email or "").strip() or None
    if applicant_email and not _EMAIL_RE.match(applicant_email):
        raise HTTPException(status_code=400, detail="Ungültige E-Mail-Adresse")

    application = MembershipApplication(
        antragstyp="einzel",
        vorname=_PAPER_PLACEHOLDER_VORNAME,
        nachname=_PAPER_PLACEHOLDER_NACHNAME,
        geburtsdatum=date.today(),
        strasse=_PAPER_PLACEHOLDER_ADDR,
        plz=_PAPER_PLACEHOLDER_PLZ,
        ort=_PAPER_PLACEHOLDER_ADDR,
        telefon=None,
        email=applicant_email,
        abteilungen="[]",
        mitgliedschaft_typ="erwachsener",
        elternteil_mitglied=None,
        jahresbeitrag=0,
        iban=_PAPER_PLACEHOLDER_IBAN,
        consent_at=None,
        datenschutz_accepted=None,
        satzung_accepted=None,
        consent_ip=request.client.host if request.client else None,
        is_test=False,
        source="legacy",
        # Suppress later automated dispatch; the applicant gets a dedicated
        # confirmation below (if email + SMTP available).
        email_sent=True,
        status="scan_eingegangen",
    )
    db.add(application)
    db.flush()

    year = date.today().year
    _charset = string.ascii_uppercase + string.digits
    _charset = _charset.replace("O", "").replace("I", "").replace("L", "").replace("0", "")
    for _attempt in range(20):
        rand_part = "".join(secrets.choice(_charset) for _ in range(6))
        candidate = f"ANT-{year}-{rand_part}"
        exists = db.query(MembershipApplication.id).filter(
            MembershipApplication.antragsnummer == candidate
        ).first()
        if not exists:
            application.antragsnummer = candidate
            break
    else:
        application.antragsnummer = f"ANT-{year}-{uuid.uuid4().hex[:8].upper()}"

    application.upload_token = str(uuid.uuid4())

    filename = f"{application.antragsnummer}_papier_{uuid.uuid4().hex[:8]}{ext}"
    content_type = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic", ".heif": "image/heif",
    }.get(ext, "application/octet-stream")
    storage.upload_file(filename, contents, content_type=content_type)
    application.uploaded_file = filename
    application.uploaded_at = datetime.utcnow()

    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_file(filename)
        raise
    db.refresh(application)

    logger.info(
        "Public paper-form scan received: %s (%d bytes, ext=%s)",
        application.antragsnummer, len(contents), ext,
    )

    posthog_capture(
        "membership_paper_form_uploaded",
        application.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": application.id,
            "antragsnummer": application.antragsnummer,
            "file_extension": ext,
            "file_size_bytes": len(contents),
        },
    )

    # Notify admin so they can start the transcription. Best-effort; the
    # submission is already saved if email fails.
    try:
        app_settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
        if app_settings and app_settings.smtp_host and app_settings.notification_email:
            import asyncio
            from app.routers.admin import _log_email as _log, _make_engine
            from app.config import get_settings as _get_cfg
            from sqlalchemy.orm import sessionmaker as _sm

            _db_url = _get_cfg().database_url
            _smtp = app_settings
            _antragsnummer = application.antragsnummer
            _filename = filename

            async def _notify_admin():
                _eng = _make_engine(_db_url)
                _ldb = _sm(bind=_eng)()
                _subject = f"Papier-Antrag (Scan) eingegangen: {_antragsnummer}"
                _ok, _err = False, None
                try:
                    await send_upload_notification(
                        smtp_host=_smtp.smtp_host,
                        smtp_port=_smtp.smtp_port,
                        smtp_user=_smtp.smtp_user,
                        smtp_password=_smtp.smtp_password,
                        smtp_from=_smtp.smtp_from,
                        smtp_use_tls=_smtp.smtp_use_tls,
                        notification_email=_smtp.notification_email,
                        antragsnummer=_antragsnummer,
                        vorname=_PAPER_PLACEHOLDER_VORNAME,
                        nachname=_PAPER_PLACEHOLDER_NACHNAME,
                        filename=_filename,
                    )
                    _ok = True
                except Exception as _e:
                    _err = _e
                finally:
                    _log(
                        _ldb, "upload_notification", _smtp.notification_email,
                        _subject, _ok, _err,
                        _antragsnummer,
                        _PAPER_PLACEHOLDER_VORNAME, _PAPER_PLACEHOLDER_NACHNAME,
                    )
                    _ldb.close()
                    _eng.dispose()

            asyncio.ensure_future(_notify_admin())
    except Exception as e:
        logger.error(f"Failed to send paper-form notification: {e}")

    # Confirmation to applicant (only if they provided an email).
    if applicant_email:
        try:
            app_settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
            if app_settings and app_settings.smtp_host:
                import asyncio
                from app.schemas.club_config import ClubConfig as _CC

                _smtp = app_settings
                _club = (
                    _smtp.get_club_config().to_template_dict()
                    if _smtp
                    else _CC().to_template_dict()
                )
                _antragsnummer = application.antragsnummer
                _to = applicant_email

                async def _confirm_to_applicant():
                    try:
                        await send_paper_scan_received(
                            smtp_host=_smtp.smtp_host,
                            smtp_port=_smtp.smtp_port,
                            smtp_user=_smtp.smtp_user,
                            smtp_password=_smtp.smtp_password,
                            smtp_from=_smtp.smtp_from,
                            smtp_use_tls=_smtp.smtp_use_tls,
                            applicant_email=_to,
                            antragsnummer=_antragsnummer,
                            club_config=_club,
                        )
                    except Exception as _e:
                        logger.error(f"Failed to send paper-scan confirmation: {_e}")

                asyncio.ensure_future(_confirm_to_applicant())
        except Exception as e:
            logger.error(f"Failed to schedule paper-scan confirmation: {e}")

    return {
        "message": "Scan erfolgreich hochgeladen. Der Verein meldet sich.",
        "antragsnummer": application.antragsnummer,
    }


# --- Status lookup ---

STATUS_LABELS = {
    "neu": "Eingegangen",
    "scan_eingegangen": "Papier-Scan eingegangen",
    "dokument_hochgeladen": "Dokument hochgeladen",
    "in_bearbeitung": "In Bearbeitung",
    "genehmigt": "Genehmigt",
    "abgelehnt": "Abgelehnt",
}

STATUS_ORDER = ["neu", "dokument_hochgeladen", "in_bearbeitung", "genehmigt"]


@router.get("/status/{antragsnummer}")
async def lookup_status(antragsnummer: str, db: Session = Depends(get_db)):
    """Public status lookup by Antragsnummer."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.antragsnummer == antragsnummer.strip().upper()
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antragsnummer nicht gefunden")

    posthog_capture(
        "membership_status_lookup",
        app.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "status": app.status,
            "has_upload": app.uploaded_file is not None,
            "days_since_submission": _days_since(app.created_at),
        },
    )

    result = {
        "antragsnummer": app.antragsnummer,
        "status": app.status,
        "status_label": STATUS_LABELS.get(app.status, app.status),
        "created_at": app.created_at.isoformat() if app.created_at else None,
        "uploaded_at": app.uploaded_at.isoformat() if app.uploaded_at else None,
        "has_upload": app.uploaded_file is not None,
    }
    if app.status == "abgelehnt" and app.admin_decline_reason:
        result["admin_decline_reason"] = app.admin_decline_reason
    return result
