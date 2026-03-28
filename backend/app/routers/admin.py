import csv
import io
import json
import logging
import uuid
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

from app.services.posthog import capture as posthog_capture, get_admin_distinct_id
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from app.config import get_settings, Settings
from app.database import get_db
from app.models.application import MembershipApplication
from app.models.cancellation_letter import CancellationLetter
from app.models.settings import AppSettings
from app.models.email_log import EmailLog
from app.schemas.application import (
    AdminStatsResponse,
    ApplicationResponse,
    ApplicationListResponse,
    ApplicationUpdate,
)
from app.schemas.settings import (
    AdminLoginRequest,
    SettingsResponse,
    SettingsUpdate,
    TestSmtpRequest,
)
from app.schemas.cancellation import CancellationLetterResponse
from app.services.email import send_test_email
from app.services.fees import calculate_fee
from app.services.pdf import (
    generate_pdf,
    generate_cancellation_pdf,
    generate_approval_page,
    merge_pdf_with_approval,
)
from app.services.crypto import decrypt_iban_safe
from app.services.email import send_status_email
from app.services import storage
from app.services.rate_limit import (
    is_rate_limited,
    normalize_client_ip,
    record_failed_attempt,
    reset_rate_limit,
)
from app.routers.public import _build_application_data, _compute_anrede, _format_iban, _send_email_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])
ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60
ADMIN_LOGIN_LIMIT = 5
ADMIN_LOGIN_BLOCK_SECONDS = 30 * 60


def _hours_since(ts: datetime | None) -> float | None:
    if not ts:
        return None
    return round((datetime.utcnow() - ts).total_seconds() / 3600, 3)


def _email_app_area(email_type: str) -> str:
    if email_type in {"status_update", "test"}:
        return "admin"
    return "public"


def _validate_filename(filename: str) -> None:
    """Validate filename to prevent path traversal and invalid keys."""
    if not filename or filename.strip() == "":
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")
    if ".." in filename or "/" in filename or "\\" in filename:
        logger.warning(f"Blocked invalid upload path reference: {filename}")
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")


def _safe_content_disposition(disposition: str, filename: str) -> str:
    """Build a Content-Disposition header with RFC 5987 encoded filename.

    Handles umlauts, apostrophes, quotes, and other special characters safely.
    """
    # ASCII fallback: replace non-ASCII chars with underscores
    ascii_name = filename.encode("ascii", errors="replace").decode().replace('"', "_")
    # UTF-8 encoded version for modern browsers
    encoded_name = quote(filename, safe="")
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"


def _make_engine(db_url: str):
    """Create a short-lived SQLAlchemy engine appropriate for the given URL."""
    from sqlalchemy import create_engine as _ce
    if db_url.startswith("sqlite"):
        return _ce(db_url, connect_args={"check_same_thread": False})
    return _ce(db_url, pool_pre_ping=True, pool_size=1, max_overflow=0)


def _log_email(
    db: Session,
    email_type: str,
    recipient: str,
    subject: str | None,
    success: bool,
    error: Exception | None = None,
    antragsnummer: str | None = None,
    vorname: str | None = None,
    nachname: str | None = None,
) -> None:
    """Persist one outgoing email attempt to the email_logs table."""
    try:
        entry = EmailLog(
            email_type=email_type,
            recipient=recipient,
            subject=subject,
            status="success" if success else "failed",
            error_message=str(error) if error else None,
            antragsnummer=antragsnummer,
            vorname=vorname,
            nachname=nachname,
        )
        db.add(entry)
        db.commit()
        posthog_capture(
            "email_delivery_result",
            antragsnummer or "system:email",
            properties={
                "app_area": _email_app_area(email_type),
                "source": "backend",
                "email_type": email_type,
                "result": "success" if success else "failed",
                "antragsnummer": antragsnummer,
                "has_application": bool(antragsnummer),
                "has_error": bool(error),
            },
        )
    except Exception as log_err:
        logger.error(f"Failed to write email log: {log_err}")


def get_serializer(settings: Settings = None) -> URLSafeTimedSerializer:
    if settings is None:
        settings = get_settings()
    return URLSafeTimedSerializer(settings.cookie_secret)


def require_admin(request: Request) -> bool:
    """Dependency to check admin authentication."""
    settings = get_settings()
    cookie = request.cookies.get(settings.cookie_name)
    if not cookie:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    try:
        serializer = get_serializer(settings)
        serializer.loads(cookie, max_age=settings.session_max_age)
        return True
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Sitzung abgelaufen")


def _get_or_create_settings(db: Session) -> AppSettings:
    """Get or create the singleton settings row."""
    settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not settings:
        settings = AppSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _serialize_settings(settings: AppSettings) -> SettingsResponse:
    return SettingsResponse(
        smtp_host=settings.smtp_host,
        smtp_port=settings.smtp_port,
        smtp_user=settings.smtp_user,
        smtp_password_configured=bool(settings.smtp_password),
        smtp_from=settings.smtp_from,
        smtp_use_tls=settings.smtp_use_tls,
        notification_email=settings.notification_email,
        admin_signature_base64=settings.admin_signature_base64,
    )


