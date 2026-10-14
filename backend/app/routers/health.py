"""Health check."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health(db: OrmSession = Depends(get_db)) -> dict:
    # Verify the database is reachable.
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
