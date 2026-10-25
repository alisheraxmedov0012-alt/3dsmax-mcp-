"""A3.4 F8 — the AI provider URL must not leak the API key.

``APP_AI_BASE_URL`` decides where the API key is sent. Over plain HTTP that key
travels in clear text, so every external host must use TLS; only an exact
loopback hostname (a gateway on the developer's own machine) may use HTTP.

The checks run while the settings load, so a misconfigured deployment fails to
start instead of sending a key somewhere unsafe on the first request.

No network access: these tests only build ``Settings`` objects and call the
validator directly.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings, validate_ai_base_url


def _settings_with_base_url(url: str) -> Settings:
    return Settings(ai_base_url=url)


# --------------------------------------------------------------------------- #
# Accepted values
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        "https://api.openai.com/v1",
        "https://provider.example.com/v1",
        "https://api.openai.com/v1/",  # trailing slash is harmless
        "HTTPS://API.OPENAI.COM/v1",  # scheme and host are case-insensitive
        "https://192.0.2.10:8443/v1",
        "https://[2001:db8::1]/v1",
    ],
)
def test_external_https_url_is_accepted(url):
    """A TLS URL works for any host, including non-default ports and IPv6."""
    assert _settings_with_base_url(url).ai_base_url == url


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:11434/v1",
        "http://127.0.0.1:11434/v1",
        "http://localhost/v1",
        "http://LOCALHOST:8080/v1",  # hostnames are case-insensitive
        "http://[::1]:8080/v1",
        "http://127.0.0.1",
    ],
)
def test_loopback_http_url_is_accepted(url):
    """A local gateway may use plain HTTP: the key never leaves the machine."""
    assert _settings_with_base_url(url).ai_base_url == url


def test_default_value_is_https():
    """The shipped default must itself pass the rule."""
    assert Settings().ai_base_url.startswith("https://")


# --------------------------------------------------------------------------- #
# Rejected values
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        "http://api.openai.com/v1",
        "http://provider.example.com/v1",
        "http://192.0.2.10/v1",
        # Lookalikes that must not be treated as loopback.
        "http://localhost.example.com/v1",
        "http://127.0.0.1.attacker.example/v1",
        "http://localhost.attacker.example:8080/v1",
        "http://127.0.0.1.nip.io/v1",
    ],
)
def test_external_http_url_is_rejected(url):
    """Plain HTTP outside loopback would expose the key, so it is refused."""
    with pytest.raises(ValidationError) as excinfo:
        _settings_with_base_url(url)
    assert "https://" in str(excinfo.value)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://provider.example.com/v1",
        "gopher://provider.example.com/v1",
        "data:text/plain,hello",
        "javascript:alert(1)",
    ],
)
def test_unsupported_scheme_is_rejected(url):
    with pytest.raises(ValidationError):
        _settings_with_base_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "api.openai.com/v1",  # no scheme at all
        "//api.openai.com/v1",  # scheme-relative
        "https://",  # no host
        "https:///v1",  # empty host
        "http:///v1",
    ],
)
def test_missing_scheme_or_host_is_rejected(url):
    with pytest.raises(ValidationError):
        _settings_with_base_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@api.openai.com/v1",
        "https://user@api.openai.com/v1",
        # Even on loopback: a password in configuration is a secret in the
        # wrong place, and it would end up in a startup error message.
        "http://user:password@localhost:11434/v1",
    ],
)
def test_embedded_credentials_are_rejected(url):
    with pytest.raises(ValidationError):
        _settings_with_base_url(url)


# --------------------------------------------------------------------------- #
# Existing behaviour is preserved
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("url", ["", "   "])
def test_blank_value_still_loads(url):
    """A blank value keeps loading, exactly as before F8.

    Validation only adds rules; it must not turn an unset/blank configuration
    into a startup failure.
    """
    assert _settings_with_base_url(url).ai_base_url == url


def test_empty_value_still_means_unconfigured():
    """An empty base URL already meant "no provider"; that is preserved.

    The API answers 503 ai_unconfigured instead of calling anyone.
    """
    from app.services.ai.openai_provider import OpenAiCompatibleProvider

    provider = OpenAiCompatibleProvider(
        api_key="k", base_url=Settings(ai_base_url="").ai_base_url, model="m"
    )
    assert provider.is_configured is False


# --------------------------------------------------------------------------- #
# The error must never expose the secret
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        "https://user:s3cr3t-value@api.openai.com/v1",
        "http://s3cr3t-value@localhost:11434/v1",
        "http://api.openai.com/v1?key=s3cr3t-value",
        "http://s3cr3t-value.example.com/v1",
    ],
)
def test_error_message_does_not_echo_the_url_or_its_credentials(url):
    with pytest.raises(ValidationError) as excinfo:
        _settings_with_base_url(url)
    message = str(excinfo.value)
    assert "s3cr3t-value" not in message
    # The rejected value itself is not dumped either.
    assert url not in message
    assert "input_value" not in message


def test_api_key_is_never_included_in_a_rejected_url_error():
    """The AI key lives in its own setting and must not appear either."""
    secret = "sk-live-should-never-appear"
    with pytest.raises(ValidationError) as excinfo:
        Settings(ai_base_url="http://api.openai.com/v1", ai_api_key=secret)
    assert secret not in str(excinfo.value)


# --------------------------------------------------------------------------- #
# The validator on its own
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value",
    ["https://api.openai.com/v1", "http://localhost:8080/v1", "", "  "],
)
def test_validator_returns_accepted_values_unchanged(value):
    assert validate_ai_base_url(value) == value


def test_validator_rejects_without_mentioning_the_value():
    with pytest.raises(ValueError) as excinfo:
        validate_ai_base_url("http://token-abc123.example.com/v1")
    assert "token-abc123" not in str(excinfo.value)


# --------------------------------------------------------------------------- #
# Redirects must not become an HTTPS-bypass route
# --------------------------------------------------------------------------- #


def test_a_redirect_is_not_followed_to_another_host():
    """A 3xx must not silently move the request (and the key) somewhere else.

    The client is built without ``follow_redirects``, so a provider answering
    302 cannot redirect the call to a plain-HTTP or attacker host. This test
    pins that behaviour: if someone later enables redirect following, an
    https provider could be downgraded after the URL check has already passed.
    """
    import httpx

    from app.services.ai.base import AiProviderError
    from app.services.ai.openai_provider import OpenAiCompatibleProvider

    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": "http://elsewhere.example.com/steal"})

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://api.example.invalid/v1",
        model="test-model",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(AiProviderError):
        provider.generate_design(_request())

    # Exactly one request, and it went to the configured host only.
    assert len(requests) == 1
    assert requests[0].startswith("https://api.example.invalid/v1/")


def _request():
    from app.services.ai.base import DesignRequest

    return DesignRequest(text="stol")
