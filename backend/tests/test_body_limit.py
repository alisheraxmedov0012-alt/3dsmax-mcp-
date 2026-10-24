"""P0-B / M-2 — the request body cap must hold without ``Content-Length``.

``ObservabilityMiddleware`` only rejects a body whose *declared* length is too
large. A chunked upload declares nothing, so the JSON parser buffered it whole
and the multipart parser spooled it to disk before any cap applied.

``BodySizeLimitMiddleware`` counts the bytes the ASGI server delivers and aborts
mid-stream. These tests drive it at the ASGI level (where the behaviour lives)
and through the real app with a chunked transfer.
"""
from __future__ import annotations

import asyncio
import json

from fastapi.testclient import TestClient

from app.config import get_settings
from app.middleware import BodySizeLimitMiddleware, _body_limit_for_scope


class _EchoBodyApp:
    """Minimal downstream app: reads the whole body, then replies with its size."""

    def __init__(self) -> None:
        self.received = 0

    async def __call__(self, scope, receive, send):
        total = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            total += len(message.get("body", b""))
            if not message.get("more_body", False):
                break
        self.received = total
        body = json.dumps({"received": total}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})


def _scope(headers: list[tuple[bytes, bytes]] | None = None) -> dict:
    return {
        "type": "http",
        "method": "POST",
        "path": "/api/projects/import",
        "headers": headers or [],
    }


def _run(app, scope, messages):
    """Drive one ASGI request; returns the messages the app sent."""

    async def go():
        queue = list(messages)
        sent: list[dict] = []

        async def receive():
            if queue:
                return queue.pop(0)
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)

        await app(scope, receive, send)
        return sent

    return asyncio.run(go())


def _chunks(payload: bytes, size: int) -> list[dict]:
    parts = [payload[i : i + size] for i in range(0, len(payload), size)] or [b""]
    return [
        {
            "type": "http.request",
            "body": part,
            "more_body": index < len(parts) - 1,
        }
        for index, part in enumerate(parts)
    ]


def _status(sent: list[dict]) -> int:
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


def _body(sent: list[dict]) -> dict:
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return json.loads(raw)


def test_chunked_body_within_limit_is_accepted():
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 1024
    try:
        inner = _EchoBodyApp()
        app = BodySizeLimitMiddleware(inner)
        payload = b"x" * 512

        sent = _run(app, _scope([(b"content-type", b"application/json")]), _chunks(payload, 128))

        assert _status(sent) == 200
        assert _body(sent)["received"] == 512
    finally:
        settings.max_request_bytes = original


def test_chunked_body_over_limit_is_rejected_without_content_length():
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 256
    try:
        inner = _EchoBodyApp()
        app = BodySizeLimitMiddleware(inner)
        payload = b"x" * 4096

        sent = _run(app, _scope([(b"content-type", b"application/json")]), _chunks(payload, 128))

        assert _status(sent) == 413
        assert _body(sent)["error"]["code"] == "payload_too_large"
        # The downstream app never completed the read.
        assert inner.received == 0
    finally:
        settings.max_request_bytes = original


def test_understated_content_length_is_still_enforced():
    """A client can declare 10 bytes and send far more; bytes are what count."""
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 256
    try:
        app = BodySizeLimitMiddleware(_EchoBodyApp())
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", b"10"),
        ]

        sent = _run(app, _scope(headers), _chunks(b"x" * 4096, 512))

        assert _status(sent) == 413
        assert _body(sent)["error"]["code"] == "payload_too_large"
    finally:
        settings.max_request_bytes = original


def test_multipart_uses_the_storage_limit():
    settings = get_settings()
    original = settings.storage_max_bytes
    settings.storage_max_bytes = 4096
    try:
        multipart = _body_limit_for_scope(
            _scope([(b"content-type", b"multipart/form-data; boundary=x")])
        )
        plain = _body_limit_for_scope(_scope([(b"content-type", b"application/json")]))

        # Multipart is bounded by the storage cap plus a fixed overhead, not by
        # the (separate) JSON request cap.
        assert multipart == 4096 + 64 * 1024
        assert plain == settings.max_request_bytes
        assert multipart != plain
    finally:
        settings.storage_max_bytes = original


def test_non_http_scope_passes_through():
    seen = {}

    async def app(scope, receive, send):
        seen["type"] = scope["type"]

    middleware = BodySizeLimitMiddleware(app)
    asyncio.run(middleware({"type": "lifespan"}, None, None))

    assert seen["type"] == "lifespan"


def test_response_already_started_is_not_rewritten():
    """If a response began before the limit tripped, the error is not swallowed."""

    async def app(scope, receive, send):
        await send(
            {"type": "http.response.start", "status": 200, "headers": [(b"x", b"y")]}
        )
        await receive()  # triggers the limit
        await send({"type": "http.response.body", "body": b"done"})

    middleware = BodySizeLimitMiddleware(app)
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 4
    try:
        try:
            _run(middleware, _scope(), _chunks(b"x" * 64, 8))
        except BaseException as exc:
            assert type(exc).__name__ == "_BodyTooLarge"
        else:  # pragma: no cover - would mean the signal was swallowed
            raise AssertionError("expected the body-limit signal to propagate")
    finally:
        settings.max_request_bytes = original


# ---------------------------------------------------------------------------
# Through the real application
# ---------------------------------------------------------------------------


def test_app_rejects_an_oversized_chunked_request(client: TestClient):
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 256
    try:
        body = b"x" * 4096
        # A generator body makes httpx send Transfer-Encoding: chunked with no
        # Content-Length, which is exactly the case the declared-length check
        # cannot see.
        response = client.post(
            "/api/auth/login",
            headers={"Content-Type": "application/json"},
            content=iter([body]),
        )

        assert response.status_code == 413
        assert response.json()["error"]["code"] == "payload_too_large"
    finally:
        settings.max_request_bytes = original


def test_app_accepts_a_normal_json_request(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "WrongPassword123!"},
    )

    # Reaches the endpoint and fails on credentials, not on the body cap.
    assert response.status_code == 401
