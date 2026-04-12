from sqlalchemy import Boolean, Column, Integer, String, Text
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
        default="",
    )
    # Reusable admin signature as PNG/JPEG data URL.
    admin_signature_base64 = Column(Text, nullable=True, default=None)

    # Club configuration — JSON blob validated by ClubConfig schema.
    # NULL means "use all defaults".
    club_config = Column(Text, nullable=True, default=None)

    def get_club_config(self):
        """Parse club_config JSON into a ClubConfig instance (defaults if empty)."""
        from app.schemas.club_config import ClubConfig
        return ClubConfig.from_json(self.club_config)
