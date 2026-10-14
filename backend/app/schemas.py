"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt limit


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def _password_size(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Parol {MAX_PASSWORD_BYTES} baytdan oshmasligi kerak.")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def _password_size(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Parol {MAX_PASSWORD_BYTES} baytdan oshmasligi kerak.")
        return value


class VerifyEmailRequest(BaseModel):
    token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    role: str
    is_email_verified: bool
    created_at: datetime


class SessionResponse(BaseModel):
    """Returned on login/register. The cookie is set separately; the CSRF token
    is echoed here so the SPA can send it back on state-changing requests."""

    user: UserResponse
    csrf_token: str
    # Only present in non-production when APP_EXPOSE_DEV_TOKENS is enabled.
    dev_verification_token: str | None = None


class MessageResponse(BaseModel):
    message: str
    dev_token: str | None = None


class PlanLimits(BaseModel):
    model_config = ConfigDict(extra="allow")
    max_projects: int | None = None
    max_png_exports: int | None = None
    max_glb_exports: int | None = None
    max_ai_requests: int | None = None


class PlanResponse(BaseModel):
    key: str
    name: str
    is_active: bool
    limits: dict[str, Any]
    price_cents: int | None
    currency: str | None
    period_days: int | None


class UsageResponse(BaseModel):
    metric: str
    used: int
    limit: int | None


class SubscriptionResponse(BaseModel):
    plan_key: str
    plan_name: str
    status: str
    current_period_end: datetime | None
    limits: dict[str, Any]
    usage: list[UsageResponse]


class CheckoutRequest(BaseModel):
    plan_key: str


class CheckoutResponse(BaseModel):
    payment_id: str
    provider: str
    # "sandbox" for the fake substitute; never imply a real provider.
    mode: Literal["sandbox"]
    status: str
    amount_cents: int | None
    currency: str | None
    # Endpoint the frontend may call to simulate the provider confirmation.
    confirm_url: str | None = None
    cancelled_url: str | None = None


class CheckoutConfirmRequest(BaseModel):
    payment_id: str
    outcome: Literal["succeeded", "failed", "cancelled"] = "succeeded"


class InvoiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    number: str
    description: str
    amount_cents: int
    currency: str
    status: str
    issued_at: datetime
    paid_at: datetime | None


class BillingEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_type: str
    data: dict[str, Any]
    created_at: datetime


class LocalProjectImportItem(BaseModel):
    client_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    scene: dict[str, Any]


class LocalProjectImportRequest(BaseModel):
    projects: list[LocalProjectImportItem] = Field(default_factory=list, max_length=500)


class LocalProjectImportResult(BaseModel):
    imported: int
    skipped: int
    project_ids: list[str]


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    role: str
    is_active: bool
    is_email_verified: bool


# ---------------------------------------------------------------------------
# W10 — server-side projects
# ---------------------------------------------------------------------------


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # A bare scene dict or a W8 container; validated server-side.
    scene: dict[str, Any]


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    scene: dict[str, Any] | None = None
    # Optimistic concurrency: when provided it must match the stored version.
    expected_version: int | None = Field(default=None, ge=1)


class ProjectResponse(BaseModel):
    id: str
    client_id: str
    name: str
    version: int
    schema_version: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    scene: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# W10 — job queue
# ---------------------------------------------------------------------------


class JobCreateRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=40)
    # Client-supplied idempotency key; a repeat returns the same job.
    idempotency_key: str = Field(min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: str
    kind: str
    status: str
    attempts: int
    max_attempts: int
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


# ---------------------------------------------------------------------------
# W10 — cloud storage
# ---------------------------------------------------------------------------


class StoredFileResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    format: str
    size_bytes: int
    project_id: str | None = None
    created_at: datetime | None = None


class StorageStatusResponse(BaseModel):
    backend: str
    available: bool
    persistent: bool
    message: str
