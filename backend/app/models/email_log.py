from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.database import Base


class EmailLog(Base):
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)

    # One of: application_club | application_applicant | upload_notification
    #         | status_update | test
    email_type = Column(String(50), nullable=False)

    recipient = Column(String(200), nullable=False)
    subject = Column(String(500), nullable=True)
    status = Column(String(10), nullable=False)   # "success" | "failed"
    error_message = Column(Text, nullable=True)

    # Optional context
    antragsnummer = Column(String(20), nullable=True)
    vorname = Column(String(100), nullable=True)
    nachname = Column(String(100), nullable=True)
