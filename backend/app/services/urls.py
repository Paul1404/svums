from urllib.parse import urljoin, urlparse

from app.config import get_settings


def build_public_url(path: str) -> str:
    base_url = get_settings().public_base_url.rstrip("/") + "/"
    return urljoin(base_url, path.lstrip("/"))


def public_host_display() -> str:
    parsed = urlparse(get_settings().public_base_url)
    return parsed.netloc or parsed.path.rstrip("/")
