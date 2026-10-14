"""Billing: sandbox checkout, webhook verification, idempotency, invoices."""
from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.models import Invoice, PaymentAttempt, Subscription
from tests.conftest import auth_headers, register

WEBHOOK_SECRET = "test-webhook-secret"


def _activate_pro(client, email: str) -> dict:
    """Helper: register, checkout in sandbox, confirm success. Returns headers."""
    register(client, email)
    headers = auth_headers(client, email)

    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"})
    assert checkout.status_code == 200, checkout.text
    payment_id = checkout.json()["payment_id"]
    assert checkout.json()["mode"] == "sandbox"

    confirm = client.post(
        "/api/billing/sandbox/confirm",
        headers=headers,
        json={"payment_id": payment_id, "outcome": "succeeded"},
    )
    assert confirm.status_code == 200, confirm.text
    return headers


def test_checkout_is_labelled_sandbox_and_requires_free_csrf(client):
    register(client, "checkout@example.com")
    # Without CSRF it must be rejected.
    no_csrf = client.post("/api/billing/checkout", json={"plan_key": "pro"})
    assert no_csrf.status_code == 403

    headers = auth_headers(client, "checkout@example.com")
    response = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"})
    assert response.status_code == 200
    assert response.json()["mode"] == "sandbox"


def test_checkout_rejects_free_plan(client):
    register(client, "freec@example.com")
    headers = auth_headers(client, "freec@example.com")
    response = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "free"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "free_plan_no_checkout"


def test_successful_sandbox_payment_activates_pro(client):
    headers = _activate_pro(client, "paid@example.com")

    subscription = client.get("/api/subscription", headers=headers).json()
    assert subscription["status"] == "active"
    assert subscription["plan_key"] == "pro"


def test_failed_payment_does_not_grant_pro(client):
    register(client, "failed@example.com")
    headers = auth_headers(client, "failed@example.com")

    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"}).json()
    client.post(
        "/api/billing/sandbox/confirm",
        headers=headers,
        json={"payment_id": checkout["payment_id"], "outcome": "failed"},
    )

    subscription = client.get("/api/subscription", headers=headers).json()
    assert subscription["status"] != "active"
    assert subscription["plan_key"] == "free"


def test_cancelled_payment_does_not_grant_pro(client):
    register(client, "cancel@example.com")
    headers = auth_headers(client, "cancel@example.com")
    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"}).json()
    client.post(
        "/api/billing/sandbox/confirm",
        headers=headers,
        json={"payment_id": checkout["payment_id"], "outcome": "cancelled"},
    )
    assert client.get("/api/subscription", headers=headers).json()["plan_key"] == "free"


def test_webhook_rejects_invalid_signature(client):
    register(client, "hook@example.com")
    headers = auth_headers(client, "hook@example.com")
    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"}).json()

    body = json.dumps(
        {
            "ref": _provider_ref(checkout["payment_id"]),
            "status": "succeeded",
            "amount_cents": 0,
            "currency": "UZS",
        }
    ).encode()

    response = client.post(
        "/api/billing/webhook/fake-sandbox",
        content=body,
        headers={"X-Signature-256": "deadbeef"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_signature"


def test_webhook_with_valid_signature_activates_and_is_idempotent(client):
    register(client, "hook2@example.com")
    headers = auth_headers(client, "hook2@example.com")
    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"}).json()
    ref = _provider_ref(checkout["payment_id"])

    body, signature = _sign(ref, "succeeded")
    first = client.post(
        "/api/billing/webhook/fake-sandbox", content=body, headers={"X-Signature-256": signature}
    )
    assert first.status_code == 200

    # Duplicate delivery must be a no-op.
    second = client.post(
        "/api/billing/webhook/fake-sandbox", content=body, headers={"X-Signature-256": signature}
    )
    assert second.status_code == 200

    from app.database import SessionLocal

    with SessionLocal() as db:
        invoices = db.execute(select(Invoice)).scalars().all()
        assert len(invoices) == 1  # no duplicate invoice

    assert client.get("/api/subscription", headers=headers).json()["status"] == "active"


def test_webhook_unknown_payment_is_rejected(client):
    body, signature = _sign("fake_unknown_ref", "succeeded")
    response = client.post(
        "/api/billing/webhook/fake-sandbox", content=body, headers={"X-Signature-256": signature}
    )
    assert response.status_code == 404


def test_configured_provider_flag_rejects_unknown_provider_name(client):
    body, signature = _sign("whatever", "succeeded")
    response = client.post(
        "/api/billing/webhook/stripe", content=body, headers={"X-Signature-256": signature}
    )
    assert response.status_code == 404


def test_invoice_created_only_for_confirmed_payment(client):
    headers = _activate_pro(client, "invoice@example.com")
    invoices = client.get("/api/invoices", headers=headers).json()
    assert len(invoices) == 1
    assert invoices[0]["status"] == "paid"
    assert invoices[0]["number"].startswith("INV-")


def test_billing_history_records_events_without_secrets(client):
    headers = _activate_pro(client, "history@example.com")
    events = client.get("/api/billing/history", headers=headers).json()
    types = {event["event_type"] for event in events}
    assert "checkout_created" in types
    assert "payment_succeeded" in types
    # No secret material should ever appear.
    blob = json.dumps(events)
    assert WEBHOOK_SECRET not in blob
    assert "password" not in blob.lower()


def test_user_only_sees_own_invoices(client):
    _activate_pro(client, "own1@example.com")
    # Switch the client to a second user.
    register(client, "own2@example.com")
    headers2 = auth_headers(client, "own2@example.com")
    assert client.get("/api/invoices", headers=headers2).json() == []


# --- helpers ---------------------------------------------------------------


def _provider_ref(payment_id: str) -> str:
    from app.database import SessionLocal

    with SessionLocal() as db:
        attempt = db.get(PaymentAttempt, payment_id)
        assert attempt is not None
        return attempt.provider_ref


def _sign(ref: str, status: str) -> tuple[bytes, str]:
    import hashlib
    import hmac

    body = json.dumps(
        {"ref": ref, "status": status, "amount_cents": 0, "currency": "UZS"}
    ).encode()
    signature = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, signature
