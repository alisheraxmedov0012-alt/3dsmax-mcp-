"""Payment provider registry / selection.

Selection is driven by ``APP_PAYMENT_PROVIDER``. Only the fake sandbox adapter
is wired in this stage; no real provider is configured. If a real provider name
is requested but not configured, ``ProviderNotConfigured`` is raised so the API
reports the integration as unconfigured rather than faking success.
"""
from __future__ import annotations

from ...config import get_settings
from .base import PaymentProvider, ProviderNotConfigured
from .fake import FakeSandboxProvider


def get_payment_provider() -> PaymentProvider:
    settings = get_settings()
    name = (settings.payment_provider or "none").lower()

    if name in {"fake", "fake-sandbox", "sandbox"}:
        return FakeSandboxProvider(settings.payment_webhook_secret)

    if name in {"none", ""}:
        raise ProviderNotConfigured(
            "To'lov provayderi sozlanmagan. Sandbox adapterdan foydalanish uchun "
            "APP_PAYMENT_PROVIDER=fake ni o'rnating."
        )

    # Real providers (e.g. stripe) are intentionally not implemented: they need
    # a selected provider, an official account and production keys.
    raise ProviderNotConfigured(
        f"'{name}' provayderi hali sozlanmagan. Bu bosqichda faqat sandbox adapter mavjud."
    )


def provider_is_configured() -> bool:
    try:
        get_payment_provider()
        return True
    except ProviderNotConfigured:
        return False


__all__ = ["get_payment_provider", "provider_is_configured", "ProviderNotConfigured"]
