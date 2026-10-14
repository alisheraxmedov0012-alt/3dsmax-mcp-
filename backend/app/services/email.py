"""Email delivery adapter.

Two backends are wired:

* ``console`` — logs the message (no real delivery). Used in development/test.
  It never claims an email was delivered; the caller must treat this as
  "not delivered" for production purposes.
* ``smtp`` — real delivery, only when SMTP settings are provided.

If SMTP is not configured the app does NOT pretend email works. Verification and
reset flows still function locally because the token is returned to the caller
when ``APP_EXPOSE_DEV_TOKENS`` is enabled (development/test only).
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import get_settings

logger = logging.getLogger("app.email")


class EmailNotConfigured(RuntimeError):
    pass


def deliver(to: str, subject: str, body: str) -> bool:
    """Attempt to deliver an email. Returns True only on real delivery."""
    settings = get_settings()

    if settings.email_backend == "smtp" and settings.smtp_host:
        message = EmailMessage()
        message["From"] = settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
        logger.info("Delivered email to %s (subject=%s)", to, subject)
        return True

    # Console backend: log without secrets, and report "not delivered".
    logger.info("[email:console] to=%s subject=%s (not actually delivered)", to, subject)
    return False
