"""Optional error-tracking adapter.

Error tracking is enabled only when ``APP_ERROR_TRACKING_DSN`` is configured.
The DSN comes from the environment and is never hard-coded. When the SDK is not
installed or no DSN is set, ``init_error_tracking`` reports that tracking is off
(it never pretends to be active).
"""
from __future__ import annotations

import logging

from .config import get_settings

logger = logging.getLogger("app.error_tracking")

_ACTIVE = {"value": False}


def init_error_tracking() -> bool:
    """Initialise error tracking if configured. Returns True only if active."""
    settings = get_settings()
    if not settings.error_tracking_dsn:
        logger.info("Error tracking o'chirilgan (DSN sozlanmagan).")
        _ACTIVE["value"] = False
        return False

    try:
        import sentry_sdk
    except ImportError:  # pragma: no cover - optional dependency
        logger.warning(
            "APP_ERROR_TRACKING_DSN berilgan, lekin 'sentry-sdk' o'rnatilmagan. "
            "Xato kuzatuvi FAOL EMAS."
        )
        _ACTIVE["value"] = False
        return False

    sentry_sdk.init(
        dsn=settings.error_tracking_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.error_tracking_sample_rate,
        # Never send request bodies (may contain credentials).
        send_default_pii=False,
        max_request_body_size="never",
    )
    _ACTIVE["value"] = True
    logger.info("Error tracking yoqildi (sentry-compatible).")
    return True


def is_active() -> bool:
    return bool(_ACTIVE["value"])
