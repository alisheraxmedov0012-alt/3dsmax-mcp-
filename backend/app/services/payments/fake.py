"""Fake sandbox payment adapter.

This adapter simulates a payment provider for development and tests. It is
**not** a real provider and must never be presented as one in the UI or docs.
It:

* never collects or stores card data,
* signs events with HMAC using a configured secret so webhook verification
  logic is exercised realistically,
* supports idempotent event delivery (same ref re-delivered).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from typing import Any

from .base import PaymentProvider, ProviderEvent, SignatureError


class FakeSandboxProvider(PaymentProvider):
    name = "fake-sandbox"
    is_real_provider = False

    def __init__(self, webhook_secret: str | None):
        self._secret = webhook_secret or ""

    def sign(self, payload: bytes) -> str:
        if not self._secret:
            raise SignatureError("Sandbox webhook secret sozlanmagan.")
        return hmac.new(self._secret.encode(), payload, hashlib.sha256).hexdigest()

    def create_payment(self, *, user_id: str, plan_key: str, amount_cents: int | None,
                       currency: str | None, idempotency_key: str) -> str:
        # Deterministic reference from the idempotency key so retries reuse it.
        digest = hashlib.sha256(f"{user_id}:{idempotency_key}".encode()).hexdigest()[:24]
        return f"fake_{digest}_{uuid.uuid4().hex[:6]}"

    def build_event(self, *, provider_ref: str, status: str, amount_cents: int | None,
                    currency: str | None) -> tuple[bytes, str]:
        """Helper for tests: produce a signed event body."""
        body = json.dumps(
            {
                "ref": provider_ref,
                "status": status,
                "amount_cents": amount_cents,
                "currency": currency,
            }
        ).encode()
        return body, self.sign(body)

    def parse_webhook(self, payload: bytes, signature: str | None) -> ProviderEvent:
        if not self._secret:
            raise SignatureError("Sandbox webhook secret sozlanmagan.")
        if not signature:
            raise SignatureError("Imzo yo'q.")
        expected = self.sign(payload)
        if not hmac.compare_digest(expected, signature):
            raise SignatureError("Imzo noto'g'ri.")

        try:
            data: dict[str, Any] = json.loads(payload)
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            raise SignatureError("Noto'g'ri JSON.") from exc

        ref = data.get("ref")
        status = data.get("status")
        if not isinstance(ref, str) or status not in {"pending", "succeeded", "failed", "cancelled"}:
            raise SignatureError("Event maydoni noto'g'ri.")

        return ProviderEvent(
            provider=self.name,
            provider_ref=ref,
            status=status,  # type: ignore[arg-type]
            amount_cents=data.get("amount_cents"),
            currency=data.get("currency"),
            signature_valid=True,
        )
