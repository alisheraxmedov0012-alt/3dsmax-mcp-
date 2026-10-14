"""Payment provider abstraction.

A provider adapter isolates all provider-specific behaviour from the billing
domain. Only a clearly-labelled **fake sandbox** adapter ships in this stage.
No real provider is selected, so no real credentials are required and none are
used. See README for what remains before real payments can be enabled.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

PaymentStatus = Literal["pending", "succeeded", "failed", "cancelled"]


@dataclass(frozen=True)
class ProviderEvent:
    """A verified provider event (webhook or sandbox confirmation)."""

    provider: str
    provider_ref: str
    status: PaymentStatus
    amount_cents: int | None
    currency: str | None
    signature_valid: bool


class PaymentProvider(Protocol):
    name: str
    #: True only for adapters that talk to a real (or real sandbox) provider.
    is_real_provider: bool

    def create_payment(self, *, user_id: str, plan_key: str, amount_cents: int | None,
                       currency: str | None, idempotency_key: str) -> str:
        """Create a payment intent and return its provider reference."""

    def parse_webhook(self, payload: bytes, signature: str | None) -> ProviderEvent:
        """Verify and parse a webhook into a ProviderEvent.

        Must raise ``SignatureError`` when the signature cannot be verified.
        """


class SignatureError(Exception):
    pass


class ProviderNotConfigured(Exception):
    pass
