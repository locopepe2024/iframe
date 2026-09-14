from starlette.requests import Request
from starlette.responses import Response

from src.apps.identity import (
    BROWSER_PROFILE_COOKIE,
    _browser_context,
    _resolve_request_context,
    _set_browser_profile_cookie,
)


def _request(scheme: str = "https") -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-proto", scheme.encode())],
        "scheme": "http",
    })


def test_browser_profile_is_stable_and_owner_scoped():
    first, should_set_cookie = _resolve_request_context(None, "profile-a")
    second, second_should_set_cookie = _resolve_request_context(None, "profile-a")

    assert first == second
    assert first.user_id == "browser-profile-a"
    assert first.owner_profile_id == "browser-profile-a"
    assert should_set_cookie is False
    assert second_should_set_cookie is False


def test_missing_browser_profile_creates_a_new_scope():
    first, first_should_set_cookie = _resolve_request_context(None, None)
    second, second_should_set_cookie = _resolve_request_context(None, None)

    assert first.owner_profile_id != second.owner_profile_id
    assert first_should_set_cookie is True
    assert second_should_set_cookie is True


def test_browser_profile_cookie_is_httponly_and_secure_over_https():
    identity = _browser_context("profile-a")
    response = Response()

    _set_browser_profile_cookie(response, _request(), identity)

    cookie = response.headers["set-cookie"]
    assert f"{BROWSER_PROFILE_COOKIE}=profile-a" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" in cookie
