import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

_env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=True)


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
