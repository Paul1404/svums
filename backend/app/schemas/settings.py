from typing import Optional
from pydantic import BaseModel, EmailStr


class SettingsResponse(BaseModel):
    smtp_host: Optional[str] = ""
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = ""
    smtp_password: Optional[str] = ""
    smtp_from: Optional[str] = ""
    smtp_use_tls: bool = True
    notification_email: str = "mitgliedschaft@sv-untereuerheim.de"

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_use_tls: Optional[bool] = None
    notification_email: Optional[str] = None


class AdminLoginRequest(BaseModel):
    password: str


class TestSmtpRequest(BaseModel):
    recipient: EmailStr
