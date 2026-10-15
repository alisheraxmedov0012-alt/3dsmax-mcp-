"""Test fixtures.

Tests run against SQLite (see README) because PostgreSQL is not available in
the test environment. PostgreSQL-specific behaviour (types, sequences,
migrations applied against Postgres) is therefore NOT verified here and is
called out in the report.
"""
from __future__ import annotations

import os
import tempfile

import pytest

# Configure the environment BEFORE importing the app.
_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="apptest-"), "test.db")
os.environ.setdefault("APP_DATABASE_URL", f"sqlite:///{_TMP_DB}")
os.environ["APP_ENVIRONMENT"] = "test"
os.environ["APP_EXPOSE_DEV_TOKENS"] = "true"
os.environ["APP_SECRET_KEY"] = "test-secret"
os.environ["APP_PAYMENT_PROVIDER"] = "fake"
os.environ["APP_PAYMENT_WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["APP_RATE_LIMIT_ATTEMPTS"] = "1000"
# W11: tests exercise many requests from a single client, so the tighter
# built-in per-scope defaults (login/register/…) are raised here explicitly. The
# per-scope behaviour itself is covered by dedicated tests with their own
# overrides, so this does not weaken that coverage.
os.environ["APP_RATE_LIMIT_SCOPES"] = "login=1000,register=1000,forgot=1000,reset=1000,webhook=1000"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.services.plans import seed_plans  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_plans(db)
    yield


@pytest.fixture
def db_session():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    def _get_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def register(client: TestClient, email: str, password: str = "Sup3rSecret!"):
    response = client.post("/api/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return response


def login(client: TestClient, email: str, password: str = "Sup3rSecret!"):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response


def auth_headers(client: TestClient, email: str, password: str = "Sup3rSecret!") -> dict[str, str]:
    data = login(client, email, password).json()
    return {"X-CSRF-Token": data["csrf_token"]}


def create_admin_user(email: str, password: str = "AdminSecret123!") -> str:
    """Create an admin directly in the database (as the CLI bootstrap would)."""
    from app.security import hash_password

    with SessionLocal() as db:
        user = User(
            email=email.strip().lower(),
            password_hash=hash_password(password),
            role="admin",
            is_email_verified=True,
        )
        db.add(user)
        db.commit()
        return user.id
