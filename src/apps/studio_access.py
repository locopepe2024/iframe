"""Request-local Studio ownership boundary.

Identity remains owned by UniArt. This module only carries the authenticated
owner through LumenX Studio request handling and provides fail-closed resource
checks for process-wide legacy stores.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
import os
from typing import Any, List, Mapping, Optional

from fastapi import HTTPException

from .identity import UserContext


_studio_user: ContextVar[Optional[UserContext]] = ContextVar(
    "lumenx_studio_user", default=None
)


def set_studio_user(user: UserContext) -> Token:
    return _studio_user.set(user)


def reset_studio_user(token: Token) -> None:
    _studio_user.reset(token)


def current_studio_user() -> Optional[UserContext]:
    return _studio_user.get()


def require_studio_user() -> UserContext:
    user = current_studio_user()
    if not user:
        raise HTTPException(status_code=401, detail="Missing authenticated Studio context")
    return user


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

        series_changed = False
        for series in self.series_store.values():
            if not series.owner_user_id and not series.owner_profile_id:
                series.owner_user_id = legacy_user_id
                series.owner_profile_id = legacy_profile_id
                series_changed = True

        if projects_changed:
            self._save_data()
        if series_changed:
            self._save_series_data()

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
