"""Unified error handling.

All API errors share one JSON shape:

    {"error": {"code": "...", "message": "..."}}

Codes are stable strings the frontend can branch on. Messages never include
stack traces, internal exception text or secrets. Unhandled exceptions are
logged server-side (with a request id) and returned as a generic 500 so no
internal detail leaks to the client.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import get_request_id

logger = logging.getLogger("app.errors")

GENERIC_500 = "Serverda kutilmagan xatolik. Iltimos, keyinroq qayta urinib ko'ring."


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def error_response(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"error": {"code": code, "message": message}}
    )


# Client-safe messages for HTTP statuses we do not handle explicitly.
_HTTP_CODE_MAP = {
    status.HTTP_400_BAD_REQUEST: ("bad_request", "So'rov noto'g'ri."),
    status.HTTP_401_UNAUTHORIZED: ("not_authenticated", "Avtorizatsiya talab qilinadi."),
    status.HTTP_403_FORBIDDEN: ("forbidden", "Ruxsat yo'q."),
    status.HTTP_404_NOT_FOUND: ("not_found", "Topilmadi."),
    status.HTTP_405_METHOD_NOT_ALLOWED: ("method_not_allowed", "Usul qo'llab-quvvatlanmaydi."),
    status.HTTP_409_CONFLICT: ("conflict", "Ziddiyat yuz berdi."),
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: ("payload_too_large", "So'rov hajmi juda katta."),
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: (
        "unsupported_media_type",
        "Media turi qo'llab-quvvatlanmaydi.",
    ),
    status.HTTP_422_UNPROCESSABLE_ENTITY: ("validation_error", "So'rov ma'lumotlari noto'g'ri."),
    status.HTTP_429_TOO_MANY_REQUESTS: (
        "rate_limited",
        "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
    ),
    status.HTTP_500_INTERNAL_SERVER_ERROR: ("internal_error", GENERIC_500),
    status.HTTP_503_SERVICE_UNAVAILABLE: ("service_unavailable", "Xizmat vaqtincha mavjud emas."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(exc.code, exc.message, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        # Field-level detail is not echoed back to avoid leaking internals.
        return error_response(
            "validation_error",
            "So'rov ma'lumotlari noto'g'ri.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        mapped = _HTTP_CODE_MAP.get(exc.status_code)
        if mapped is None:
            # Unknown status: generic message, never the raw detail (which may
            # contain internal information). 5xx are treated as internal.
            if exc.status_code >= 500:
                return error_response("internal_error", GENERIC_500, exc.status_code)
            return error_response("http_error", "So'rov bajarilmadi.", exc.status_code)
        code, message = mapped
        return error_response(code, message, exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception):
        # Log the real error server-side only, tied to the request id.
        logger.exception(
            "Unhandled error",
            extra={"request_id": get_request_id(), "path": request.url.path},
        )
        return error_response("internal_error", GENERIC_500, status.HTTP_500_INTERNAL_SERVER_ERROR)
