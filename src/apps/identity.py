"""UniArt-backed identity boundary for multi-user LumenX APIs."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict

import requests
from fastapi import APIRouter, Header, HTTPException
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


def require_user_context(authorization: str | None = Header(default=None)) -> UserContext:
    token = _extract_bearer(authorization)
    payload = UniArtIdentityClient().me(token)
    return _context_from_payload(payload, token)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(request: LoginRequest):
    return UniArtIdentityClient().login(request.model_dump())


@router.get("/me")
def me(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    payload = UniArtIdentityClient().me(token)
    _context_from_payload(payload, token)
    return payload


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    UniArtIdentityClient().logout(token)
    return None
