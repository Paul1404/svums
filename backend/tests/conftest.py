import os
from datetime import date

os.environ.setdefault("ALLOW_INSECURE_DEFAULTS", "true")
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/svums_test.db")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")
os.environ.setdefault("COOKIE_SECRET", "test-cookie-secret-which-is-long-enough")

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

get_settings.cache_clear()

from app.database import Base, SessionLocal, engine
from app.main import app
from app.routers.admin import get_serializer


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def admin_cookie():
    settings = get_settings()
    token = get_serializer(settings).dumps({"admin": True})
    return {settings.cookie_name: token}


@pytest.fixture
def application_factory(db_session):
    from app.models.application import MembershipApplication

    def _create(**overrides):
        data = {
            "antragsnummer": "ANT-2026-00001",
            "antragstyp": "einzel",
            "geschlecht": "Herr",
            "vorname": "Test",
            "nachname": "User",
            "geburtsdatum": date(1990, 1, 1),
            "strasse": "Musterstrasse 1",
            "plz": "12345",
            "ort": "Untereuerheim",
            "telefon": None,
            "email": "test@example.com",
            "abteilungen": '["Fußball"]',
            "mitgliedschaft_typ": "erwachsener",
            "elternteil_mitglied": None,
            "jahresbeitrag": 54,
            "kontoinhaber": "Test User",
            "iban": "DE02120300000000202051",
            "bic": "BYLADEM1001",
            "kreditinstitut": "Testbank",
            "status": "neu",
        }
        data.update(overrides)
        app_row = MembershipApplication(**data)
        db_session.add(app_row)
        db_session.commit()
        db_session.refresh(app_row)
        return app_row

    return _create
