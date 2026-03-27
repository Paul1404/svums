"""
IBAN encryption at rest using Fernet (AES-128-CBC).
The encryption key is derived from the app's cookie_secret.
"""

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

logger = logging.getLogger(__name__)


def _get_fernet() -> Fernet:
    """Derive a Fernet key from the cookie_secret."""
    settings = get_settings()
    # Derive a 32-byte key from the secret
    key = hashlib.sha256(settings.cookie_secret.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key)
    return Fernet(fernet_key)


def encrypt_iban(iban: str) -> str:
    """Encrypt an IBAN. Returns base64-encoded ciphertext prefixed with 'enc:'."""
    if not iban or iban.startswith("enc:"):
        return iban
    f = _get_fernet()
    encrypted = f.encrypt(iban.encode())
    return f"enc:{encrypted.decode()}"


class IBANDecryptionError(Exception):
    """Raised when IBAN decryption fails (wrong key, corrupted data, etc.)."""


def decrypt_iban(value: str) -> str:
    """Decrypt an IBAN. If not encrypted (no 'enc:' prefix), returns as-is.

    Raises IBANDecryptionError if decryption fails.
    """
    if not value or not value.startswith("enc:"):
        return value
    f = _get_fernet()
    try:
        decrypted = f.decrypt(value[4:].encode())
        return decrypted.decode()
    except InvalidToken:
        logger.error("Failed to decrypt IBAN — data may be corrupted or key changed")
        raise IBANDecryptionError("IBAN decryption failed — wrong key or corrupted data")


def decrypt_iban_safe(value: str) -> str:
    """Decrypt an IBAN, returning a visible error string on failure instead of raising."""
    try:
        return decrypt_iban(value)
    except IBANDecryptionError:
        return "[ENTSCHLÜSSELUNG FEHLGESCHLAGEN]"
