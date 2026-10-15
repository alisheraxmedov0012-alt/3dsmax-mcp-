"""Database engine, session factory and declarative base.

Supports PostgreSQL (production) and SQLite (local/tests). The DSN comes from
``APP_DATABASE_URL``.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    connect_args = {}
    is_sqlite = url.startswith("sqlite")
    if is_sqlite:
        # Allow the SQLite connection to be shared across the test client threads.
        connect_args = {"check_same_thread": False}
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True, future=True)
    if is_sqlite:
        # SQLite does NOT enforce foreign keys unless explicitly asked, so a local
        # or test run would silently accept orphaned rows that PostgreSQL
        # (production) rejects. Enabling the pragma keeps local behaviour aligned
        # with production and lets tests catch FK violations early.
        @event.listens_for(engine, "connect")
        def _sqlite_enable_foreign_keys(dbapi_connection, _record):  # pragma: no cover
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    return engine


_settings = get_settings()
engine = _make_engine(_settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
