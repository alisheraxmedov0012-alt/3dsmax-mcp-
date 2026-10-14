"""Authentication tests: registration, login, sessions, verification, reset."""
from __future__ import annotations

from sqlalchemy import select

from app.models import User
from tests.conftest import auth_headers, login, register


def test_register_hashes_password_and_creates_session(client, db_session):
    response = register(client, "alice@example.com")
    body = response.json()

    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["role"] == "user"
    assert body["user"]["is_email_verified"] is False
    assert body["csrf_token"]

    user = db_session.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    assert user.password_hash != "Sup3rSecret!"
    assert user.password_hash.startswith("$2")  # bcrypt


def test_register_rejects_short_password(client):
    response = client.post(
        "/api/auth/register", json={"email": "bob@example.com", "password": "short"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_register_rejects_duplicate_email(client):
    register(client, "carol@example.com")
    response = client.post(
        "/api/auth/register", json={"email": "carol@example.com", "password": "Sup3rSecret!"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


def test_login_returns_generic_error_for_bad_credentials(client):
    register(client, "dave@example.com")

    wrong_password = client.post(
        "/api/auth/login", json={"email": "dave@example.com", "password": "WrongPass1!"}
    )
    unknown_email = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "Sup3rSecret!"}
    )

    assert wrong_password.status_code == 401
    assert unknown_email.status_code == 401
    # Same code/message: no account enumeration.
    assert wrong_password.json() == unknown_email.json()


def test_me_requires_authentication(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_me_returns_current_user(client):
    register(client, "erin@example.com")
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == "erin@example.com"


def test_logout_revokes_session(client):
    register(client, "frank@example.com")
    headers = auth_headers(client, "frank@example.com")

    logout = client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 200

    after = client.get("/api/auth/me")
    assert after.status_code == 401


def test_logout_requires_csrf(client):
    register(client, "grace@example.com")
    # Session cookie present, but no CSRF header.
    response = client.post("/api/auth/logout")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_email_verification_flow(client):
    data = register(client, "heidi@example.com").json()
    token = data["dev_verification_token"]
    assert token

    verify = client.post("/api/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    me = client.get("/api/auth/me").json()
    assert me["is_email_verified"] is True


def test_verification_token_is_single_use(client):
    data = register(client, "ivan@example.com").json()
    token = data["dev_verification_token"]

    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    second = client.post("/api/auth/verify-email", json={"token": token})
    assert second.status_code == 400


def test_password_reset_flow_revokes_sessions(client):
    register(client, "judy@example.com")
    headers = auth_headers(client, "judy@example.com")

    forgot = client.post("/api/auth/forgot-password", json={"email": "judy@example.com"})
    token = forgot.json()["dev_token"]
    assert token

    reset = client.post(
        "/api/auth/reset-password", json={"token": token, "password": "NewSecret123!"}
    )
    assert reset.status_code == 200

    # Old session is revoked.
    assert client.get("/api/auth/me").status_code == 401
    # Old password no longer works.
    assert client.post(
        "/api/auth/login", json={"email": "judy@example.com", "password": "Sup3rSecret!"}
    ).status_code == 401
    # New password works.
    assert login(client, "judy@example.com", "NewSecret123!").status_code == 200


def test_reset_token_is_single_use(client):
    register(client, "karl@example.com")
    token = client.post(
        "/api/auth/forgot-password", json={"email": "karl@example.com"}
    ).json()["dev_token"]

    assert (
        client.post(
            "/api/auth/reset-password", json={"token": token, "password": "Another123!"}
        ).status_code
        == 200
    )
    second = client.post(
        "/api/auth/reset-password", json={"token": token, "password": "Another123!"}
    )
    assert second.status_code == 400


def test_forgot_password_does_not_reveal_account_existence(client):
    register(client, "leo@example.com")
    existing = client.post("/api/auth/forgot-password", json={"email": "leo@example.com"})
    missing = client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert existing.json()["message"] == missing.json()["message"]
