from sqlalchemy import Column, Integer, String, Boolean
from app.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)

    # SMTP configuration
    smtp_host = Column(String(200), nullable=True, default="")
    smtp_port = Column(Integer, nullable=True, default=587)
    smtp_user = Column(String(200), nullable=True, default="")
    smtp_password = Column(String(200), nullable=True, default="")
    smtp_from = Column(String(200), nullable=True, default="")
    smtp_use_tls = Column(Boolean, nullable=False, default=True)

    # Notification
    notification_email = Column(
        String(200),
        nullable=False,
        default="mitgliedschaft@sv-untereuerheim.de",
    )
