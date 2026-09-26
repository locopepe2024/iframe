"""UniArt-backed identity boundary for multi-user iFrame APIs."""

from __future__ import annotations

import os
import re
import secrets
import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Dict

import requests
from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Response
from pydantic import BaseModel


@dataclass(frozen=True)
class UserContext:
    user_id: str
    owner_profile_id: str
    display_name: str
    access_token: str


class LoginRequest(BaseModel):
    login_name: str
    password: str


class SessionTokenRequest(BaseModel):
    api_key: str
    ttl_seconds: int = 3600


BROWSER_PROFILE_COOKIE = "lumenx-browser-profile"
BROWSER_PROFILE_MAX_AGE = 60 * 60 * 24 * 365
API_KEY_IDENTITY_HEADER = "X-iFrame-API-Key-Identity"
API_KEY_IDENTITY_MAX_LENGTH = 64
SESSION_TOKEN_PREFIX = "iframe-session."
SESSION_TOKEN_MAX_TTL = 3600
SESSION_TOKEN_MIN_TTL = 60


class UniArtIdentityClient:
    def __init__(self, base_url: str | None = None, timeout: int = 20):
        self.base_url = (
            base_url
            or os.getenv("LUMENX_IDENTITY_BASE_URL")
            or "https://canvas.uniart.fun"
        ).rstrip("/")
        self.timeout = timeout

    def login(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", "/api/auth/login", json=payload)

    def me(self, token: str) -> Dict[str, Any]:
        return self._request("GET", "/api/auth/me", token=token)

    def logout(self, token: str) -> None:
        self._request("POST", "/api/auth/logout", token=token, allow_empty=True)

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json: Dict[str, Any] | None = None,
        allow_empty: bool = False,
    ) -> Dict[str, Any]:
        headers: Dict[str, str] = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = requests.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                json=json,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=503, detail="Identity service unavailable") from exc
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        if not response.ok:
            detail = "Identity service request failed"
            try:
                payload = response.json()
                detail = str(payload.get("detail") or payload.get("message") or detail)
            except ValueError:
                pass
            raise HTTPException(status_code=502, detail=detail)
        if allow_empty and not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Identity service returned invalid JSON") from exc


def _extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


def _context_from_payload(payload: Dict[str, Any], token: str) -> UserContext:
    user = payload.get("user") or {}
    profile = payload.get("profile") or {}
    user_id = str(user.get("user_id") or "").strip()
    profile_id = str(profile.get("profile_id") or "").strip()
    if not user_id or not profile_id:
        raise HTTPException(status_code=502, detail="Identity response has no owner scope")
    return UserContext(
        user_id=user_id,
        owner_profile_id=profile_id,
        display_name=str(profile.get("display_name") or user.get("login_name") or "User"),
        access_token=token,
    )


def _browser_context(profile_id: str) -> UserContext:
    normalized = profile_id.strip()
    return UserContext(
        user_id=f"browser-{normalized}",
        owner_profile_id=f"browser-{normalized}",
        display_name="本地浏览器用户",
        access_token="",
    )


def _new_browser_context() -> UserContext:
    return _browser_context(secrets.token_urlsafe(32))


def _api_key_context(identity_key: str | None) -> UserContext | None:
    """Resolve the stable owner derived from a provider-key fingerprint."""
    normalized = (identity_key or "").strip().lower()
    if not normalized or len(normalized) > API_KEY_IDENTITY_MAX_LENGTH:
        return None
    if not re.fullmatch(r"[0-9a-f]{64}", normalized):
        return None
    return UserContext(
        user_id=f"apikey-{normalized}",
        owner_profile_id=f"apikey-{normalized}",
        display_name="API key workspace",
        access_token="",
    )


def _session_token_secret() -> bytes:
    # A configured server secret is required in production. The config master
    # key is an acceptable shared secret for installations that already use it.
    value = os.getenv("LUMENX_SESSION_TOKEN_SECRET") or os.getenv("LUMENX_CONFIG_MASTER_KEY")
    if not value:
        raise HTTPException(status_code=503, detail="Session token signing is not configured")
    return value.encode("utf-8")


