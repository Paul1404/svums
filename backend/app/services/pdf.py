import logging
import os
import time
from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from pypdf import PdfReader, PdfWriter
from weasyprint import HTML

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

_env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=True)


def generate_approval_page(
    admin_unterschrift_base64: str,
    approval_datum: str,
    antragsnummer: str,
    applicant_name: str,
    mandatsreferenz: str,
    mitgliedsnummer: str = "",
    club_config: dict | None = None,
    notification_email: str = "",
    empfaenger_anrede_text: str = "",
    empfaenger_anrede_greeting: str = "",
    empfaenger_name: str = "",
    empfaenger_strasse: str = "",
    empfaenger_plz: str = "",
    empfaenger_ort: str = "",
    document_id: str = "",
) -> bytes:
    """Generate a single-page DIN 5008 letter confirming membership with the admin approval block."""
    if club_config is None:
        from app.schemas.club_config import ClubConfig
        club_config = ClubConfig().to_template_dict()
    start = time.perf_counter()
    template = _env.get_template("genehmigung_seite.html")
    html_content = template.render(
        admin_unterschrift_base64=admin_unterschrift_base64,
        approval_datum=approval_datum,
        antragsnummer=antragsnummer,
        applicant_name=applicant_name,
        mandatsreferenz=mandatsreferenz or "",
        mitgliedsnummer=mitgliedsnummer or "",
        club=club_config,
        notification_email=notification_email,
        empfaenger_anrede_text=empfaenger_anrede_text,
        empfaenger_anrede_greeting=empfaenger_anrede_greeting,
        empfaenger_name=empfaenger_name or applicant_name,
        empfaenger_strasse=empfaenger_strasse,
        empfaenger_plz=empfaenger_plz,
        empfaenger_ort=empfaenger_ort,
        document_id=document_id,
    )
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
    logger.info(
        "Generated approval page for %s (%d bytes, %.0fms)",
        antragsnummer, len(pdf_bytes), (time.perf_counter() - start) * 1000,
    )
    return pdf_bytes


def merge_pdf_with_approval(base_pdf_bytes: bytes, approval_page_bytes: bytes) -> bytes:
    """Append the approval page to the base PDF."""
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(base_pdf_bytes)))
    writer.append(PdfReader(BytesIO(approval_page_bytes)))
    out = BytesIO()
    writer.write(out)
    merged = out.getvalue()
    logger.debug("Merged PDF with approval page (%d bytes)", len(merged))
    return merged


def generate_pdf(application_data: dict) -> bytes:
    """Generate a PDF Beitrittserklärung from application data."""
    start = time.perf_counter()
    antragsnummer = application_data.get("antragsnummer", "unknown")
    template = _env.get_template("beitrittserklaerung.html")
    html_content = template.render(**application_data)
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
    logger.info(
        "Generated application PDF for %s (%d bytes, %.0fms)",
        antragsnummer, len(pdf_bytes), (time.perf_counter() - start) * 1000,
    )
    return pdf_bytes


def generate_cancellation_pdf(data: dict) -> bytes:
    """Generate a PDF Austrittsbestätigung."""
    start = time.perf_counter()
    template = _env.get_template("kuendigungsbestaetigung.html")
    html_content = template.render(**data)
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
    logger.info(
        "Generated cancellation PDF (%d bytes, %.0fms)",
        len(pdf_bytes), (time.perf_counter() - start) * 1000,
    )
    return pdf_bytes
