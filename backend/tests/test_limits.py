"""Plan limits: server-side enforcement, plan switching, usage reporting."""
from __future__ import annotations

from sqlalchemy import select

from app.models import Plan, Subscription, User
from tests.conftest import auth_headers, register


def _set_limit(plan_key: str, key: str, value: int) -> None:
    from app.database import SessionLocal

    with SessionLocal() as db:
        plan = db.execute(select(Plan).where(Plan.key == plan_key)).scalar_one()
        limits = dict(plan.limits or {})
        limits[key] = value
        plan.limits = limits
        db.commit()


def test_plans_endpoint_lists_free_and_pro(client):
    plans = client.get("/api/plans")
    assert plans.status_code == 200
    keys = {plan["key"] for plan in plans.json()}
    assert {"free", "pro"}.issubset(keys)


def test_limits_default_to_unset_not_invented(client):
    """Roadmap does not define numbers; they must not be fabricated."""
    plans = {plan["key"]: plan for plan in client.get("/api/plans").json()}
    for key in ("max_projects", "max_png_exports", "max_glb_exports", "max_ai_requests"):
        assert plans["free"]["limits"].get(key) is None
        assert plans["pro"]["limits"].get(key) is None
    # Pro price/currency are not approved yet.
    assert plans["pro"]["price_cents"] is None
    assert plans["pro"]["currency"] is None


def test_free_plan_blocks_projects_beyond_limit(client):
    _set_limit("free", "max_projects", 1)
    register(client, "limited@example.com")
    headers = auth_headers(client, "limited@example.com")

    first = client.post(
        "/api/projects/import",
        headers=headers,
        json={"projects": [{"client_id": "a", "name": "A", "scene": {}}]},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/projects/import",
        headers=headers,
        json={"projects": [{"client_id": "b", "name": "B", "scene": {}}]},
    )
    assert second.status_code == 402
    assert second.json()["error"]["code"] == "limit_reached"


def test_reimport_is_idempotent_and_does_not_consume_limit(client):
    _set_limit("free", "max_projects", 1)
    register(client, "idem@example.com")
    headers = auth_headers(client, "idem@example.com")

    payload = {"projects": [{"client_id": "same", "name": "Same", "scene": {}}]}
    assert client.post("/api/projects/import", headers=headers, json=payload).status_code == 200
    # Re-importing the same client_id must not fail the limit nor duplicate.
    again = client.post("/api/projects/import", headers=headers, json=payload)
    assert again.status_code == 200
    assert again.json()["skipped"] == 1
    assert again.json()["imported"] == 0


def test_client_cannot_bypass_limit_with_payload_values(client):
    _set_limit("free", "max_projects", 0)
    register(client, "bypass@example.com")
    headers = auth_headers(client, "bypass@example.com")

    # A malicious client sending "isPro": true or a fake limit must still be blocked.
    response = client.post(
        "/api/projects/import",
        headers=headers,
        json={
            "projects": [{"client_id": "x", "name": "X", "scene": {}}],
            "isPro": True,
            "limits": {"max_projects": 9999},
        },
    )
    assert response.status_code == 402


def test_pro_limits_apply_only_with_active_subscription(client):
    _set_limit("free", "max_projects", 0)
    _set_limit("pro", "max_projects", 5)

    register(client, "switch@example.com")
    headers = auth_headers(client, "switch@example.com")

    # Free: blocked.
    blocked = client.post(
        "/api/projects/import",
        headers=headers,
        json={"projects": [{"client_id": "x", "name": "X", "scene": {}}]},
    )
    assert blocked.status_code == 402

    # Activate a Pro subscription directly (as a confirmed payment would).
    from app.database import SessionLocal
    from app.services.subscriptions import activate

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == "switch@example.com")).scalar_one()
        pro = db.execute(select(Plan).where(Plan.key == "pro")).scalar_one()
        subscription = Subscription(user_id=user.id, plan_id=pro.id, status="pending")
        db.add(subscription)
        db.flush()
        activate(subscription, pro)
        db.commit()

    allowed = client.post(
        "/api/projects/import",
        headers=headers,
        json={"projects": [{"client_id": "y", "name": "Y", "scene": {}}]},
    )
    assert allowed.status_code == 200


def test_usage_snapshot_reports_limits_and_counts(client):
    _set_limit("free", "max_png_exports", 3)
    register(client, "usage@example.com")
    headers = auth_headers(client, "usage@example.com")

    usage = client.get("/api/usage", headers=headers).json()
    by_metric = {row["metric"]: row for row in usage}
    assert by_metric["png_exports"]["limit"] == 3
    assert by_metric["png_exports"]["used"] == 0