def _b64_json(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode_b64_json(value: str) -> dict[str, Any]:
    try:
        padded = value + "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        raise HTTPException(status_code=401, detail="Invalid session token")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=401, detail="Invalid session token")
    return payload


def create_session_token(api_key: str, ttl_seconds: int = 3600) -> tuple[str, UserContext, int]:
    normalized_key = api_key.strip()
    if not normalized_key:
        raise HTTPException(status_code=400, detail="API key is required")
    ttl = max(SESSION_TOKEN_MIN_TTL, min(int(ttl_seconds), SESSION_TOKEN_MAX_TTL))
    fingerprint = hashlib.sha256(normalized_key.encode("utf-8")).hexdigest()
    issued_at = int(time.time())
    payload = {"v": 1, "owner": fingerprint, "iat": issued_at, "exp": issued_at + ttl, "jti": secrets.token_urlsafe(12)}
    body = _b64_json(payload)
    signature = hmac.new(_session_token_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    identity = _api_key_context(fingerprint)
    assert identity is not None
    return f"{SESSION_TOKEN_PREFIX}{body}.{signature}", identity, payload["exp"]


def _context_from_session_token(token: str) -> UserContext:
    encoded = token.removeprefix(SESSION_TOKEN_PREFIX)
    if "." not in encoded:
        raise HTTPException(status_code=401, detail="Invalid session token")
    body, signature = encoded.rsplit(".", 1)
    expected = hmac.new(_session_token_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid session token")
    payload = _decode_b64_json(body)
    owner = payload.get("owner")
    expires = payload.get("exp")
    if payload.get("v") != 1 or not isinstance(owner, str) or not isinstance(expires, int) or expires <= int(time.time()):
        raise HTTPException(status_code=401, detail="Session token expired")
    identity = _api_key_context(owner)
    if identity is None:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return identity


def _resolve_request_context(
    authorization: str | None,
    browser_profile: str | None,
    api_key_identity: str | None = None,
) -> tuple[UserContext, bool]:
    if authorization:
        token = _extract_bearer(authorization)
        if token.startswith(SESSION_TOKEN_PREFIX):
            return _context_from_session_token(token), False
        payload = UniArtIdentityClient().me(token)
        return _context_from_payload(payload, token), False
    key_context = _api_key_context(api_key_identity)
    if key_context is not None:
        return key_context, True
    if browser_profile:
        if browser_profile.startswith("apikey-"):
            key_context = _api_key_context(browser_profile.removeprefix("apikey-"))
            if key_context is not None:
                return key_context, False
        return _browser_context(browser_profile), False
    return _new_browser_context(), True


def _set_browser_profile_cookie(response: Response, request: Request, identity: UserContext) -> None:
    profile_id = identity.owner_profile_id.removeprefix("browser-")
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
    secure = (forwarded_proto or request.url.scheme).lower() == "https"
    # HTTPS deployments may be reached through more than one UniArt host
    # (for example garage.uniart.fun and arcreel.uniart.fun). Remove the
    # legacy host-only cookie before writing one shared cookie so a stale
    # browser identity cannot win when duplicate cookies are sent.
    host = request.headers.get("host", "").split(":", 1)[0].lower()
    shared_domain = ".uniart.fun" if host.endswith(".uniart.fun") else None
    if shared_domain:
        response.delete_cookie(BROWSER_PROFILE_COOKIE, path="/")
    response.set_cookie(
        BROWSER_PROFILE_COOKIE,
        profile_id,
        max_age=BROWSER_PROFILE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
        domain=shared_domain,
    )


def require_user_context(
    request: Request,
    response: Response,
    authorization: str | None = Header(default=None),
    browser_profile: str | None = Cookie(default=None, alias=BROWSER_PROFILE_COOKIE),
    api_key_identity: str | None = Header(default=None, alias=API_KEY_IDENTITY_HEADER),
) -> UserContext:
    existing = getattr(request.state, "lumenx_identity", None)
    if existing is not None:
        return existing
    identity, should_set_cookie = _resolve_request_context(
        authorization, browser_profile, api_key_identity
    )
    request.state.lumenx_identity = identity
    if should_set_cookie:
        _set_browser_profile_cookie(response, request, identity)
    return identity


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(request: LoginRequest):
    return UniArtIdentityClient().login(request.model_dump())


@router.post("/session-token")
def session_token(request: SessionTokenRequest):
    token, identity, expires_at = create_session_token(request.api_key, request.ttl_seconds)
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_at": expires_at,
        "owner_profile_id": identity.owner_profile_id,
        "auth_mode": "api_key_session",
    }


@router.get("/me")
def me(
    request: Request,
    response: Response,
    authorization: str | None = Header(default=None),
    browser_profile: str | None = Cookie(default=None, alias=BROWSER_PROFILE_COOKIE),
    api_key_identity: str | None = Header(default=None, alias=API_KEY_IDENTITY_HEADER),
):
    identity, should_set_cookie = _resolve_request_context(
        authorization, browser_profile, api_key_identity
    )
    if should_set_cookie:
        _set_browser_profile_cookie(response, request, identity)
    return {
        "user": {"user_id": identity.user_id, "login_name": None},
        "profile": {
            "profile_id": identity.owner_profile_id,
            "owner_user_id": identity.user_id,
            "display_name": identity.display_name,
        },
        "auth_mode": "bearer" if identity.access_token else "browser",
    }


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    UniArtIdentityClient().logout(token)
    return None
