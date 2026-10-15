"""W11 production-readiness diagnostics.

Answers, without ever printing a secret value, "is this deployment actually
configured for production?" across the areas a release depends on: auth,
database + migrations, storage, worker/queue, payments, secrets, CORS/CSRF and
monitoring/logging.

Two guardrails:

* **No secret values.** Checks report booleans and configuration *keys*, never a
  DSN, key, token or password.
* **No auto-enablement.** A check never turns a service on; it only reports the
  current state, so an unconfigured dependency is surfaced rather than silently
  activated.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..error_tracking import is_active as error_tracking_active
from ..services.heartbeat import worker_status
from ..services.payments.registry import ProviderNotConfigured, get_payment_provider
from ..services.storage import storage_status

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _check(key: str, ok: bool, required: bool, detail: str) -> dict:
    return {"key": key, "ok": bool(ok), "required": bool(required), "detail": detail}


def _migration_state(db: OrmSession) -> tuple[bool, str]:
    """Compare the applied Alembic revision with the script head (booleans only)."""
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
    except Exception:  # pragma: no cover - alembic always installed in this repo
        return True, "Alembic mavjud emas; migratsiya holati tekshirilmadi."

    ini = _BACKEND_ROOT / "alembic.ini"
    if not ini.is_file():
        return True, "alembic.ini topilmadi; migratsiya holati tekshirilmadi."

    try:
        script = ScriptDirectory.from_config(Config(str(ini)))
        head = script.get_current_head()
    except Exception:  # pragma: no cover - defensive
        return True, "Alembic head aniqlanmadi."

    try:
        applied = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
    except Exception:
        applied = None

    if applied is None:
        return False, "alembic_version jadvali yo'q (migratsiyalar qo'llanilmagan)."
    if applied != head:
        return False, "Bazadagi migratsiya head bilan mos emas."
    return True, "Migratsiyalar head bilan mos."


def _payments_check() -> tuple[bool, bool, str]:
    """Return (configured, is_real, detail). Sandbox is configured but not real."""
    try:
        provider = get_payment_provider()
    except ProviderNotConfigured:
        return False, False, "To'lov provayderi sozlanmagan."
    is_real = bool(getattr(provider, "is_real_provider", False))
    name = getattr(provider, "name", "unknown")
    if is_real:
        return True, True, f"Haqiqiy provayder sozlangan ({name})."
    return True, False, f"Faqat sandbox adapter ({name}) — haqiqiy to'lov emas."


def production_diagnostics(db: OrmSession) -> dict:
    settings = get_settings()
    problems = settings.production_problems()

    # --- auth / session -----------------------------------------------------
    auth_ok = (
        bool(settings.secret_key)
        and settings.secret_key != "dev-insecure-change-me"
        and len(settings.secret_key) >= 32
        and settings.cookie_secure
        and not settings.expose_dev_tokens
        and not settings.debug
    ) if settings.is_production else True
    auth_detail = (
        "Autentifikatsiya sozlamalari production uchun mos."
        if auth_ok
        else "Autentifikatsiya sozlamalari production uchun xavfsiz emas."
    )

    # --- database + migrations ---------------------------------------------
    db_ok = not settings.database_url.startswith("sqlite")
    migrations_ok, migrations_detail = _migration_state(db)
    database_ok = db_ok and migrations_ok
    database_detail = (
        "PostgreSQL + migratsiyalar tayyor."
        if database_ok
        else ("SQLite ishlatilmoqda." if not db_ok else migrations_detail)
    )

    # --- storage ------------------------------------------------------------
    storage_info = storage_status()
    storage_persistent = bool(storage_info.get("persistent"))
    storage_ok = bool(storage_info.get("available")) and (
        storage_persistent or not settings.is_production
    )
    storage_detail = (
        "Doimiy saqlash faol." if storage_persistent else str(storage_info.get("message", ""))
    )

    # --- worker / queue -----------------------------------------------------
    worker = worker_status(db)
    worker_ok = bool(worker.get("running"))
    worker_detail = str(worker.get("note", ""))

    # --- payments -----------------------------------------------------------
    payments_configured, payments_real, payments_detail = _payments_check()

    # --- secrets ------------------------------------------------------------
    secrets_ok = bool(settings.secret_key) and settings.secret_key != "dev-insecure-change-me"
    if settings.payment_provider.lower() in {"fake", "fake-sandbox", "sandbox"}:
        secrets_ok = secrets_ok and bool(settings.payment_webhook_secret)
    secrets_detail = (
        "Sirli sozlamalar o'rnatilgan (qiymatlar ko'rsatilmaydi)."
        if secrets_ok
        else "Sirli sozlamalar to'liq emas (qiymatlar ko'rsatilmaydi)."
    )

    # --- CORS / CSRF --------------------------------------------------------
    origins = settings.cors_origin_list
    cors_ok = bool(origins) and "*" not in origins
    csrf_ok = bool(settings.csrf_header_name)
    cors_detail = (
        "CORS aniq originlar bilan cheklangan; CSRF sarlavhasi sozlangan."
        if (cors_ok and csrf_ok)
        else "CORS yoki CSRF sozlamasi production uchun mos emas."
    )

    # --- monitoring / logs --------------------------------------------------
    logs_ok = settings.log_format in {"json", "text"}
    monitoring_detail = (
        f"Strukturali loglar ({settings.log_format}); "
        + ("xato kuzatuvi faol." if error_tracking_active() else "tashqi monitoring provayderi ulanmagan.")
    )

    checks = [
        _check("auth", auth_ok, True, auth_detail),
        _check("database", database_ok, True, database_detail),
        _check("storage", storage_ok, True, storage_detail),
        _check("worker", worker_ok, True, worker_detail),
        _check("payments", payments_configured, False, payments_detail),
        _check("secrets", secrets_ok, True, secrets_detail),
        _check("cors_csrf", cors_ok and csrf_ok, True, cors_detail),
        _check("monitoring_logs", logs_ok, False, monitoring_detail),
    ]

    blocking = [c["key"] for c in checks if c["required"] and not c["ok"]]
    return {
        "environment": settings.environment,
        "production": settings.is_production,
        "ready": not blocking and not problems,
        "checks": checks,
        "blocking": blocking,
        # Pre-existing startup blockers, re-reported (never secret values).
        "config_problems": problems,
        "payments_real": payments_real,
    }


__all__ = ["production_diagnostics"]
