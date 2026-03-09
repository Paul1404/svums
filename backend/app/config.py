from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Admin authentication
    admin_password: str = "change-me-in-production"
    cookie_secret: str = "change-me-in-production"

    # Database
    database_url: str = "sqlite:///./data/svums.db"

    # CORS
    cors_origins: str = "https://svums.sv-untereuerheim.de"
    public_base_url: str = "https://svums.sv-untereuerheim.de"

    # Cookie settings
    cookie_secure: bool = True
    cookie_name: str = "svums_admin_session"
    session_max_age: int = 86400  # 24 hours
    forwarded_allow_ips: str = "127.0.0.1,::1"
    allow_insecure_defaults: bool = False

    model_config = {"env_prefix": "", "case_sensitive": False}


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    insecure_defaults = {
        "change-me-in-production",
        "admin",
        "password",
        "secret",
    }
    if (
        not settings.allow_insecure_defaults
        and (
            settings.admin_password in insecure_defaults
            or settings.cookie_secret in insecure_defaults
            or len(settings.cookie_secret) < 24
        )
    ):
        raise ValueError(
            "Unsichere Standardwerte für ADMIN_PASSWORD/COOKIE_SECRET erkannt. "
            "Bitte sichere Umgebungsvariablen setzen oder ALLOW_INSECURE_DEFAULTS=true "
            "nur für lokale Entwicklung verwenden."
        )
    if (
        not settings.allow_insecure_defaults
        and settings.database_url.startswith("sqlite")
    ):
        raise ValueError(
            "Unsichere Datenbankkonfiguration erkannt. "
            "Setze DATABASE_URL auf eine persistente Produktionsdatenbank "
            "oder ALLOW_INSECURE_DEFAULTS=true nur lokal."
        )
    return settings
