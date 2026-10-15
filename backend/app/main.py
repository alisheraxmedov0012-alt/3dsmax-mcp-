"""FastAPI application entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, SessionLocal, engine
from .error_tracking import init_error_tracking
from .errors import install_error_handlers
from .logging_config import configure_logging
from .middleware import ObservabilityMiddleware
from .routers import (
    admin,
    auth,
    billing,
    files,
    health,
    jobs,
    plans,
    projects,
    usage,
)
from .services import jobs as jobs_service
from .services.plans import seed_plans

settings = get_settings()
configure_logging()
logger = logging.getLogger("app")


def _validate_production_config() -> None:
    problems = settings.production_problems()
    if problems:
        for problem in problems:
            logger.error("Unsafe production configuration: %s", problem)
        raise RuntimeError(
            "Production konfiguratsiyasi xavfsiz emas. Muammolar: " + "; ".join(problems)
        )


if settings.is_production:
    _validate_production_config()

init_error_tracking()

# Interactive API docs are available in development only. In production they are
# disabled so the API surface is not publicly enumerable.
_docs_enabled = not settings.is_production

app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Observability/security headers middleware must wrap everything else.
app.add_middleware(ObservabilityMiddleware)

install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", settings.csrf_header_name, "X-Request-ID"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(plans.router)
app.include_router(billing.router)
app.include_router(projects.router)
app.include_router(jobs.router)
app.include_router(files.router)
app.include_router(usage.router)
app.include_router(admin.router)


@app.on_event("startup")
def _startup() -> None:
    # Auto-creating tables is a local/test convenience only. In production the
    # schema is owned by Alembic migrations, so we do not create anything here.
    if not settings.is_production:
        Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_plans(db)
        # Recover jobs a previous process left ``running`` so nothing is stuck
        # forever after a crash or restart. Safe on every start: it only moves
        # jobs past their timeout to ``failed`` (marked retryable).
        recovered = jobs_service.recover_stale_jobs(db)
    logger.info(
        "Startup complete",
        extra={
            "metric": "startup",
            "environment": settings.environment,
            "recovered_jobs": recovered,
        },
    )


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "status": "ok"}
