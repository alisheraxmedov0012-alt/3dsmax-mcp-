"""Unified error handling.

All API errors share one JSON shape:

    {"error": {"code": "not_authenticated", "message": "..."}}

Codes are stable strings the frontend can branch on. Messages never include
stack traces or secrets.
"""
from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def error_response(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


_HTTP_CODE_MAP = {
    status.HTTP_401_UNAUTHORIZED: ("not_authenticated", "Avtorizatsiya talab qilinadi."),
    status.HTTP_403_FORBIDDEN: ("forbidden", "Ruxsat yo'q."),
    status.HTTP_404_NOT_FOUND: ("not_found", "Topilmadi."),
    status.HTTP_429_TOO_MANY_REQUESTS: ("rate_limited", "Juda ko'p urinish. Keyinroq qayta urinib ko'ring."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):  # noqa: ANN202
        return error_response(exc.code, exc.message, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):  # noqa: ANN202
        return error_response(
            "validation_error",
            "So'rov ma'lumotlari noto'g'ri.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):  # noqa: ANN202
        code, message = _HTTP_CODE_MAP.get(exc.status_code, ("http_error", str(exc.detail)))
        return error_response(code, message, exc.status_code)
