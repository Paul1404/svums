import logging
import time

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

_is_sqlite = settings.database_url.startswith("sqlite")

if _is_sqlite:
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

else:
    # PostgreSQL (e.g. Neon) — pool_pre_ping handles dropped serverless connections
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args={"connect_timeout": 10},
    )


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def wait_for_db(max_retries: int = 5, initial_delay: float = 2.0) -> None:
    """Wait for the database to become available, retrying with exponential backoff.

    Serverless databases (e.g. Neon) may need a few seconds to cold-start.
    """
    if _is_sqlite:
        return

    delay = initial_delay
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database connection established (attempt %d)", attempt)
            return
        except Exception as exc:
            if attempt == max_retries:
                logger.error("Database unavailable after %d attempts, giving up", max_retries)
                raise
            logger.warning(
                "Database not ready (attempt %d/%d): %s — retrying in %.1fs",
                attempt, max_retries, exc, delay,
            )
            time.sleep(delay)
            delay *= 2


def get_db():
    """Yield a DB session, retrying on transient connection errors (Neon cold-start)."""
    from sqlalchemy.exc import OperationalError

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            db = SessionLocal()
            # Force a connection checkout to surface errors before yielding
            db.connection()
            break
        except OperationalError as exc:
            last_exc = exc
            if attempt < 2:
                logger.warning(
                    "DB connection failed (attempt %d/3), retrying: %s",
                    attempt + 1, exc,
                )
                time.sleep(1.0 * (attempt + 1))
                continue
            logger.error("DB connection failed after 3 attempts")
            raise
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
