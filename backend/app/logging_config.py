"""Structured logging with request correlation and secret redaction.

* ``configure_logging()`` installs either JSON or plain-text logs.
* A per-request id is stored in a context variable so log lines and error
  responses can be correlated.
* ``RedactionFilter`` removes anything that looks like a secret from log
  messages as a defence-in-depth measure; application code must still avoid
  logging secrets in the first place.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar

from .config import get_settings

_request_id: ContextVar[str] = ContextVar("request_id", default="-")

# Keys whose values must never appear in logs.
_SENSITIVE_KEYS = (
    "password",
    "passwd",
    "secret",
    "token",
    "csrf",
    "authorization",
    "cookie",
    "set-cookie",
    "api_key",
    "apikey",
    "card",
    "cvv",
    "cvc",
    "dsn",
)

# Patterns: key=value / "key": "value" / Bearer tokens.
# Keys may be compound (e.g. csrf_token, api_key), so the sensitive word is
# matched inside an identifier rather than as a standalone word.
_KEY = r"[A-Za-z0-9_\-]*(?:" + "|".join(_SENSITIVE_KEYS) + r")[A-Za-z0-9_\-]*"
_KEY_VALUE_RE = re.compile(r"(?i)\b(" + _KEY + r")\s*[:=]\s*([^\s,;\"'}]+)")
_JSON_FIELD_RE = re.compile(r'(?i)"(' + _KEY + r')"\s*:\s*"[^"]*"')
_BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*")


def redact(text: str) -> str:
    """Return ``text`` with likely secrets replaced by ``***``."""
    text = _BEARER_RE.sub("Bearer ***", text)
    text = _JSON_FIELD_RE.sub(lambda m: f'"{m.group(1)}": "***"', text)
    text = _KEY_VALUE_RE.sub(lambda m: f"{m.group(1)}=***", text)
    return text


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            return True
        if message != record.msg:
            record.msg = redact(message)
            record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
            "request_id": _request_id.get(),
        }
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        for key in ("path", "method", "status_code", "duration_ms", "metric"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str:
    return _request_id.get()


def configure_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactionFilter())
    if settings.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if settings.debug else logging.INFO)
