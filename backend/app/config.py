"""Application configuration.

All settings come from environment variables (prefix ``APP_``) or a local
``.env`` file. Nothing secret is hard-coded here; see ``.env.example`` for the
expected variables. Production must provide its own values.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Core
    app_name: str = "3D Studio AI API"
    environment: str = "development"  # development | test | production
    debug: bool = False

    # Database. Defaults to a local SQLite file so the app runs without an
    # external server; production sets a PostgreSQL DSN, e.g.
    #   postgresql+psycopg://user:pass@host:5432/3dstudio
    database_url: str = "sqlite:///./3dstudio.db"

    # Session / cookie security
    secret_key: str = "dev-insecure-change-me"
    session_ttl_seconds: int = 60 * 60 * 24 * 7  # 7 days
    cookie_name: str = "session"
    cookie_secure: bool = False  # must be True in production (HTTPS)
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None

    # CSRF
    csrf_header_name: str = "X-CSRF-Token"

    # CORS: comma-separated list of allowed frontend origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Rate limiting (simple in-process limiter; documented limitation).
    rate_limit_attempts: int = 10
    rate_limit_window_seconds: int = 60

    # Email verification / password reset
    token_ttl_seconds: int = 60 * 60 * 24  # 24h
    # When no SMTP is configured the app uses a console adapter (development/
    # test only). It never pretends to deliver real email.
    email_backend: str = "console"  # console | smtp
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    email_from: str = "no-reply@example.invalid"
    # Expose tokens in API responses ONLY for local/test convenience.
    expose_dev_tokens: bool = False

    # Payments
    # Selected provider: "fake" (sandbox substitute), "stripe" (not configured
    # here), or "none". Only "fake" is wired in this stage; it is clearly
    # labelled as a sandbox substitute, never a real provider.
    payment_provider: str = "fake"
    payment_webhook_secret: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
