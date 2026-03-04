import csv
import io
import json
import logging
import uuid
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from app.config import get_settings, Settings
from app.database import get_db
from app.models.application import MembershipApplication
from app.models.cancellation_letter import CancellationLetter
from app.models.settings import AppSettings
from app.models.email_log import EmailLog
from app.schemas.application import (
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
from app.services.crypto import decrypt_iban
from app.services.email import send_status_email
from app.services import storage
from app.routers.public import _build_application_data, _compute_anrede, _format_iban, _send_email_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _validate_filename(filename: str) -> None:
    """Validate filename to prevent path traversal and invalid keys."""
    if not filename or filename.strip() == "":
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")
    if ".." in filename or "/" in filename or "\\" in filename:
        logger.warning(f"Blocked invalid upload path reference: {filename}")
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")


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


# --- Auth ---

@router.post("/login")
async def admin_login(data: AdminLoginRequest, response: Response):
    settings = get_settings()
    if data.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Falsches Passwort")

    serializer = get_serializer(settings)
    token = serializer.dumps({"admin": True})

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
async def admin_logout(response: Response):
    settings = get_settings()
    response.delete_cookie(key=settings.cookie_name, path="/")
    return {"message": "Abgemeldet"}


@router.get("/me")
async def admin_check(is_admin: bool = Depends(require_admin)):
    return {"authenticated": True}


# --- Applications ---

@router.get("/applications", response_model=ApplicationListResponse)
async def list_applications(
    page: int = 1,
    per_page: int = 25,
    status: str | None = None,
    search: str | None = None,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(MembershipApplication)

    if status:
        query = query.filter(MembershipApplication.status == status)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                MembershipApplication.vorname.ilike(search_term),
                MembershipApplication.nachname.ilike(search_term),
                MembershipApplication.email.ilike(search_term),
                MembershipApplication.ort.ilike(search_term),
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
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    old_status = app.status
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
        approval_datum = datetime.now().strftime("%d.%m.%Y")
        antragsnummer = app.antragsnummer or f"ANT-{app.id}"
        approval_page_bytes = generate_approval_page(
            admin_unterschrift_base64=effective_sig,
            approval_datum=approval_datum,
            antragsnummer=antragsnummer,
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

    # Send status email to applicant on approve/decline
    new_status = app.status
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
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    app = db.query(MembershipApplication).filter(
        MembershipApplication.id == application_id
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antrag nicht gefunden")

    db.delete(app)
    db.commit()
    return {"message": "Antrag gelöscht"}


@router.post("/applications/{application_id}/resend-email")
async def resend_email(
    application_id: int,
    background_tasks: BackgroundTasks,
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
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


@router.delete("/applications/{application_id}/upload")
async def delete_upload(
    application_id: int,
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
    app.uploaded_file = None
    app.uploaded_at = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    storage.delete_file(filename)
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
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


@router.delete("/applications/{application_id}/approved")
async def delete_approved(
    application_id: int,
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
    return {"ok": True}


@router.post("/applications/{application_id}/admin-upload")
async def admin_upload_document(
    application_id: int,
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

    return ApplicationResponse.model_validate(app)


@router.get("/export")
async def export_csv(
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    applications = (
        db.query(MembershipApplication)
        .order_by(MembershipApplication.created_at.desc())
        .all()
    )

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
            app.kontoinhaber or "", decrypt_iban(app.iban), app.bic or "", app.kreditinstitut or "",
            app.status, app.notes or "",
            "Ja" if app.email_sent else "Nein",
            app.created_at.strftime("%d.%m.%Y %H:%M"),
        ])

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
    return SettingsResponse.model_validate(settings)


@router.put("/settings", response_model=SettingsResponse)
async def update_admin_settings(
    data: SettingsUpdate,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db)

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)

    db.commit()
    db.refresh(settings)
    return SettingsResponse.model_validate(settings)


@router.post("/settings/test-smtp")
async def test_smtp(
    data: TestSmtpRequest,
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
        return {"message": "Test-E-Mail wurde erfolgreich gesendet"}
    except Exception as e:
        _test_err = e
        _log_email(db, "test", data.recipient, "Test-E-Mail", False, _test_err)
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


@router.post("/cancellation-pdf")
async def cancellation_pdf(
    data: CancellationRequest,
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

    if data.anrede == "keine Angabe":
        anrede_full = f"Guten Tag {data.vorname} {data.nachname}"
        anrede_text = ""
    else:
        anrede_map = {
            "Herr": ("Sehr geehrter Herr", "Herrn"),
            "Frau": ("Sehr geehrte Frau", "Frau"),
        }
        greeting, anrede_text = anrede_map.get(data.anrede, ("Sehr geehrte/r", ""))
        anrede_full = f"{greeting} {data.nachname}"

    pdf_data = {
        "anrede": anrede_full,
        "anrede_text": anrede_text,
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

    filename = f"Kuendigungsbestaetigung_{data.nachname}_{data.vorname}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
        headers={"Content-Disposition": f'inline; filename="{download_name}"'},
    )


@router.delete("/cancellation-documents/{document_id}")
def delete_cancellation_document(
    document_id: int,
    is_admin: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete a cancellation letter document."""
    doc = db.query(CancellationLetter).filter(CancellationLetter.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Kündigungsdokument nicht gefunden")

    filename = doc.filename
    db.delete(doc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    storage.delete_file(filename)
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
