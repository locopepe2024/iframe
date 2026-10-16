"""Request-local Studio ownership boundary.

Identity remains owned by UniArt. This module only carries the authenticated
owner through iFrame Studio request handling and provides fail-closed resource
checks for process-wide legacy stores.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
import hashlib
import hmac
import logging
import os
import shutil
import time
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import quote, urlsplit, parse_qs, unquote

from fastapi import HTTPException

from .identity import UserContext
from ..utils.managed_media_root import ManagedMediaRoot


_studio_user: ContextVar[Optional[UserContext]] = ContextVar(
    "iframe_studio_user", default=None
)
_studio_uniart: ContextVar[Optional[Dict[str, str]]] = ContextVar(
    "iframe_studio_uniart", default=None
)
STUDIO_MEDIA_PREVIEW_SIZES = frozenset({160, 320, 512, 960})
logger = logging.getLogger(__name__)


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


def studio_nsfw_new_one_config() -> Dict[str, str]:
    user = require_studio_user()
    return runtime_nsfw_for_owner(user.user_id, user.owner_profile_id)


def runtime_nsfw_for_owner(owner_user_id: str, owner_profile_id: str) -> Dict[str, str]:
    from .user_config import get_user_config_store
    identity = UserContext(owner_user_id, owner_profile_id, owner_user_id, "")
    return get_user_config_store().get_runtime_nsfw(identity)


def studio_owner_key(owner_profile_id: str) -> str:
    return hashlib.sha256(owner_profile_id.encode("utf-8")).hexdigest()[:24]


def studio_owner_dir(owner_profile_id: str, *, output_root: str = "output") -> str:
    path = os.path.join(output_root, "users", studio_owner_key(owner_profile_id), "studio")
    ManagedMediaRoot(output_root).resolve(os.path.abspath(path))
    return path


STUDIO_MEDIA_CATEGORIES = frozenset({
    "assets", "audio", "storyboard", "uploads", "video", "video_inputs",
})


def studio_media_dir(owner_profile_id: str, category: str, *, output_root: str = "output") -> str:
    """Resolve an authenticated Studio material category under its owner."""
    if not owner_profile_id:
        raise ValueError("Studio media write requires an owner profile")
    if category not in STUDIO_MEDIA_CATEGORIES:
        raise ValueError(f"Unsupported Studio media category: {category}")
    path = os.path.join(studio_owner_dir(owner_profile_id, output_root=output_root), category)
    ManagedMediaRoot(output_root).resolve(os.path.abspath(path))
    return path


def _studio_media_secret() -> str:
    secret = os.getenv("LUMENX_MEDIA_SIGNING_KEY") or os.getenv("LUMENX_CONFIG_MASTER_KEY")
    if not secret:
        raise HTTPException(status_code=503, detail="LUMENX_MEDIA_SIGNING_KEY is not configured")
    return secret


def _studio_media_signature(owner_key: str, relative_path: str, expires: int) -> str:
    message = f"{owner_key}:{relative_path}:{expires}".encode("utf-8")
    return hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()


def signed_provider_media_url(path: str, ttl_seconds: int | None = None, *, output_root: str = "output") -> str:
    """Expose a managed local media file to an upstream provider briefly."""
    from ..utils.provider_media_config import provider_media_origin, provider_media_ttl_seconds
    base = provider_media_origin()
    if base is None:
        raise ValueError("PROVIDER_MEDIA_PUBLIC_BASE_URL must be configured (legacy: UNIART_MEDIA_BASE_URL)")
    if ttl_seconds is None:
        ttl_seconds = provider_media_ttl_seconds()
    root = os.path.realpath(os.path.join(output_root, "users"))
    try:
        locator = os.path.abspath(path) if path.startswith(str(output_root) + os.sep) else path
        candidate = str(ManagedMediaRoot(output_root).resolve(locator))
    except ValueError as exc:
        raise ValueError("Provider media must be an existing owner-scoped file") from exc
    if not candidate.startswith(root + os.sep) or not os.path.isfile(candidate):
        raise ValueError("Provider media must be an existing owner-scoped file")
    relative = os.path.relpath(candidate, root).replace(os.sep, "/")
    owner_key, separator, owner_path = relative.partition("/")
    if (not separator or len(owner_key) != 24 or any(c not in "0123456789abcdef" for c in owner_key)
            or not owner_path.startswith(("studio/", "playground/", "assets/"))
            or os.path.splitext(owner_path)[1].lower() not in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".mkv", ".mp3", ".wav", ".m4a"}):
        raise ValueError("Provider media is outside the managed media directories")
    expires = int(time.time()) + ttl_seconds
    message = f"provider:{owner_key}:{owner_path}:{expires}".encode("utf-8")
    signature = hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"{base}/provider/media/{owner_key}/{quote(owner_path)}?expires={expires}&signature={signature}"


def verify_provider_media(owner_key: str, relative_path: str, expires: int, signature: str, *, output_root: str = "output") -> str:
    if expires < int(time.time()) or not signature:
        raise HTTPException(status_code=401, detail="Media URL expired or unsigned")
    if len(owner_key) != 24 or any(c not in "0123456789abcdef" for c in owner_key):
        raise HTTPException(status_code=404, detail="Media not found")
    root = os.path.realpath(os.path.join(output_root, "users", owner_key))
    candidate = os.path.realpath(os.path.join(root, relative_path))
    try:
        ManagedMediaRoot(output_root).resolve(candidate)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if not candidate.startswith(root + os.sep) or not os.path.isfile(candidate):
        raise HTTPException(status_code=404, detail="Media not found")
    owner_path = os.path.relpath(candidate, root).replace(os.sep, "/")
    if (not owner_path.startswith(("studio/", "playground/", "assets/"))
            or os.path.splitext(owner_path)[1].lower() not in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".mkv", ".mp3", ".wav", ".m4a"}):
        raise HTTPException(status_code=404, detail="Media not found")
    message = f"provider:{owner_key}:{owner_path}:{expires}".encode("utf-8")
    expected = hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid media signature")
    return candidate


def studio_media_url(owner_profile_id: str, stored_path: str, ttl_seconds: int = 3600, *, output_root: str = "output") -> str:
    owner_key = studio_owner_key(owner_profile_id)
    # Older workbench saves persisted a signed projection rather than a key.
    # Revalidate its owner and HMAC before issuing a fresh display URL.
    if stored_path.startswith("/studio/media/") or (
        stored_path.startswith(("http://", "https://")) and "/studio/media/" in stored_path
    ):
        try:
            stored_path = resolve_studio_reference(stored_path, owner_profile_id, output_root=output_root)
        except ValueError:
            return stored_path
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


def studio_media_preview_url(
    owner_profile_id: str,
    stored_path: str,
    max_edge: int = 320,
    ttl_seconds: int = 3600,
) -> str:
    """Sign an owner-scoped image preview request at a bounded size."""
    if max_edge not in STUDIO_MEDIA_PREVIEW_SIZES:
        raise ValueError("Unsupported Studio media preview size")
    owner_key = studio_owner_key(owner_profile_id)
    normalized = stored_path.replace("\\", "/").lstrip("/")
    prefix = f"users/{owner_key}/studio/"
    if not normalized.startswith(prefix):
        return stored_path
    relative_path = normalized[len(prefix):]
    if not relative_path:
        return stored_path
    expires = int(time.time()) + ttl_seconds
    message = f"{owner_key}:{relative_path}:{expires}:preview:{max_edge}".encode("utf-8")
    signature = hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()
    return (
        f"/studio/media/{owner_key}/{quote(relative_path)}"
        f"?preview={max_edge}&expires={expires}&signature={signature}"
    )


def _local_studio_path_for_object_key(
    stored_path: str,
    owner_profile_id: str,
    *, output_root: str = "output",
) -> str:
    """Map a legacy object key to the owner's local Studio copy when present.

    Older asset records keep the COS key (usually ``lumenx/assets/...``) even
    when generation also retained the file in the owner-scoped Studio tree.
    In local-only deployments there is no object-storage signer to turn that
    key into a browser URL.  Resolve only the configured object-key prefixes
    and only inside the authenticated owner's directory; otherwise preserve
    the original value for the COS signer or other URL handling.
    """
    normalized = stored_path.replace("\\", "/").lstrip("/")
    prefixes = {
        value.strip().strip("/ ")
        for value in (
            os.getenv("LUMENX_COS_KEY_PREFIX", "lumenx"),
            os.getenv("OSS_BASE_PATH", "lumenx"),
        )
        if value and value.strip().strip("/ ")
    }
    prefix = next(
        (candidate for candidate in prefixes if normalized.startswith(f"{candidate}/")),
        None,
    )
    if not prefix:
        return stored_path

    relative = normalized[len(prefix) + 1 :]
    owner_root = os.path.realpath(studio_owner_dir(owner_profile_id, output_root=output_root))
    candidate = os.path.realpath(os.path.join(owner_root, relative))
    if not candidate.startswith(owner_root + os.sep) or not os.path.isfile(candidate):
        return stored_path
    return os.path.relpath(candidate, output_root)


def verify_studio_media(
    owner_key: str,
    relative_path: str,
    expires: int,
    signature: str,
    *,
    allow_expired: bool = False,
    output_root: str = "output",
) -> str:
    if len(owner_key) != 24 or any(char not in "0123456789abcdef" for char in owner_key):
        raise HTTPException(status_code=404, detail="Media not found")
    if not allow_expired and expires < int(time.time()):
        raise HTTPException(status_code=401, detail="Media URL expired")
    normalized = relative_path.replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise HTTPException(status_code=404, detail="Media not found")
    expected = _studio_media_signature(owner_key, normalized, expires)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid media signature")
    root = os.path.realpath(os.path.join(output_root, "users", owner_key, "studio"))
    candidate = os.path.realpath(os.path.join(root, normalized))
    try:
        ManagedMediaRoot(output_root).resolve(candidate)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if not candidate.startswith(root + os.sep):
        raise HTTPException(status_code=404, detail="Media not found")
    return candidate


def verify_studio_media_preview(
    owner_key: str,
    relative_path: str,
    max_edge: int,
    expires: int,
    signature: str,
    *, output_root: str = "output",
) -> str:
    if max_edge not in STUDIO_MEDIA_PREVIEW_SIZES:
        raise HTTPException(status_code=404, detail="Media not found")
    if len(owner_key) != 24 or any(char not in "0123456789abcdef" for char in owner_key):
        raise HTTPException(status_code=404, detail="Media not found")
    if expires < int(time.time()):
        raise HTTPException(status_code=401, detail="Media URL expired")
    normalized = relative_path.replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise HTTPException(status_code=404, detail="Media not found")
    message = f"{owner_key}:{normalized}:{expires}:preview:{max_edge}".encode("utf-8")
    expected = hmac.new(_studio_media_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid media signature")
    root = os.path.realpath(os.path.join(output_root, "users", owner_key, "studio"))
    candidate = os.path.realpath(os.path.join(root, normalized))
    try:
        ManagedMediaRoot(output_root).resolve(candidate)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if not candidate.startswith(root + os.sep):
        raise HTTPException(status_code=404, detail="Media not found")
    return candidate


def resolve_studio_reference(value: str, owner_profile_id: str, *, output_root: str = "output") -> str:
    """Resolve a submitted reference before any local file can reach a provider."""
    if not owner_profile_id:
        raise ValueError("Media reference requires an authenticated owner")
    parsed = urlsplit(value)
    path = unquote(parsed.path)
    owner_key = studio_owner_key(owner_profile_id)
    if path.startswith("/studio/media/"):
        parts = path.removeprefix("/studio/media/").split("/", 1)
        if len(parts) != 2 or parts[0] != owner_key:
            raise ValueError("Media reference belongs to another owner")
        query = parse_qs(parsed.query)
        try:
            # Browser URLs are short-lived, but an authenticated Studio user can
            # keep an editor tab open past their expiry. Re-resolve the original
            # signature here (still enforcing owner and HMAC checks) so polish
            # can read the owner's existing local source file. Direct browser
            # access continues to enforce URL expiry.
            candidate = verify_studio_media(
                parts[0],
                parts[1],
                int(query["expires"][0]),
                query["signature"][0],
                allow_expired=True,
                output_root=output_root,
            )
        except (KeyError, ValueError, HTTPException) as exc:
            raise ValueError("Invalid or expired Studio media reference") from exc
    elif path.startswith(("/studio/owned-media/", "/studio/owned-playground-media/")):
        playground = path.startswith("/studio/owned-playground-media/")
        prefix = "/studio/owned-playground-media/" if playground else "/studio/owned-media/"
        parts = path.removeprefix(prefix).split("/", 1)
        if len(parts) != 2 or parts[0] != owner_key:
            raise ValueError("Media reference belongs to another owner")
        root = os.path.realpath(os.path.join(output_root, "users", owner_key, "playground" if playground else "studio"))
        candidate = os.path.realpath(os.path.join(root, parts[1]))
        if not candidate.startswith(root + os.sep):
            raise ValueError("Invalid Studio media reference")
    elif path.startswith("/files/"):
        # Studio's compatibility media URLs are rooted at output/. Only
        # owner-local Studio paths are accepted for vision polishing below.
        relative = path.removeprefix("/files/")
        if relative.startswith("output/"):
            relative = relative.removeprefix("output/")
        candidate = os.path.realpath(os.path.join(output_root, relative))
    elif parsed.scheme in ("http", "https") and parsed.netloc and not parsed.username and not parsed.password:
        return value
    elif parsed.scheme or parsed.netloc:
        raise ValueError("Unsupported media reference")
    else:
        try:
            locator = os.path.abspath(value) if value.startswith(str(output_root) + os.sep) else value
            candidate = str(ManagedMediaRoot(output_root).resolve(locator))
        except ValueError as exc:
            raise ValueError("Media reference belongs to another owner") from exc
    root = os.path.realpath(os.path.join(output_root, "users", owner_key))
    if not candidate.startswith(root + os.sep):
        raise ValueError("Media reference belongs to another owner")
    ManagedMediaRoot(output_root).resolve(candidate)
    if not os.path.isfile(candidate):
        raise ValueError("Media reference file not found")
    return os.path.relpath(candidate, output_root)


def sign_studio_media_paths(value: Any, owner_profile_id: str, *, output_root: str = "output") -> Any:
    if isinstance(value, str):
        local_path = _local_studio_path_for_object_key(value, owner_profile_id, output_root=output_root)
        return studio_media_url(owner_profile_id, local_path, output_root=output_root)
    if isinstance(value, list):
        return [sign_studio_media_paths(item, owner_profile_id, output_root=output_root) for item in value]
    if isinstance(value, dict):
        return {
            key: item if key == "storage_key" else sign_studio_media_paths(item, owner_profile_id, output_root=output_root)
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

    output_root = "output"  # Immutable default for legacy mixin consumers.

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
            if self._migrate_legacy_media_references(script, legacy_profile_id, output_root=self.output_root):
                projects_changed = True

        series_changed = False
        for series in self.series_store.values():
            if not series.owner_user_id and not series.owner_profile_id:
                series.owner_user_id = legacy_user_id
                series.owner_profile_id = legacy_profile_id
                series_changed = True
            if self.stamp_owned_children(series):
                series_changed = True
            if self._migrate_legacy_media_references(series, legacy_profile_id, output_root=self.output_root):
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
                    if self._migrate_legacy_media_references(asset, legacy_profile_id, output_root=self.output_root):
                        library_changed = True
        if library_changed:
            self._save_library_data()

    @classmethod
    def _migrate_legacy_media_references(cls, value: Any, owner_profile_id: str, *, output_root: str = "output") -> bool:
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
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id, output_root=output_root)
                        if migrated:
                            value[index] = migrated
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id, output_root=output_root):
                    changed = True
            return changed

        if isinstance(value, dict):
            for key, item in list(value.items()):
                if isinstance(item, str):
                    normalized = item.replace("\\", "/").lstrip("/")
                    if normalized.startswith(legacy_prefixes):
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id, output_root=output_root)
                        if migrated:
                            value[key] = migrated
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id, output_root=output_root):
                    changed = True
            return changed

        fields = getattr(type(value), "model_fields", None)
        if fields:
            for field_name in fields:
                item = getattr(value, field_name, None)
                if isinstance(item, str):
                    normalized = item.replace("\\", "/").lstrip("/")
                    if normalized.startswith(legacy_prefixes):
                        migrated = cls._copy_legacy_media(normalized, owner_profile_id, output_root=output_root)
                        if migrated:
                            setattr(value, field_name, migrated)
                            changed = True
                elif cls._migrate_legacy_media_references(item, owner_profile_id, output_root=output_root):
                    changed = True
        return changed

    @staticmethod
    def _copy_legacy_media(normalized_path: str, owner_profile_id: str, *, output_root: str = "output") -> Optional[str]:
        source_root = os.path.realpath(output_root)
        source = os.path.realpath(os.path.join(source_root, normalized_path))
        if not source.startswith(source_root + os.sep) or not os.path.isfile(source):
            return None
        destination_root = os.path.realpath(
            os.path.join(studio_owner_dir(owner_profile_id, output_root=output_root), "legacy")
        )
        destination = os.path.realpath(os.path.join(destination_root, normalized_path))
        if not destination.startswith(destination_root + os.sep):
            return None
        ManagedMediaRoot(output_root).resolve(destination)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        if not os.path.exists(destination):
            try:
                os.link(source, destination)
            except OSError:
                shutil.copy2(source, destination)
        return os.path.relpath(destination, output_root)

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

    def migrate_legacy_browser_owners(
        self,
        owner_user_id: str,
        owner_profile_id: str,
    ) -> bool:
        """Move legacy browser workspaces to the API-key owner."""
        if not owner_user_id or not owner_profile_id:
            return False

        changed = False
        legacy_owner_ids: set[str] = set()

        def reassign_children(container: Any) -> None:
            for collection_name in ("characters", "scenes", "props", "frames", "video_tasks"):
                for item in getattr(container, collection_name, []) or []:
                    if hasattr(item, "owner_user_id"):
                        item.owner_user_id = owner_user_id
                    if hasattr(item, "owner_profile_id"):
                        item.owner_profile_id = owner_profile_id

        for resource in self.scripts.values():
            legacy_owner_profile_id = getattr(resource, "owner_profile_id", None)
            if legacy_owner_profile_id and not legacy_owner_profile_id.startswith("browser-"):
                continue
            if legacy_owner_profile_id:
                legacy_owner_ids.add(legacy_owner_profile_id)
            resource.owner_user_id = owner_user_id
            resource.owner_profile_id = owner_profile_id
            reassign_children(resource)
            changed = True
        for resource in self.series_store.values():
            legacy_owner_profile_id = getattr(resource, "owner_profile_id", None)
            if legacy_owner_profile_id and not legacy_owner_profile_id.startswith("browser-"):
                continue
            if legacy_owner_profile_id:
                legacy_owner_ids.add(legacy_owner_profile_id)
            resource.owner_user_id = owner_user_id
            resource.owner_profile_id = owner_profile_id
            reassign_children(resource)
            changed = True

        if not changed:
            return False

        self._save_data()
        self._save_series_data()

        # Keep the old tree intact so a failed rollout can be rolled back.
        for legacy_owner_profile_id in legacy_owner_ids:
            old_dir = os.path.realpath(studio_owner_dir(legacy_owner_profile_id, output_root=self.output_root))
            new_dir = os.path.realpath(studio_owner_dir(owner_profile_id, output_root=self.output_root))
            if os.path.isdir(old_dir) and old_dir != new_dir:
                try:
                    os.makedirs(new_dir, exist_ok=True)
                    shutil.copytree(old_dir, new_dir, dirs_exist_ok=True)
                except OSError:
                    logger.exception("Failed to copy legacy Studio media during owner migration")
        return True

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