# --- Auth ---

@router.post("/login")
async def admin_login(
    data: AdminLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    settings = get_settings()
    client_ip = normalize_client_ip(request.client.host if request.client else None)
    limit_status = is_rate_limited(
        db,
        scope="admin_login",
        key=client_ip,
        window_seconds=ADMIN_LOGIN_WINDOW_SECONDS,
    )
    if not limit_status.allowed:
        logger.warning("Admin login blocked (rate limited) from %s", client_ip)
        posthog_capture(
            "admin_login_failed",
            get_admin_distinct_id(request),
            properties={
                "app_area": "admin",
                "source": "backend",
                "reason": "rate_limited",
            },
        )
        raise HTTPException(
            status_code=429,
            detail="Zu viele fehlgeschlagene Anmeldeversuche. Bitte versuchen Sie es später erneut.",
        )

    if data.password != settings.admin_password:
        failure_status = record_failed_attempt(
            db,
            scope="admin_login",
            key=client_ip,
            limit=ADMIN_LOGIN_LIMIT,
            window_seconds=ADMIN_LOGIN_WINDOW_SECONDS,
            block_seconds=ADMIN_LOGIN_BLOCK_SECONDS,
        )
        if not failure_status.allowed:
            posthog_capture(
                "admin_login_failed",
                get_admin_distinct_id(request),
                properties={
                    "app_area": "admin",
                    "source": "backend",
                    "reason": "rate_limited",
                },
            )
            raise HTTPException(
                status_code=429,
                detail="Zu viele fehlgeschlagene Anmeldeversuche. Bitte versuchen Sie es später erneut.",
            )
        logger.warning("Admin login failed (wrong password) from %s", client_ip)
        posthog_capture(
            "admin_login_failed",
            get_admin_distinct_id(request),
            properties={
                "app_area": "admin",
                "source": "backend",
                "reason": "unauthorized",
            },
        )
        raise HTTPException(status_code=401, detail="Falsches Passwort")

    reset_rate_limit(db, scope="admin_login", key=client_ip)
    logger.info("Admin login successful from %s", client_ip)
    serializer = get_serializer(settings)
    token = serializer.dumps({"admin": True})

    posthog_capture(
        "admin_login",
        get_admin_distinct_id(request),
        properties={"app_area": "admin", "source": "backend"},
    )

    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_max_age,
        path="/",
    )
    return {"message": "Angemeldet"}


@router.post("/logout")
async def admin_logout(request: Request, response: Response):
    settings = get_settings()
    posthog_capture(
        "admin_logout",
        get_admin_distinct_id(request),
        properties={"app_area": "admin", "source": "backend"},
    )
    response.delete_cookie(key=settings.cookie_name, path="/")
    return {"message": "Abgemeldet"}


@router.get("/me")
async def admin_check(is_admin: bool = Depends(require_admin)):
    return {"authenticated": True}


# --- Stats ---

