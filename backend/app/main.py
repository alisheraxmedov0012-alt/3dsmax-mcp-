"""FastAPI application entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, SessionLocal, engine
from .errors import install_error_handlers
from .routers import admin, auth, billing, health, plans, projects
from .services.plans import seed_plans

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

settings = get_settings()

# Interactive API docs are available in development only. In production they are
# disabled so the API surface is not publicly enumerable.
_docs_enabled = not settings.is_production

app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", settings.csrf_header_name],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(plans.router)
app.include_router(billing.router)
app.include_router(projects.router)
app.include_router(admin.router)


@app.on_event("startup")
def _startup() -> None:
    # For local/dev convenience create tables if migrations have not been run.
    # Production uses Alembic migrations (see README).
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_plans(db)
    if settings.is_production and not settings.cookie_secure:
        logger.warning("Production muhitida APP_COOKIE_SECURE=true bo'lishi kerak.")


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "status": "ok"}
