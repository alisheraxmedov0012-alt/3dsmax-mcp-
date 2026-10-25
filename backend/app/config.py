"""Application configuration.

All settings come from environment variables (prefix ``APP_``) or a local
``.env`` file. Nothing secret is hard-coded here; see ``.env.example`` for the
expected variables. Production must provide its own values.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

#: Payment provider names that are sandbox/test substitutes and must never be
#: active in production (they would let subscriptions activate without payment).
SANDBOX_PAYMENT_PROVIDERS = frozenset({"fake", "fake-sandbox", "sandbox"})

#: Cookie SameSite values that keep the browser-side CSRF layer intact.
SAFE_SAMESITE_VALUES = frozenset({"lax", "strict"})

#: Schemes accepted for ``APP_REDIS_URL`` (plain and TLS).
REDIS_URL_SCHEMES = ("redis://", "rediss://")


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

    # Rate limiting
    # A shared store (Redis) makes limits global across workers. If no Redis URL
    # is configured, the app falls back to an in-process limiter and reports the
    # limitation clearly (see README); it never claims global enforcement.
    rate_limit_attempts: int = 10
    rate_limit_window_seconds: int = 60
    rate_limit_backend: str = "memory"  # memory | redis
    redis_url: str | None = None
    # W11: per-scope overrides, e.g. "login=5,ai=3,files=30". A scope not listed
    # keeps its built-in default (see app/rate_limit.py); an unset value falls
    # back to ``rate_limit_attempts``.
    rate_limit_scopes: str = ""
    # W11: reverse-proxy handling. When true, the client IP is read from
    # ``X-Forwarded-For`` counting ``trusted_proxy_count`` hops from the right
    # (the address the trusted proxy appended last). Only enable this behind a
    # proxy you control; otherwise a client can spoof the header.
    trust_forwarded_for: bool = False
    trusted_proxy_count: int = 1
    # W11: maximum request body size for non-multipart requests (bytes). File
    # uploads are bounded separately by ``storage_max_bytes``.
    max_request_bytes: int = 1024 * 1024

    # Logging / observability
    log_format: str = "json"  # json | text
    error_tracking_dsn: str | None = None  # e.g. a Sentry DSN (never committed)
    error_tracking_sample_rate: float = 0.0

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

    # W10 — job queue.
    # ``inline`` runs jobs synchronously in the request (development/test only).
    # A production deployment must set ``worker`` and run a separate worker
    # process; the API never claims a job is processed by a background fleet when
    # no worker is configured.
    job_backend: str = "inline"  # inline | worker
    job_max_attempts: int = 3
    job_timeout_seconds: int = 300
    job_max_payload_bytes: int = 64 * 1024
    # W11: cap on jobs a single user may have running at once.
    job_max_parallel_per_user: int = 3
    # W11: how long a worker heartbeat stays fresh for readiness purposes.
    worker_heartbeat_ttl_seconds: int = 60

    # W10 — file storage.
    # ``memory`` keeps bytes in-process (test/development); ``local`` writes to
    # ``storage_dir``; ``s3`` is a documented boundary that is NOT implemented
    # here and must be configured by a real deployment.
    storage_backend: str = "memory"  # memory | local | s3
    storage_dir: str = "./var/storage"
    storage_max_bytes: int = 25 * 1024 * 1024
    storage_max_project_bytes: int = 200 * 1024 * 1024

    # AI design provider (W1). "none" (default) reports the integration as
    # unconfigured; "local" is the offline, credential-free fallback;
    # "openai_compatible" talks to any OpenAI-compatible /chat/completions API.
    # The API key is read from the server environment only and never logged or
    # exposed to the frontend.
    ai_provider: str = "none"  # none | local | openai_compatible
    ai_api_key: str | None = None
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str | None = None
    ai_timeout_seconds: float = 20.0
    ai_max_retries: int = 1
    # Overall wall-clock budget for one AI design request, covering every HTTP
    # call, retry wait and repair attempt. Kept below the frontend's 30s abort
    # (src/api/client.ts) so the browser receives a controlled error instead of
    # a dead connection. The two values must be changed together.
    ai_request_budget_seconds: float = 25.0
    # System-wide ceiling on AI provider calls per UTC day, across every user and
    # every backend replica. This is an abuse/cost guard, not a plan limit: it
    # protects the budget when a plan limit is unset or an account is misbehaving.
    # A conservative starting value for a single-operator deployment; raise it
    # deliberately after watching real usage.
    ai_global_daily_limit: int = 200

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def redis_url_has_known_scheme(self) -> bool:
        """True when the configured Redis URL uses a scheme redis-py accepts."""
        url = (self.redis_url or "").strip().lower()
        return any(url.startswith(scheme) for scheme in REDIS_URL_SCHEMES)

    def production_problems(self) -> list[str]:
        """Unsafe production configuration that must block startup.

        Returns a list of human-readable problems. Empty means the configuration
        is acceptable for production.
        """
        problems: list[str] = []
        if not self.is_production:
            return problems

        if not self.secret_key or self.secret_key == "dev-insecure-change-me":
            problems.append("APP_SECRET_KEY production uchun o'rnatilmagan (default qiymat).")
        if len(self.secret_key) < 32:
            problems.append("APP_SECRET_KEY kamida 32 belgidan iborat bo'lishi kerak.")
        if not self.cookie_secure:
            problems.append("Productionda APP_COOKIE_SECURE=true bo'lishi shart.")
        if self.expose_dev_tokens:
            problems.append("Productionda APP_EXPOSE_DEV_TOKENS=false bo'lishi shart.")
        if self.debug:
            problems.append("Productionda APP_DEBUG=false bo'lishi shart.")
        origins = self.cors_origin_list
        if not origins:
            problems.append("Productionda APP_CORS_ORIGINS aniq ko'rsatilishi kerak.")
        if "*" in origins:
            problems.append("Productionda CORS uchun '*' ishlatilmasin (credentials bilan xavfli).")
        if self.database_url.startswith("sqlite"):
            problems.append("Productionda SQLite emas, PostgreSQL ishlatilishi kerak.")
        if self.rate_limit_backend == "redis" and not self.redis_url:
            problems.append("APP_RATE_LIMIT_BACKEND=redis uchun APP_REDIS_URL kerak.")
        elif self.rate_limit_backend == "redis" and not self.redis_url_has_known_scheme():
            # A misconfigured URL would only fail at the first request, deep in
            # the limiter; catching it at startup keeps the deployment honest.
            problems.append(
                "APP_REDIS_URL 'redis://' yoki 'rediss://' bilan boshlanishi kerak."
            )
        # W11: the in-process limiter keeps a per-worker counter, so with more
        # than one worker the effective limit becomes workers x limit. A
        # production deployment must not rely on it.
        if self.rate_limit_backend != "redis":
            problems.append(
                "Productionda APP_RATE_LIMIT_BACKEND=redis bo'lishi shart "
                "(memory backend har bir worker uchun alohida hisob yuritadi)."
            )
        # Defence in depth: the CSRF token is the primary protection, but a
        # SameSite=None cookie removes the browser-side second layer and is only
        # meaningful for a cross-site frontend, which this app does not have.
        if (self.cookie_samesite or "").strip().lower() not in SAFE_SAMESITE_VALUES:
            problems.append(
                "Productionda APP_COOKIE_SAMESITE 'lax' yoki 'strict' bo'lishi kerak "
                "('none' cross-site cookie xavfini oshiradi)."
            )
        # W10: a production deployment must not silently rely on the in-process
        # job runner or on volatile storage.
        if self.job_backend != "worker":
            problems.append(
                "Productionda APP_JOB_BACKEND=worker bo'lishi shart (inline faqat test/ishlab chiqish uchun)."
            )
        if self.storage_backend == "s3":
            problems.append(
                "APP_STORAGE_BACKEND=s3 hali amalga oshirilmagan — production uchun storage adapterini sozlash kerak."
            )
        if self.storage_backend == "memory":
            problems.append(
                "Productionda APP_STORAGE_BACKEND=memory ishlatilmasin (fayllar saqlanmaydi)."
            )
        # W12: test/sandbox adapters must never be silently active in production.
        # A sandbox payment provider would activate a subscription without a real
        # payment; the console email adapter would silently drop verification and
        # password-reset messages.
        if (self.payment_provider or "").lower() in SANDBOX_PAYMENT_PROVIDERS:
            problems.append(
                "Productionda APP_PAYMENT_PROVIDER sandbox ('fake') bo'lmasin — haqiqiy "
                "provayder sozlanmagan; sandbox obunani to'lovsiz faollashtiradi."
            )
        if (self.email_backend or "").lower() == "console":
            problems.append(
                "Productionda APP_EMAIL_BACKEND=smtp bo'lishi shart (console adapter xat "
                "yubormaydi; tasdiqlash/tiklash ishlamaydi)."
            )
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()

