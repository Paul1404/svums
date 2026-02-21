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

    # Cookie settings
    cookie_secure: bool = True
    cookie_name: str = "svums_admin_session"
    session_max_age: int = 86400  # 24 hours

    model_config = {"env_prefix": "", "case_sensitive": False}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