@router.get("/stats", response_model=AdminStatsResponse)
async def get_stats(
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from decimal import Decimal

    # Exclude test applications from stats
    base_q = db.query(MembershipApplication).filter(
        (MembershipApplication.is_test == False) | (MembershipApplication.is_test == None)  # noqa: E712, E711
    )
    total = base_q.count()

    status_rows = (
        base_q.with_entities(MembershipApplication.status, func.count(MembershipApplication.id))
        .group_by(MembershipApplication.status)
        .all()
    )
    by_status = {s: c for s, c in status_rows}

    revenue = (
        base_q.with_entities(func.sum(MembershipApplication.jahresbeitrag))
        .filter(MembershipApplication.status == "genehmigt")
        .scalar()
    ) or Decimal("0")

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    this_month = (
        base_q.with_entities(func.count(MembershipApplication.id))
        .filter(MembershipApplication.created_at >= month_start)
        .scalar()
    ) or 0

    # --- Extended stats: abteilung, age, membership type, gender ---
    all_apps = base_q.with_entities(
        MembershipApplication.abteilungen,
        MembershipApplication.geburtsdatum,
        MembershipApplication.mitgliedschaft_typ,
        MembershipApplication.geschlecht,
    ).all()

    by_abteilung: dict[str, int] = {}
    by_age_group: dict[str, int] = {"Unter 14": 0, "14-17": 0, "18-26": 0, "27-59": 0, "60+": 0}
    by_membership_type: dict[str, int] = {}
    by_gender: dict[str, int] = {}

    today = now.date()
    for abt_json, geb, mtyp, geschlecht in all_apps:
        # Abteilungen (JSON array)
        try:
            abteilungen = json.loads(abt_json) if abt_json else []
        except (json.JSONDecodeError, TypeError):
            abteilungen = []
        for abt in abteilungen:
            by_abteilung[abt] = by_abteilung.get(abt, 0) + 1

        # Age groups
        if geb:
            age = today.year - geb.year - ((today.month, today.day) < (geb.month, geb.day))
            if age < 14:
                by_age_group["Unter 14"] += 1
            elif age < 18:
                by_age_group["14-17"] += 1
            elif age < 27:
                by_age_group["18-26"] += 1
            elif age < 60:
                by_age_group["27-59"] += 1
            else:
                by_age_group["60+"] += 1

        # Membership type
        if mtyp:
            by_membership_type[mtyp] = by_membership_type.get(mtyp, 0) + 1

        # Gender
        if geschlecht:
            by_gender[geschlecht] = by_gender.get(geschlecht, 0) + 1

    return AdminStatsResponse(
        total=total,
        by_status=by_status,
        revenue_approved=revenue,
        applications_this_month=this_month,
        by_abteilung=by_abteilung,
        by_age_group=by_age_group,
        by_membership_type=by_membership_type,
        by_gender=by_gender,
    )


# --- Applications ---

@router.get("/applications", response_model=ApplicationListResponse)
async def list_applications(
    page: int = 1,
    per_page: int = 25,
    status: str | None = None,
    search: str | None = None,
    show_test: bool | None = None,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(MembershipApplication)

    if status:
        query = query.filter(MembershipApplication.status == status)

    if show_test is not None:
        if show_test:
            query = query.filter(MembershipApplication.is_test == True)  # noqa: E712
        else:
            query = query.filter(
                (MembershipApplication.is_test == False) | (MembershipApplication.is_test == None)  # noqa: E712, E711
            )

    if search:
        # Escape LIKE wildcards so literal %, _, \ in search terms don't match unintended rows
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_term = f"%{escaped}%"
        query = query.filter(
            or_(
                MembershipApplication.vorname.ilike(search_term, escape="\\"),
                MembershipApplication.nachname.ilike(search_term, escape="\\"),
                MembershipApplication.email.ilike(search_term, escape="\\"),
                MembershipApplication.ort.ilike(search_term, escape="\\"),
            )
        )

    total = query.count()
    applications = (
        query.order_by(MembershipApplication.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return ApplicationListResponse(
        items=[ApplicationResponse.model_validate(app) for app in applications],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/applications/{application_id}", response_model=ApplicationResponse)
async def get_application(
    application_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    return ApplicationResponse.model_validate(app)


@router.patch("/applications/{application_id}", response_model=ApplicationResponse)
async def update_application(
    application_id: int,
    data: ApplicationUpdate,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    old_status = app.status
    old_notes = app.notes
    settings_obj = _get_or_create_settings(db)

    if data.status is not None:
        app.status = data.status
    if data.notes is not None:
        app.notes = data.notes

    # When changing to genehmigt: require admin signature, generate & store approved PDF
    if data.status == "genehmigt" and old_status != "genehmigt":
        effective_sig = data.admin_unterschrift_base64
        if not effective_sig and data.use_saved_admin_signature and settings_obj.admin_signature_base64:
            effective_sig = settings_obj.admin_signature_base64
        if not effective_sig:
            raise HTTPException(
                status_code=400,
                detail="Bei Genehmigung ist eine Signatur erforderlich (zeichnen, hochladen oder gespeicherte Admin-Signatur verwenden)",
            )
        approval_datum = datetime.utcnow().strftime("%d.%m.%Y")
        antragsnummer = app.antragsnummer or f"ANT-{app.id}"
        # applicant_name for "Guten Tag X," - gender-neutral full name
        # For Kind applications, use parent (Erziehungsberechtigte/r) as contact
        antragstyp = app.antragstyp or "einzel"
        if antragstyp == "kind" and (app.erziehungsberechtigter_vorname or app.erziehungsberechtigter_nachname):
            applicant_name = f"{app.erziehungsberechtigter_vorname or ''} {app.erziehungsberechtigter_nachname or ''}".strip()
        else:
            applicant_name = f"{app.vorname} {app.nachname}"
        if data.mitgliedsnummer:
            app.mitgliedsnummer = data.mitgliedsnummer.strip()
        approval_page_bytes = generate_approval_page(
            admin_unterschrift_base64=effective_sig,
            approval_datum=approval_datum,
            antragsnummer=antragsnummer,
            applicant_name=applicant_name,
            mandatsreferenz=app.mandatsreferenz or "",
            mitgliedsnummer=app.mitgliedsnummer or "",
        )
        if app.uploaded_file:
            base_bytes = storage.download_file(app.uploaded_file)
            if base_bytes:
                pdf_bytes = merge_pdf_with_approval(base_bytes, approval_page_bytes)
            else:
                app_data = _build_application_data(app)
                app_data["admin_unterschrift_base64"] = effective_sig
                app_data["approval_datum"] = approval_datum
                pdf_bytes = generate_pdf(app_data)
        else:
            app_data = _build_application_data(app)
            app_data["admin_unterschrift_base64"] = effective_sig
            app_data["approval_datum"] = approval_datum
            pdf_bytes = generate_pdf(app_data)
        approved_filename = f"{antragsnummer}_approved.pdf"
        storage.upload_file(approved_filename, pdf_bytes, content_type="application/pdf")
        app.admin_approved_file = approved_filename
        app.admin_decline_reason = None

    # When changing to abgelehnt: require reason, clear approved file
    if data.status == "abgelehnt" and old_status != "abgelehnt":
        if not data.admin_decline_reason or not str(data.admin_decline_reason).strip():
            raise HTTPException(
                status_code=400,
                detail="Bei Ablehnung ist eine Begründung erforderlich (wird dem Antragsteller mitgeteilt)",
            )
        app.admin_decline_reason = data.admin_decline_reason.strip()
        app.admin_approved_file = None

    # Clear decline reason when changing away from abgelehnt; clear approved file when changing away from genehmigt
    if data.status and data.status != "abgelehnt":
        app.admin_decline_reason = None
    if data.status and data.status != "genehmigt":
        app.admin_approved_file = None

    db.commit()
    db.refresh(app)

    # Track status changes for approve/decline
    new_status = app.status
    admin_distinct_id = get_admin_distinct_id(request)
    if new_status != old_status:
        shared_status_props = {
            "app_area": "admin",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "antragstyp": app.antragstyp or "einzel",
            "mitgliedschaft_typ": app.mitgliedschaft_typ,
            "previous_status": old_status,
            "new_status": new_status,
            "status": new_status,
            "hours_since_submission": _hours_since(app.created_at),
            "hours_since_upload": _hours_since(app.uploaded_at),
            "has_upload": bool(app.uploaded_file),
            "has_approved_file": bool(app.admin_approved_file),
        }
        posthog_capture(
            "admin_application_status_changed",
            admin_distinct_id,
            properties=shared_status_props,
        )
        if new_status == "genehmigt":
            posthog_capture(
                "membership_application_approved",
                admin_distinct_id,
                properties=shared_status_props,
            )
        elif new_status == "abgelehnt":
            posthog_capture(
                "membership_application_rejected",
                admin_distinct_id,
                properties=shared_status_props,
            )
    elif data.notes is not None and app.notes != old_notes:
        posthog_capture(
            "admin_application_notes_updated",
            admin_distinct_id,
            properties={
                "app_area": "admin",
                "source": "backend",
                "application_id": app.id,
                "antragsnummer": app.antragsnummer,
                "status": app.status,
                "has_upload": bool(app.uploaded_file),
                "has_approved_file": bool(app.admin_approved_file),
            },
        )

    # Send status email to applicant on approve/decline
    if new_status != old_status and new_status in ("genehmigt", "abgelehnt"):
        try:
            if settings_obj.smtp_host:
                import asyncio
                from app.config import get_settings as _get_cfg

                _snap_email = app.email
                _snap_vorname = app.vorname
                _snap_nachname = app.nachname
                _snap_antragsnummer = app.antragsnummer
                _snap_anrede = _compute_anrede(app)
                _snap_status = new_status
                _snap_db_url = _get_cfg().database_url
                _snap_decline_reason = app.admin_decline_reason
                _snap_approved_file = app.admin_approved_file
                _snap_mitgliedsnummer = app.mitgliedsnummer

                async def _send_status_and_log():
                    from sqlalchemy.orm import sessionmaker as _sm
                    _eng = _make_engine(_snap_db_url)
                    _log_db = _sm(bind=_eng)()
                    _subject = (
                        "Ihre Mitgliedschaft wurde genehmigt"
                        if _snap_status == "genehmigt"
                        else "Ihre Mitgliedschaft wurde abgelehnt"
                    )
                    _err = None
                    _ok = False
                    pdf_bytes = None
                    pdf_filename = None
                    if _snap_status == "genehmigt" and _snap_approved_file:
                        pdf_bytes = storage.download_file(_snap_approved_file)
                        pdf_filename = f"Beitrittserklaerung_genehmigt_{_snap_nachname}_{_snap_vorname}.pdf"
                    try:
                        await send_status_email(
                            smtp_host=settings_obj.smtp_host,
                            smtp_port=settings_obj.smtp_port,
                            smtp_user=settings_obj.smtp_user,
                            smtp_password=settings_obj.smtp_password,
                            smtp_from=settings_obj.smtp_from,
                            smtp_use_tls=settings_obj.smtp_use_tls,
                            applicant_email=_snap_email,
                            vorname=_snap_vorname,
                            nachname=_snap_nachname,
                            antragsnummer=_snap_antragsnummer,
                            status=_snap_status,
                            anrede=_snap_anrede,
                            decline_reason=_snap_decline_reason,
                            pdf_bytes=pdf_bytes,
                            pdf_filename=pdf_filename,
                            mitgliedsnummer=_snap_mitgliedsnummer,
                        )
                        _ok = True
                    except Exception as _exc:
                        _err = _exc
                    finally:
                        _log_email(_log_db, "status_update", _snap_email, _subject, _ok, _err,
                                   _snap_antragsnummer, _snap_vorname, _snap_nachname)
                        _log_db.close()
                        _eng.dispose()

                asyncio.ensure_future(_send_status_and_log())
        except Exception as e:
            logger.error(f"Failed to send status email: {e}")

    return ApplicationResponse.model_validate(app)


@router.delete("/applications/{application_id}")
async def delete_application(
    application_id: int,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    storage_keys = storage.collect_application_storage_keys(app)
    _antragsnummer = app.antragsnummer
    _antragstyp = app.antragstyp or "einzel"
    _status = app.status
    _had_upload = bool(app.uploaded_file)
    _had_approved_file = bool(app.admin_approved_file)
    db.delete(app)
    db.commit()

    posthog_capture(
        "membership_application_deleted",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "application_id": application_id,
            "antragsnummer": _antragsnummer,
            "antragstyp": _antragstyp,
            "status_at_delete": _status,
            "had_upload": _had_upload,
            "had_approved_file": _had_approved_file,
        },
    )

    for key in storage_keys:
        try:
            storage.delete_file(key)
        except Exception as exc:
            logger.error(
                "Failed to delete storage object after application deletion: app_id=%s key=%s error=%s",
                application_id,
                key,
                exc,
            )
    return {"message": "Antrag gelöscht"}


@router.post("/applications/{application_id}/resend-email")
async def resend_email(
    application_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Re-send confirmation + admin notification email for an application."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    settings_obj = _get_or_create_settings(db)
    if not settings_obj.smtp_host:
        raise HTTPException(status_code=400, detail="SMTP ist nicht konfiguriert")

    from app.config import get_settings
    cfg = get_settings()
    background_tasks.add_task(_send_email_task, application_id, cfg.database_url)

    posthog_capture(
        "membership_application_email_resent",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "status": app.status,
        },
    )

    return {"message": "E-Mail wird erneut gesendet"}


@router.get("/applications/{application_id}/pdf")
async def download_pdf(
    application_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    data = _build_application_data(app)

    # For online-signed applications, reuse the stored signed PDF (which contains
    # the embedded signature) instead of regenerating an unsigned blank form.
    if app.uploaded_file and app.uploaded_file.endswith("_signed.pdf"):
        pdf_bytes = storage.download_file(app.uploaded_file)
        if pdf_bytes is None:
            pdf_bytes = generate_pdf(data)
    else:
        pdf_bytes = generate_pdf(data)

    filename = f"Beitrittserklaerung_{app.nachname}_{app.vorname}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
    )


@router.get("/applications/{application_id}/upload")
async def download_upload(
    application_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Download the uploaded signed document for an application."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    if not app.uploaded_file:
        raise HTTPException(status_code=404, detail="Kein Dokument hochgeladen")

    _validate_filename(app.uploaded_file)
    content = storage.download_file(app.uploaded_file)
    if content is None:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")

    ext = Path(app.uploaded_file).suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic",
        ".heif": "image/heif",
    }
    media_type = media_types.get(ext, "application/octet-stream")
    filename = f"Upload_{app.nachname}_{app.vorname}{ext}"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": _safe_content_disposition("inline", filename),
        },
    )


@router.delete("/applications/{application_id}/upload")
async def delete_upload(
    application_id: int,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete the uploaded document for an application."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    if not app.uploaded_file:
        raise HTTPException(status_code=404, detail="Kein Dokument hochgeladen")

    filename = app.uploaded_file
    previous_status = app.status
    app.uploaded_file = None
    app.uploaded_at = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    storage.delete_file(filename)
    posthog_capture(
        "admin_uploaded_document_deleted",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "previous_status": previous_status,
        },
    )
    return {"ok": True}


@router.get("/applications/{application_id}/approved")
async def download_approved(
    application_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Download the cross-signed approval document for an application."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    if not app.admin_approved_file:
        raise HTTPException(status_code=404, detail="Kein Genehmigungsdokument vorhanden")

    _validate_filename(app.admin_approved_file)
    content = storage.download_file(app.admin_approved_file)
    if content is None:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")

    filename = f"Beitrittserklaerung_genehmigt_{app.nachname}_{app.vorname}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": _safe_content_disposition("inline", filename),
        },
    )


@router.delete("/applications/{application_id}/approved")
async def delete_approved(
    application_id: int,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete the cross-signed approval document for an application."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    if not app.admin_approved_file:
        raise HTTPException(status_code=404, detail="Kein Genehmigungsdokument vorhanden")

    filename = app.admin_approved_file
    app.admin_approved_file = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    storage.delete_file(filename)
    posthog_capture(
        "admin_approved_document_deleted",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
        },
    )
    return {"ok": True}


@router.post("/applications/{application_id}/admin-upload")
async def admin_upload_document(
    application_id: int,
    request: Request,
    file: UploadFile = File(...),
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-initiated upload of a signed document for an application."""
    import uuid as _uuid

    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"}
    MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Nicht erlaubtes Dateiformat. Erlaubt: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Datei zu groß (max. 20 MB)")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")

    old_filename = app.uploaded_file

    filename = f"{app.antragsnummer}_admin_{_uuid.uuid4().hex[:8]}{ext}"
    content_type = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic", ".heif": "image/heif",
    }.get(ext, "application/octet-stream")
    storage.upload_file(filename, contents, content_type=content_type)

    app.uploaded_file = filename
    app.uploaded_at = datetime.utcnow()
    if app.status == "neu":
        app.status = "dokument_hochgeladen"

    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_file(filename)
        raise
    db.refresh(app)

    # Remove previous upload only after the new DB state was committed.
    if old_filename:
        storage.delete_file(old_filename)

    posthog_capture(
        "admin_document_uploaded",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "file_extension": ext,
            "file_size_bytes": len(contents),
            "replaced_existing": bool(old_filename),
            "status_after_upload": app.status,
        },
    )

    return ApplicationResponse.model_validate(app)


# --- Test data for admin test mode ---

@router.get("/test-data")
async def get_test_data(
    type: str = "einzel",
    is_admin: bool = Depends(require_admin),
):
    """Return realistic sample data for pre-filling the application form in test mode."""
    if type not in ("einzel", "kind", "familie"):
        raise HTTPException(status_code=400, detail="Ungültiger Typ. Erlaubt: einzel, kind, familie")

    base = {
        "geschlecht": "Herr",
        "vorname": "Max",
        "nachname": "Mustermann",
        "geburtsdatum": "1990-05-15",
        "strasse": "Hauptstraße 12",
        "plz": "97528",
        "ort": "Sulzdorf a.d.L.",
        "email": "test@sv-untereuerheim.de",
        "telefon": "09727 1234567",
        "abteilungen": ["Fußball"],
        "kontoinhaber": "Max Mustermann",
        "iban": "DE89370400440532013000",
        "bic": "COBADEFFXXX",
        "kreditinstitut": "Commerzbank",
    }

    if type == "einzel":
        return {**base, "membership_type": "einzel"}

    if type == "kind":
        return {
            **base,
            "membership_type": "kind",
            "geschlecht": None,
            "vorname": "Lina",
            "nachname": "Müller",
            "geburtsdatum": "2014-03-22",
            "abteilungen": ["Kinderturnen"],
            "erziehungsberechtigter_vorname": "Sabine",
            "erziehungsberechtigter_nachname": "Müller",
            "elternteil_mitglied": False,
            "kontoinhaber": "Sabine Müller",
            "email": "test-kind@sv-untereuerheim.de",
        }

    # familie
    return {
        **base,
        "membership_type": "familie",
        "vorname": "Thomas",
        "nachname": "Schneider",
        "geburtsdatum": "1985-08-10",
        "email": "test-familie@sv-untereuerheim.de",
        "kontoinhaber": "Thomas Schneider",
        "partner_vorname": "Anna",
        "partner_nachname": "Schneider",
        "partner_geburtsdatum": "1987-11-03",
        "partner_abteilungen": ["Yoga"],
        "kinder": [
            {
                "vorname": "Emma",
                "nachname": "Schneider",
                "geburtsdatum": "2015-06-20",
                "abteilungen": ["Kinderturnen"],
            },
            {
                "vorname": "Paul",
                "nachname": "Schneider",
                "geburtsdatum": "2018-01-14",
                "abteilungen": ["Kinderturnen"],
            },
        ],
    }


@router.get("/export")
async def export_csv(
    request: Request,
    include_test: bool = False,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(MembershipApplication)
    if not include_test:
        query = query.filter(
            (MembershipApplication.is_test == False) | (MembershipApplication.is_test == None)  # noqa: E712, E711
        )
    applications = query.order_by(MembershipApplication.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow([
        "Mitgliedsnr", "Antragstyp", "Anrede", "Nachname", "Vorname", "Geburtsdatum",
        "Straße", "PLZ", "Ort", "Telefon", "E-Mail",
        "Erz.berecht. Vorname", "Erz.berecht. Nachname",
        "Kinder (JSON)",
        "Abteilungen", "Mitgliedschaftstyp", "Elternteil Mitglied",
        "Jahresbeitrag", "Kontoinhaber", "IBAN", "BIC", "Kreditinstitut",
        "Status", "Notizen", "E-Mail gesendet", "Eingereicht am",
        "Datenschutz akzeptiert", "Satzung akzeptiert", "Einwilligung am", "Einwilligung IP",
    ])

    for app in applications:
        writer.writerow([
            app.id, app.antragstyp or "einzel", app.geschlecht or "",
            app.nachname, app.vorname,
            app.geburtsdatum.strftime("%d.%m.%Y"),
            app.strasse, app.plz, app.ort, app.telefon or "", app.email,
            app.erziehungsberechtigter_vorname or "",
            app.erziehungsberechtigter_nachname or "",
            app.kinder or "",
            ", ".join(app.get_abteilungen()), app.mitgliedschaft_typ,
            "Ja" if app.elternteil_mitglied else ("Nein" if app.elternteil_mitglied is False else ""),
            f"{app.jahresbeitrag:.2f}",
            app.kontoinhaber or "", decrypt_iban_safe(app.iban), app.bic or "", app.kreditinstitut or "",
            app.status, app.notes or "",
            "Ja" if app.email_sent else "Nein",
            app.created_at.strftime("%d.%m.%Y %H:%M"),
            "Ja" if app.datenschutz_accepted else ("Nein" if app.datenschutz_accepted is False else "N/A"),
            "Ja" if app.satzung_accepted else ("Nein" if app.satzung_accepted is False else "N/A"),
            app.consent_at.strftime("%d.%m.%Y %H:%M") if app.consent_at else "N/A",
            app.consent_ip or "N/A",
        ])

    posthog_capture(
        "members_csv_exported",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "record_count": len(applications),
        },
    )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mitglieder_export.csv"'},
    )


# --- Settings ---

@router.get("/settings", response_model=SettingsResponse)
async def get_admin_settings(
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db)
    return _serialize_settings(settings)


@router.put("/settings", response_model=SettingsResponse)
async def update_admin_settings(
    data: SettingsUpdate,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db)
    previous = {
        "smtp_host": settings.smtp_host,
        "smtp_from": settings.smtp_from,
        "notification_email": settings.notification_email,
        "smtp_use_tls": settings.smtp_use_tls,
        "admin_signature_base64": settings.admin_signature_base64,
        "smtp_password": settings.smtp_password,
    }

    update_data = data.model_dump(exclude_unset=True)
    clear_smtp_password = update_data.pop("clear_smtp_password", False)
    smtp_password = update_data.pop("smtp_password", None)

    for key, value in update_data.items():
        setattr(settings, key, value)

    if clear_smtp_password:
        settings.smtp_password = ""
    elif smtp_password:
        settings.smtp_password = smtp_password

    db.commit()
    db.refresh(settings)
    posthog_capture(
        "admin_settings_updated",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "smtp_changed": previous["smtp_host"] != settings.smtp_host,
            "smtp_from_changed": previous["smtp_from"] != settings.smtp_from,
            "notification_email_changed": previous["notification_email"] != settings.notification_email,
            "tls_changed": previous["smtp_use_tls"] != settings.smtp_use_tls,
            "password_updated": bool(smtp_password),
            "password_cleared": clear_smtp_password,
            "signature_changed": previous["admin_signature_base64"] != settings.admin_signature_base64,
        },
    )
    return _serialize_settings(settings)


@router.post("/settings/test-smtp")
async def test_smtp(
    data: TestSmtpRequest,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db)

    if not settings.smtp_host:
        raise HTTPException(status_code=400, detail="SMTP ist nicht konfiguriert")

    _test_err = None
    try:
        await send_test_email(
            smtp_host=settings.smtp_host,
            smtp_port=settings.smtp_port,
            smtp_user=settings.smtp_user,
            smtp_password=settings.smtp_password,
            smtp_from=settings.smtp_from,
            smtp_use_tls=settings.smtp_use_tls,
            recipient=data.recipient,
        )
        _log_email(db, "test", data.recipient, "Test-E-Mail", True)
        posthog_capture(
            "admin_smtp_test_result",
            get_admin_distinct_id(request),
            properties={"app_area": "admin", "source": "backend", "result": "success"},
        )
        return {"message": "Test-E-Mail wurde erfolgreich gesendet"}
    except Exception as e:
        _test_err = e
        _log_email(db, "test", data.recipient, "Test-E-Mail", False, _test_err)
        posthog_capture(
            "admin_smtp_test_result",
            get_admin_distinct_id(request),
            properties={"app_area": "admin", "source": "backend", "result": "failed"},
        )
        raise HTTPException(status_code=500, detail=f"SMTP-Fehler: {str(e)}")


# --- Cancellation PDF ---

class CancellationRequest(BaseModel):
    anrede: str  # "Herr", "Frau", or "keine Angabe"
    vorname: str
    nachname: str
    strasse: str
    plz: str
    ort: str
    geburtsdatum: str
    mitgliedsnummer: str | None = None
    abteilung: str | None = None
    austritt_datum: str
    unterschrift_base64: str | None = None  # data-URL from signature canvas
    use_saved_admin_signature: bool = True
    # Optional: separate recipient (parent/payer) when different from the member
    empfaenger_abweichend: bool = False
    empfaenger_anrede: str | None = None
    empfaenger_vorname: str | None = None
    empfaenger_nachname: str | None = None
    empfaenger_strasse: str | None = None
    empfaenger_plz: str | None = None
    empfaenger_ort: str | None = None


@router.post("/cancellation-pdf")
async def cancellation_pdf(
    data: CancellationRequest,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Generate a cancellation confirmation PDF."""
    settings = _get_or_create_settings(db)
    effective_signature = data.unterschrift_base64
    signature_source = "none"
    if effective_signature:
        signature_source = "request"
    elif data.use_saved_admin_signature and settings.admin_signature_base64:
        effective_signature = settings.admin_signature_base64
        signature_source = "admin_saved"

    # Determine recipient: use separate parent/payer fields if provided
    ist_empfaenger_abweichend = (
        data.empfaenger_abweichend
        and data.empfaenger_vorname
        and data.empfaenger_nachname
    )
    if ist_empfaenger_abweichend:
        e_anrede = data.empfaenger_anrede or "keine Angabe"
        e_vorname = data.empfaenger_vorname
        e_nachname = data.empfaenger_nachname
        e_strasse = data.empfaenger_strasse or data.strasse
        e_plz = data.empfaenger_plz or data.plz
        e_ort = data.empfaenger_ort or data.ort
    else:
        e_anrede = data.anrede
        e_vorname = data.vorname
        e_nachname = data.nachname
        e_strasse = data.strasse
        e_plz = data.plz
        e_ort = data.ort

    def _resolve_anrede(anrede: str, vorname: str, nachname: str):
        if anrede == "keine Angabe":
            return f"Guten Tag {vorname} {nachname}", ""
        anrede_map = {
            "Herr": ("Sehr geehrter Herr", "Herrn"),
            "Frau": ("Sehr geehrte Frau", "Frau"),
        }
        greeting, text = anrede_map.get(anrede, ("Sehr geehrte/r", ""))
        return f"{greeting} {nachname}", text

    empfaenger_anrede_full, empfaenger_anrede_text = _resolve_anrede(
        e_anrede, e_vorname, e_nachname
    )

    pdf_data = {
        "empfaenger_anrede": empfaenger_anrede_full,
        "empfaenger_anrede_text": empfaenger_anrede_text,
        "empfaenger_vorname": e_vorname,
        "empfaenger_nachname": e_nachname,
        "empfaenger_strasse": e_strasse,
        "empfaenger_plz": e_plz,
        "empfaenger_ort": e_ort,
        "ist_empfaenger_abweichend": bool(ist_empfaenger_abweichend),
        "vorname": data.vorname,
        "nachname": data.nachname,
        "strasse": data.strasse,
        "plz": data.plz,
        "ort": data.ort,
        "geburtsdatum": data.geburtsdatum,
        "mitgliedsnummer": data.mitgliedsnummer or "",
        "abteilung": data.abteilung or "",
        "austritt_datum": data.austritt_datum,
        "datum": datetime.now().strftime("%d.%m.%Y"),
        "unterschrift_base64": effective_signature,
    }

    pdf_bytes = generate_cancellation_pdf(pdf_data)

    stored_filename = (
        f"kuendigung_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.pdf"
    )
    storage.upload_file(stored_filename, pdf_bytes, content_type="application/pdf")

    letter = CancellationLetter(
        anrede=data.anrede,
        vorname=data.vorname,
        nachname=data.nachname,
        strasse=data.strasse,
        plz=data.plz,
        ort=data.ort,
        geburtsdatum=data.geburtsdatum,
        mitgliedsnummer=data.mitgliedsnummer,
        abteilung=data.abteilung,
        austritt_datum=data.austritt_datum,
        signature_source=signature_source,
        filename=stored_filename,
        display_name=f"{data.nachname}, {data.vorname}",
    )
    db.add(letter)
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_file(stored_filename)
        raise

    posthog_capture(
        "cancellation_pdf_generated",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "signature_source": signature_source,
            "has_mitgliedsnummer": bool(data.mitgliedsnummer),
        },
    )

    filename = f"Kuendigungsbestaetigung_{data.nachname}_{data.vorname}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
    )


@router.get("/cancellation-documents", response_model=list[CancellationLetterResponse])
def list_cancellation_documents(
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = 500,
):
    """List stored cancellation letters, newest first."""
    safe_limit = max(1, min(limit, 1000))
    rows = (
        db.query(CancellationLetter)
        .order_by(CancellationLetter.created_at.desc(), CancellationLetter.id.desc())
        .limit(safe_limit)
        .all()
    )
    return [CancellationLetterResponse.model_validate(r) for r in rows]


@router.get("/cancellation-documents/{document_id}/download")
def download_cancellation_document(
    document_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    doc = db.query(CancellationLetter).filter(CancellationLetter.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Kündigungsdokument nicht gefunden")

    _validate_filename(doc.filename)
    content = storage.download_file(doc.filename)
    if content is None:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    download_name = f"Kuendigungsbestaetigung_{doc.nachname}_{doc.vorname}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": _safe_content_disposition("inline", download_name)},
    )


@router.delete("/cancellation-documents/{document_id}")
def delete_cancellation_document(
    document_id: int,
    request: Request,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete a cancellation letter document."""
    doc = db.query(CancellationLetter).filter(CancellationLetter.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Kündigungsdokument nicht gefunden")

    filename = doc.filename
    signature_source = doc.signature_source
    db.delete(doc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    storage.delete_file(filename)
    posthog_capture(
        "admin_cancellation_document_deleted",
        get_admin_distinct_id(request),
        properties={
            "app_area": "admin",
            "source": "backend",
            "document_id": document_id,
            "signature_source": signature_source,
        },
    )
    return {"ok": True}


# --- Email Log ---

class EmailLogResponse(BaseModel):
    id: int
    timestamp: datetime
    email_type: str
    recipient: str
    subject: str | None
    status: str
    error_message: str | None
    antragsnummer: str | None
    vorname: str | None
    nachname: str | None

    class Config:
        from_attributes = True


@router.get("/email-logs", response_model=list[EmailLogResponse])
def get_email_logs(
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
    status: str | None = None,
    email_type: str | None = None,
    limit: int = 500,
):
    """Return up to `limit` email log entries, newest first."""
    q = db.query(EmailLog).order_by(EmailLog.timestamp.desc())
    if status:
        q = q.filter(EmailLog.status == status)
    if email_type:
        q = q.filter(EmailLog.email_type == email_type)
    return q.limit(limit).all()
