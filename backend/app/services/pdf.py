import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML
from pypdf import PdfWriter, PdfReader
from io import BytesIO

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

_env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=True)


def generate_approval_page(
    admin_unterschrift_base64: str,
    approval_datum: str,
    antragsnummer: str,
) -> bytes:
    """Generate a single-page PDF with the admin approval block."""
    template = _env.get_template("genehmigung_seite.html")
    html_content = template.render(
        admin_unterschrift_base64=admin_unterschrift_base64,
        approval_datum=approval_datum,
        antragsnummer=antragsnummer,
    )
    return HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()


def merge_pdf_with_approval(base_pdf_bytes: bytes, approval_page_bytes: bytes) -> bytes:
    """Append the approval page to the base PDF."""
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(base_pdf_bytes)))
    writer.append(PdfReader(BytesIO(approval_page_bytes)))
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def generate_pdf(application_data: dict) -> bytes:
    """Generate a PDF Beitrittserklärung from application data."""
    template = _env.get_template("beitrittserklaerung.html")
    html_content = template.render(**application_data)
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
    return pdf_bytes


def generate_cancellation_pdf(data: dict) -> bytes:
    """Generate a PDF Kündigungsbestätigung."""
    template = _env.get_template("kuendigungsbestaetigung.html")
    html_content = template.render(**data)
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
    return pdf_bytes
