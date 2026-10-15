"""W11 usage & cost metering endpoints.

These expose the append-only usage ledger for the authenticated user. They are
read-only: usage is recorded server-side by the operations that consume
resources, never by the client. No secret or provider key is ever included.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import UsageRecordResponse, UsageSummaryRow
from ..services.usage import list_usage, record_to_dict, usage_summary

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/summary", response_model=list[UsageSummaryRow])
def summary(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[UsageSummaryRow]:
    return [UsageSummaryRow(**row) for row in usage_summary(db, user)]


@router.get("/records", response_model=list[UsageRecordResponse])
def records(
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> list[UsageRecordResponse]:
    return [UsageRecordResponse(**record_to_dict(row)) for row in list_usage(db, user, limit=limit)]


__all__ = ["router"]
