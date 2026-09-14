"""Request-local Studio ownership boundary.

Identity remains owned by UniArt. This module only carries the authenticated
owner through LumenX Studio request handling and provides fail-closed resource
checks for process-wide legacy stores.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
import hashlib
import hmac
import os
import shutil
import time
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import quote

from fastapi import HTTPException

from .identity import UserContext


_studio_user: ContextVar[Optional[UserContext]] = ContextVar(
    "lumenx_studio_user", default=None
)
_studio_uniart: ContextVar[Optional[Dict[str, str]]] = ContextVar(
    "lumenx_studio_uniart", default=None
)


def set_studio_user(user: UserContext) -> Token:
    return _studio_user.set(user)


def reset_studio_user(token: Token) -> None:
    _studio_user.reset(token)


def set_studio_uniart_config(config: Dict[str, str]) -> Token:
    return _studio_uniart.set(dict(config))


def reset_studio_uniart_config(token: Token) -> None:
    _studio_uniart.reset(token)


def current_studio_user() -> Optional[UserContext]:
    return _studio_user.get()


def require_studio_user() -> UserContext:
    user = current_studio_user()
    if not user:
        raise HTTPException(status_code=401, detail="Missing authenticated Studio context")
    return user


def runtime_uniart_for_owner(owner_user_id: str, owner_profile_id: str) -> Dict[str, str]:
    from .user_config import get_user_config_store

    identity = UserContext(
        user_id=owner_user_id,
        owner_profile_id=owner_profile_id,
        display_name=owner_user_id,
        access_token="",
    )
    return get_user_config_store().get_runtime_uniart(identity)


def studio_uniart_config() -> Dict[str, str]:
    configured = _studio_uniart.get()
    if configured:
        return dict(configured)
    user = require_studio_user()
    return runtime_uniart_for_owner(user.user_id, user.owner_profile_id)


def studio_owner_key(owner_profile_id: str) -> str:
    return hashlib.sha256(owner_profile_id.encode("utf-8")).hexdigest()[:24]


def studio_owner_dir(owner_profile_id: str) -> str:
    return os.path.join("output", "users", studio_owner_key(owner_profile_id), "studio")


def _studio_media_secret() -> str:
    secret = os.getenv("LUMENX_MEDIA_SIGNING_KEY") or os.getenv("LUMENX_CONFIG_MASTER_KEY")
    if not secret:
        raise HTTPException(status_code=503, detail="LUMENX_MEDIA_SIGNING_KEY is not configured")
    return secret


def _studio_media_signature(owner_key: str, relative_path: str, expires: int) -> str:
    message = f"{owner_key}:{relative_path}:{expires}".encode("utf-8")
    return hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()


def studio_media_url(owner_profile_id: str, stored_path: str, ttl_seconds: int = 3600) -> str:
    owner_key = studio_owner_key(owner_profile_id)
    normalized = stored_path.replace("\\", "/").lstrip("/")
    prefix = f"users/{owner_key}/studio/"
    if not normalized.startswith(prefix):
        return stored_path
    relative_path = normalized[len(prefix):]
    expires = int(time.time()) + ttl_seconds
    signature = _studio_media_signature(owner_key, relative_path, expires)
    return (
        f"/studio/media/{owner_key}/{quote(relative_path)}"
        f"?expires={expires}&signature={signature}"
    )


def verify_studio_media(owner_key: str, relative_path: str, expires: int, signature: str) -> str:
    if len(owner_key) != 24 or any(char not in "0123456789abcdef" for char in owner_key):
        raise HTTPException(status_code=404, detail="Media not found")
    if expires < int(time.time()):
        raise HTTPException(status_code=401, detail="Media URL expired")
    normalized = relative_path.replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise HTTPException(status_code=404, detail="Media not found")
    expected = _studio_media_signature(owner_key, normalized, expires)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid media signature")
    root = os.path.realpath(os.path.join("output", "users", owner_key, "studio"))
    candidate = os.path.realpath(os.path.join(root, normalized))
    if not candidate.startswith(root + os.sep):
        raise HTTPException(status_code=404, detail="Media not found")
    return candidate


def sign_studio_media_paths(value: Any, owner_profile_id: str) -> Any:
    if isinstance(value, str):
        return studio_media_url(owner_profile_id, value)
    if isinstance(value, list):
        return [sign_studio_media_paths(item, owner_profile_id) for item in value]
    if isinstance(value, dict):
        return {
            key: sign_studio_media_paths(item, owner_profile_id)
            for key, item in value.items()
        }
    return value


def owned_by(resource: Any, owner_profile_id: str) -> bool:
    return bool(
        resource
        and owner_profile_id
        and getattr(resource, "owner_profile_id", None) == owner_profile_id
    )


def verify_studio_resource_path(
    path: str,
    owner_profile_id: str,
    scripts: Mapping[str, Any],
    series_store: Mapping[str, Any],
) -> None:
    """Fail closed for project/series identifiers embedded in Studio URLs."""
    segments = [segment for segment in path.split("/") if segment]
    if len(segments) < 2:
        return

    resource_kind, resource_id = segments[0], segments[1]
    if resource_kind == "projects":
        if not owned_by(scripts.get(resource_id), owner_profile_id):
            raise HTTPException(status_code=404, detail="Script not found")
    elif resource_kind == "series" and resource_id != "import":
        if not owned_by(series_store.get(resource_id), owner_profile_id):
            raise HTTPException(status_code=404, detail="Series not found")


class StudioOwnerMixin:
    """Owner-aware accessors for legacy process-wide Studio stores."""

    @staticmethod
    def _requested_owner_profile_id(owner_profile_id: Optional[str] = None) -> Optional[str]:
        if owner_profile_id:
            return owner_profile_id
        user = current_studio_user()
        return user.owner_profile_id if user else None

    @staticmethod
    def _requested_owner_user_id(owner_user_id: Optional[str] = None) -> Optional[str]:
        if owner_user_id:
            return owner_user_id
        user = current_studio_user()
        return user.user_id if user else None

    def _migrate_legacy_studio_owners(self) -> None:
        legacy_user_id = os.getenv("LUMENX_LEGACY_OWNER_USER_ID", "").strip()
        legacy_profile_id = os.getenv("LUMENX_LEGACY_OWNER_PROFILE_ID", "").strip()
        if not legacy_user_id or not legacy_profile_id:
            return

        projects_changed = False
        for script in self.scripts.values():
            if not script.owner_user_id and not script.owner_profile_id:
                script.owner_user_id = legacy_user_id
                script.owner_profile_id = legacy_profile_id
                projects_changed = True
            if self.stamp_owned_children(script):
                projects_changed = True
            if self._migrate_legacy_media_references(script, legacy_profile_id):
                projects_changed = True

        series_changed = False
        for series in self.series_store.values():
            if not series.owner_user_id and not series.owner_profile_id:
                series.owner_user_id = legacy_user_id
                series.owner_profile_id = legacy_profile_id
                series_changed = True
            if self.stamp_owned_children(series):
                series_changed = True
            if self._migrate_legacy_media_references(series, legacy_profile_id):
                series_changed = True

        if projects_changed:
            self._save_data()
        if series_changed:
            self._save_series_data()

        library_changed = False
        library_store = getattr(self, "library_store", None)
        if library_store:
            for collection_name in ("characters", "scenes", "props"):
                for asset in getattr(library_store, collection_name, []):
                    if not asset.owner_user_id and not asset.owner_profile_id:
                        asset.owner_user_id = legacy_user_id
                        asset.owner_profile_id = legacy_profile_id
                        library_changed = True
                    if self._migrate_legacy_media_references(asset, legacy_profile_id):
                        library_changed = True
        if library_changed:
            self._save_library_data()

    @classmethod
    def _migrate_legacy_media_references(cls, value: Any, owner_profile_id: str) -> bool:
        legacy_prefixes = (
            "assets/",
            "audio/",
            "cache/",
            "export/",
            "outputs/",
            "storyboard/",
            "uploads/",
            "video/",
            "videos/",
            "video_inputs/",
        )
        changed = False

        if isinstance(value, list):
            for index, item in enumerate(value):
                if isinstance(item, str):
                    normalized = item.replace("\\", "/").lstrip("/")
                    if normalized.startswith(legacy_prefixes):
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id)
                        if migrated:
                            value[index] = migrated
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id):
                    changed = True
            return changed

        if isinstance(value, dict):
            for key, item in list(value.items()):
                if isinstance(item, str):
                    normalized = item.replace("\\", "/").lstrip("/")
                    if normalized.startswith(legacy_prefixes):
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id)
                        if migrated:
                            value[key] = migrated
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id):
                    changed = True
            return changed

        fields = getattr(type(value), "model_fields", None)
        if fields:
            for field_name in fields:
                item = getattr(value, field_name, None)
                if isinstance(item, str):
                    normalized = item.replace("\\", "/").lstrip("/")
                    if normalized.startswith(legacy_prefixes):
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id)
                        if migrated:
                            setattr(value, field_name, migrated)
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id):
                    changed = True
        return changed

    @staticmethod
    def _copy_legacy_media(normalized_path: str, owner_profile_id: str) -> Optional[str]:
        source_root = os.path.realpath("output")
        source = os.path.realpath(os.path.join(source_root, normalized_path))
        if not source.startswith(source_root + os.sep) or not os.path.isfile(source):
            return None
        destination_root = os.path.realpath(
            os.path.join(studio_owner_dir(owner_profile_id), "legacy")
        )
        destination = os.path.realpath(os.path.join(destination_root, normalized_path))
        if not destination.startswith(destination_root + os.sep):
            return None
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        if not os.path.exists(destination):
            try:
                os.link(source, destination)
            except OSError:
                shutil.copy2(source, destination)
        return os.path.relpath(destination, "output")

    @staticmethod
    def stamp_owned_children(container: Any) -> bool:
        owner_user_id = getattr(container, "owner_user_id", None)
        owner_profile_id = getattr(container, "owner_profile_id", None)
        if not owner_user_id or not owner_profile_id:
            return False
        changed = False
        for collection_name in ("characters", "scenes", "props", "frames", "video_tasks"):
            for item in getattr(container, collection_name, []) or []:
                if hasattr(item, "owner_user_id") and not item.owner_user_id:
                    item.owner_user_id = owner_user_id
                    changed = True
                if hasattr(item, "owner_profile_id") and not item.owner_profile_id:
                    item.owner_profile_id = owner_profile_id
                    changed = True
        return changed

    def get_script(self, script_id: str, owner_profile_id: Optional[str] = None) -> Any:
        script = self.scripts.get(script_id)
        requested_owner = self._requested_owner_profile_id(owner_profile_id)
        if requested_owner and not owned_by(script, requested_owner):
            return None
        return script

    def list_scripts(self, owner_profile_id: str) -> List[Any]:
        return [script for script in self.scripts.values() if owned_by(script, owner_profile_id)]

    def get_series(self, series_id: str, owner_profile_id: Optional[str] = None) -> Any:
        series = self.series_store.get(series_id)
        requested_owner = self._requested_owner_profile_id(owner_profile_id)
        if requested_owner and not owned_by(series, requested_owner):
            return None
        return series

    def list_series(self, owner_profile_id: Optional[str] = None) -> List[Any]:
        requested_owner = self._requested_owner_profile_id(owner_profile_id)
        if not requested_owner:
            return list(self.series_store.values())
        return [series for series in self.series_store.values() if owned_by(series, requested_owner)]
