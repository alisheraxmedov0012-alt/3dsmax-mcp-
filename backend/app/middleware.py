"""Observability and hardening middleware.

* Assigns a request/correlation id (honouring an inbound ``X-Request-ID`` when
  it looks sane) and echoes it back so clients and logs can be correlated.
* Emits one structured access log line per request (no secrets).
* Adds conservative security response headers.
* W11: rejects oversized request bodies early with a precise 413 so a large
  payload cannot exhaust memory before validation, and records coarse request
  metrics (count by status, duration) for the process-local metrics endpoint.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import get_settings
from .errors import error_response
from .logging_config import get_request_id, set_request_id
from .metrics import incr, observe

logger = logging.getLogger("app.access")

_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# Applied to every response. Intentionally conservative: no CSP here (the SPA
# is served separately), but these block common classes of abuse.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
}

# Multipart uploads are bounded by the storage cap (plus multipart overhead)
# rather than the smaller JSON body cap.
_MULTIPART_OVERHEAD = 64 * 1024


def _effective_body_limit(request: Request) -> int:
    settings = get_settings()
    content_type = (request.headers.get("content-type") or "").lower()
    if content_type.startswith("multipart/form-data"):
        return settings.storage_max_bytes + _MULTIPART_OVERHEAD
    return settings.max_request_bytes


def _declared_length(request: Request) -> int | None:
    raw = request.headers.get("content-length")
    if raw is None or not raw.isdigit():
        return None
    return int(raw)


def _header(scope: dict, name: bytes) -> str:
    for raw_name, raw_value in scope.get("headers", ()):
        if raw_name.lower() == name:
            return raw_value.decode("latin-1")
    return ""


def _body_limit_for_scope(scope: dict) -> int:
    """Same limits as the declared-length check, resolved from a raw ASGI scope."""
    settings = get_settings()
    content_type = _header(scope, b"content-type").lower()
    if content_type.startswith("multipart/form-data"):
        return settings.storage_max_bytes + _MULTIPART_OVERHEAD
    return settings.max_request_bytes


class _BodyTooLarge(BaseException):
    """Internal control-flow signal, handled by ``BodySizeLimitMiddleware``.

    Derives from ``BaseException`` so Starlette's ``ExceptionMiddleware`` (which
    catches ``Exception``) cannot turn it into a 500 before the limit middleware
    has a chance to answer with 413.
    """


async def _send_payload_too_large(send: Send) -> None:
    body = json.dumps(
        {"error": {"code": "payload_too_large", "message": "So'rov hajmi juda katta."}},
        ensure_ascii=False,
    ).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})


class BodySizeLimitMiddleware:
    """Caps the request body even when ``Content-Length`` is absent.

    ``ObservabilityMiddleware`` can only reject a body whose declared length is
    already too large. A chunked request - or any request that omits the header -
    has no declared length, so the JSON parser would buffer the whole payload in
    memory and the multipart parser would spool it to disk before any cap
    applied.

    This middleware counts the bytes the ASGI server actually hands over and
    aborts as soon as the limit is passed, before the body can be fully
    collected. It answers with the same ``payload_too_large`` body the
    declared-length path produces, so clients see one consistent contract.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = _body_limit_for_scope(scope)
        received = 0

        async def limited_receive() -> dict:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        started = False

        async def tracking_send(message: dict) -> None:
            nonlocal started
            if message.get("type") == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if started:
                # A response already began; re-raising is the only honest option.
                raise
            incr("http_requests_total", method=scope.get("method", "-"), status=413)
            await _send_payload_too_large(send)


class ObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        inbound = request.headers.get("X-Request-ID", "")
        request_id = inbound if _SAFE_REQUEST_ID.match(inbound) else uuid.uuid4().hex
        set_request_id(request_id)

        # Reject an oversized body from its declared length before reading it.
        limit = _effective_body_limit(request)
        declared = _declared_length(request)
        if declared is not None and declared > limit:
            incr("http_requests_total", method=request.method, status=413)
            response = error_response(
                "payload_too_large", "So'rov hajmi juda katta.", 413
            )
            response.headers["X-Request-ID"] = request_id
            for header, value in SECURITY_HEADERS.items():
                response.headers.setdefault(header, value)
            return response

        started = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            incr("http_requests_total", method=request.method, status=500)
            logger.exception(
                "request failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                },
            )
            raise

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)

        # Metrics: never label with the raw path (could carry ids); use method and
        # status only so the series set stays bounded and non-sensitive.
        incr("http_requests_total", method=request.method, status=response.status_code)
        observe("http_request_duration_ms", duration_ms, method=request.method)

        # Health checks are noisy; log them at debug level.
        level = logging.DEBUG if request.url.path.startswith("/api/health") else logging.INFO
        logger.log(
            level,
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response


def current_request_id() -> str:
    return get_request_id()
