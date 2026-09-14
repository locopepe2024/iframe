"""Owner-scoped LumenX preferences and encrypted provider credentials."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Dict

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .identity import UserContext, require_user_context


SECRET_FIELDS = {"UNIART_API_KEY"}


class UserConfigUpdate(BaseModel):
    UNIART_API_KEY: str | None = None
    UNIART_BASE_URL: str | None = None
    preferences: Dict[str, Any] = Field(default_factory=dict)


class UserConfigStore:
    def __init__(self, db_path: str | None = None, master_key: str | None = None):
        self.db_path = db_path or os.getenv("LUMENX_USER_DB_PATH") or "output/lumenx_users.db"
        self.master_key = master_key if master_key is not None else os.getenv("LUMENX_CONFIG_MASTER_KEY")
        self._lock = threading.RLock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_configs (
                    owner_profile_id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL,
                    config_json TEXT NOT NULL DEFAULT '{}',
                    secrets_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _encryption_key(self) -> bytes:
        if not self.master_key:
            raise HTTPException(status_code=503, detail="LUMENX_CONFIG_MASTER_KEY is not configured")
        return hashlib.sha256(self.master_key.encode("utf-8")).digest()

    def _encrypt(self, value: str) -> str:
        cipher = AES.new(self._encryption_key(), AES.MODE_GCM, nonce=get_random_bytes(12))
        ciphertext, tag = cipher.encrypt_and_digest(value.encode("utf-8"))
        return json.dumps(
            {
                "nonce": cipher.nonce.hex(),
                "ciphertext": ciphertext.hex(),
                "tag": tag.hex(),
            },
            separators=(",", ":"),
        )

    def _decrypt(self, value: str) -> str:
        payload = json.loads(value)
        cipher = AES.new(
            self._encryption_key(),
            AES.MODE_GCM,
            nonce=bytes.fromhex(payload["nonce"]),
        )
        plaintext = cipher.decrypt_and_verify(
            bytes.fromhex(payload["ciphertext"]),
            bytes.fromhex(payload["tag"]),
        )
        return plaintext.decode("utf-8")

    def _row(self, owner_profile_id: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM user_configs WHERE owner_profile_id = ?",
                (owner_profile_id,),
            ).fetchone()

    def get_public(self, identity: UserContext) -> Dict[str, Any]:
        row = self._row(identity.owner_profile_id)
        config = json.loads(row["config_json"]) if row else {}
        secret_payload = json.loads(row["secrets_json"]) if row else {}
        return {
            **config,
            "secrets_configured": {
                field: bool(secret_payload.get(field)) for field in SECRET_FIELDS
            },
            "secret_prefixes": {
                field: str(secret_payload.get(field, {}).get("prefix") or "")
                for field in SECRET_FIELDS
            },
        }

    def update(self, identity: UserContext, update: UserConfigUpdate) -> Dict[str, Any]:
        row = self._row(identity.owner_profile_id)
        config = json.loads(row["config_json"]) if row else {}
        secret_payload = json.loads(row["secrets_json"]) if row else {}
        if update.UNIART_BASE_URL is not None:
            value = update.UNIART_BASE_URL.strip().rstrip("/")
            if value and not value.startswith(("https://", "http://")):
                raise HTTPException(status_code=422, detail="UNIART_BASE_URL must be an HTTP URL")
            config["UNIART_BASE_URL"] = value
        if update.preferences:
            config["preferences"] = {**config.get("preferences", {}), **update.preferences}
        if update.UNIART_API_KEY is not None:
            secret = update.UNIART_API_KEY.strip()
            if secret:
                encrypted = self._encrypt(secret)
                secret_payload["UNIART_API_KEY"] = {
                    "ciphertext": encrypted,
                    "prefix": secret[:12],
                }
            else:
                secret_payload.pop("UNIART_API_KEY", None)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_configs (
                    owner_profile_id, owner_user_id, config_json, secrets_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_profile_id) DO UPDATE SET
                    owner_user_id = excluded.owner_user_id,
                    config_json = excluded.config_json,
                    secrets_json = excluded.secrets_json,
                    updated_at = excluded.updated_at
                """,
                (
                    identity.owner_profile_id,
                    identity.user_id,
                    json.dumps(config, ensure_ascii=False),
                    json.dumps(secret_payload),
                    row["created_at"] if row else now,
                    now,
                ),
            )
        return self.get_public(identity)

    def get_runtime_uniart(self, identity: UserContext) -> Dict[str, str]:
        row = self._row(identity.owner_profile_id)
        config = json.loads(row["config_json"]) if row else {}
        secret_payload = json.loads(row["secrets_json"]) if row else {}
        entry = secret_payload.get("UNIART_API_KEY") or {}
        ciphertext = entry.get("ciphertext")
        if ciphertext:
            try:
                key = self._decrypt(ciphertext)
            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                raise HTTPException(status_code=503, detail="Stored UniArt credential cannot be decrypted") from exc
            return {
                "api_key": key,
                "base_url": config.get("UNIART_BASE_URL") or "https://uniart.fun/v1",
            }
        if os.getenv("LUMENX_ALLOW_SHARED_PROVIDER_CREDENTIALS", "false").lower() == "true":
            key = os.getenv("UNIART_API_KEY") or os.getenv("OPENAI_API_KEY")
            if key:
                return {
                    "api_key": key,
                    "base_url": os.getenv("UNIART_BASE_URL")
                    or os.getenv("OPENAI_BASE_URL")
                    or "https://uniart.fun/v1",
                }
        raise HTTPException(status_code=409, detail="UniArt API key is not configured for this user")


_store: UserConfigStore | None = None


def get_user_config_store() -> UserConfigStore:
    global _store
    if _store is None:
        _store = UserConfigStore()
    return _store


router = APIRouter(prefix="/user", tags=["user-config"])


@router.get("/config")
def get_user_config(identity: UserContext = Depends(require_user_context)):
    return get_user_config_store().get_public(identity)


@router.put("/config")
def update_user_config(
    update: UserConfigUpdate,
    identity: UserContext = Depends(require_user_context),
):
    return get_user_config_store().update(identity, update)
