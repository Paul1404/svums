import logging
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import aiosmtplib
from jinja2 import Environment, FileSystemLoader

from app.services.urls import build_public_url, public_host_display

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=True)


async def send_application_email(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    smtp_use_tls: bool,
    notification_email: str,
    applicant_email: str,
    application_data: dict,
    pdf_bytes: bytes,
) -> bool:
    """Send application notification email with PDF attachment."""
    try:
        # Render HTML email
        template = _env.get_template("email.html")
        html_body = template.render(**application_data)

        # Build MIME message for club notification
        msg = MIMEMultipart()
        msg["From"] = smtp_from
        msg["To"] = notification_email
        msg["Subject"] = (
            f"Neue Beitrittserklärung: {application_data['nachname']}, {application_data['vorname']}"
        )

        msg.attach(MIMEText(html_body, "html", "utf-8"))

        # Attach PDF
        pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_filename = f"Beitrittserklaerung_{application_data['nachname']}_{application_data['vorname']}.pdf"
        pdf_attachment.add_header(
            "Content-Disposition", "attachment", filename=pdf_filename
        )
        msg.attach(pdf_attachment)

        # Send to club
        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user if smtp_user else None,
            password=smtp_password if smtp_password else None,
            start_tls=smtp_use_tls,
        )

        # Send confirmation to applicant
        confirmation_template = _env.get_template("email_confirmation.html")
        confirmation_html = confirmation_template.render(**application_data)

        confirm_msg = MIMEMultipart()
        confirm_msg["From"] = smtp_from
        confirm_msg["To"] = applicant_email
        club = application_data.get("club", {})
        subject_prefix = club.get("email_subject_prefix", "Verein")
        confirm_msg["Subject"] = f"Ihre Beitrittserklärung – {subject_prefix}"
        confirm_msg.attach(MIMEText(confirmation_html, "html", "utf-8"))

        # Attach PDF copy to applicant
        pdf_copy = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_copy.add_header(
            "Content-Disposition", "attachment", filename=pdf_filename
        )
        confirm_msg.attach(pdf_copy)

        await aiosmtplib.send(
            confirm_msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user if smtp_user else None,
            password=smtp_password if smtp_password else None,
            start_tls=smtp_use_tls,
        )

        logger.info(
            f"Application email sent for {application_data['nachname']}, {application_data['vorname']}"
        )
        return True

    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


async def send_test_email(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    smtp_use_tls: bool,
    recipient: str,
) -> bool:
    """Send a test email to verify SMTP settings."""
    try:
        msg = MIMEMultipart()
        msg["From"] = smtp_from
        msg["To"] = recipient
        msg["Subject"] = "SVUMS Test-E-Mail"
        msg.attach(
            MIMEText(
                "<h2>SVUMS - SMTP Test</h2><p>Die E-Mail-Konfiguration funktioniert korrekt.</p>",
                "html",
                "utf-8",
            )
        )

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user if smtp_user else None,
            password=smtp_password if smtp_password else None,
            start_tls=smtp_use_tls,
        )
        return True
    except Exception as e:
        logger.error(f"SMTP test failed: {e}")
        raise


async def send_upload_notification(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    smtp_use_tls: bool,
    notification_email: str,
    antragsnummer: str,
    vorname: str,
    nachname: str,
    filename: str,
) -> bool:
    """Notify admin that a signed document was uploaded."""
    try:
        msg = MIMEMultipart()
        msg["From"] = smtp_from
        msg["To"] = notification_email
        msg["Subject"] = f"Dokument hochgeladen: {nachname}, {vorname} ({antragsnummer})"
        html = (
            f"<h2>Unterschriebenes Dokument eingegangen</h2>"
            f"<p><strong>{nachname}, {vorname}</strong> hat das unterschriebene "
            f"Dokument für Antrag <code>{antragsnummer}</code> hochgeladen.</p>"
            f"<p>Datei: <code>{filename}</code></p>"
            f"<p><a href='{build_public_url('/admin')}'>Zum Admin-Panel &rarr;</a></p>"
        )
        msg.attach(MIMEText(html, "html", "utf-8"))

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user if smtp_user else None,
            password=smtp_password if smtp_password else None,
            start_tls=smtp_use_tls,
        )
        logger.info(f"Upload notification sent for {antragsnummer}")
        return True
    except Exception as e:
        logger.error(f"Failed to send upload notification: {e}")
        return False


async def send_status_email(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    smtp_use_tls: bool,
    applicant_email: str,
    vorname: str,
    nachname: str,
    antragsnummer: str,
    status: str,
    anrede: str = "",
    decline_reason: str | None = None,
    pdf_bytes: bytes | None = None,
    pdf_filename: str | None = None,
    mitgliedsnummer: str | None = None,
    club_config: dict | None = None,
    notification_email: str = "",
) -> bool:
    """Send status update email to applicant (upload confirmed, approved, declined)."""
    try:
        if club_config is None:
            from app.schemas.club_config import ClubConfig
            club_config = ClubConfig().to_template_dict()
        template = _env.get_template("email_status.html")
        html_body = template.render(
            vorname=vorname,
            nachname=nachname,
            anrede=anrede or f"Hallo {vorname}",
            antragsnummer=antragsnummer,
            status=status,
            status_url=build_public_url(f"/status?nr={antragsnummer}"),
            decline_reason=decline_reason or "",
            logo_url=build_public_url("/logo_svu-241x300.png"),
            site_host_display=public_host_display(),
            mitgliedsnummer=mitgliedsnummer or "",
            club=club_config,
            notification_email=notification_email,
        )

        subject_map = {
            "dokument_hochgeladen": f"Dokument erhalten – {antragsnummer}",
            "genehmigt": f"Mitgliedschaft genehmigt – {antragsnummer}",
            "abgelehnt": f"Antrag abgelehnt – {antragsnummer}",
        }
        subject = subject_map.get(status, f"Statusupdate – {antragsnummer}")

        msg = MIMEMultipart()
        msg["From"] = smtp_from
        msg["To"] = applicant_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        if pdf_bytes and pdf_filename:
            pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
            pdf_attachment.add_header(
                "Content-Disposition", "attachment", filename=pdf_filename
            )
            msg.attach(pdf_attachment)

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user if smtp_user else None,
            password=smtp_password if smtp_password else None,
            start_tls=smtp_use_tls,
        )
        logger.info(f"Status email ({status}) sent to {applicant_email} for {antragsnummer}")
        return True
    except Exception as e:
        logger.error(f"Failed to send status email: {e}")
        return False
