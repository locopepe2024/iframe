"""Playground storage layer — JSON-file persistence for generation history and templates."""

import json
import hashlib
import os
import threading
import uuid
from urllib.parse import urlsplit
from datetime import datetime, timezone
from typing import List, Optional

from .models import PlaygroundDraft, PlaygroundGeneration, PlaygroundSession, PlaygroundTemplate
from ...utils import get_logger

logger = get_logger(__name__)


class PlaygroundStorage:
    HISTORY_PATH = "output/playground_history.json"
    TEMPLATES_PATH = "output/playground_templates.json"
    SESSIONS_PATH = "output/playground_sessions.json"

    def __init__(
        self,
        *,
        owner_user_id: str,
        owner_profile_id: str,
        history_path: Optional[str] = None,
        templates_path: Optional[str] = None,
        sessions_path: Optional[str] = None,
    ):
        if not owner_user_id or not owner_profile_id:
            raise ValueError("PlaygroundStorage requires an authenticated owner")
        self.owner_user_id = owner_user_id
        self.owner_profile_id = owner_profile_id
        owner_dir = self._owner_dir(owner_profile_id)
        self.history_path = history_path or os.path.join(owner_dir, "playground_history.json")
        self.templates_path = templates_path or os.path.join(owner_dir, "playground_templates.json")
        self.sessions_path = sessions_path or os.path.join(owner_dir, "playground_sessions.json")
        self.output_dir = os.path.join(owner_dir, "playground")
        self.asset_dir = os.path.join(owner_dir, "assets")
        self._history: List[PlaygroundGeneration] = []
        self._templates: List[PlaygroundTemplate] = []
        self._sessions: List[PlaygroundSession] = []
        self._lock = threading.RLock()
        self._load()

    @staticmethod
    def _owner_dir(owner_profile_id: str) -> str:
        digest = hashlib.sha256(owner_profile_id.encode("utf-8")).hexdigest()[:24]
        return os.path.join("output", "users", digest)

    # ------------------------------------------------------------------
    # Internal persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load both JSON files, creating them if missing."""
        self._history = self._load_file(self.history_path, PlaygroundGeneration)
        self._templates = self._load_file(self.templates_path, PlaygroundTemplate)
        self._sessions = self._load_file(self.sessions_path, PlaygroundSession)
        self._migrate_legacy_history()

    @staticmethod
    def _load_file(path: str, model_cls):
        """Read a JSON array file and parse each element into *model_cls*."""
        if not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return [model_cls.model_validate(item) for item in raw]
        except Exception as e:
            logger.error("Failed to load %s: %s", path, e)
            return []

    def _save_history(self) -> None:
        self._save_file(self.history_path, self._history)

    def _save_templates(self) -> None:
        self._save_file(self.templates_path, self._templates)

    def _save_sessions(self) -> None:
        self._save_file(self.sessions_path, self._sessions)

    def _migrate_legacy_history(self) -> None:
        owner_changed = False
        for session in self._sessions:
            if not session.owner_user_id and not session.owner_profile_id:
                session.owner_user_id = self.owner_user_id
                session.owner_profile_id = self.owner_profile_id
                owner_changed = True
        for generation in self._history:
            if not generation.owner_user_id and not generation.owner_profile_id:
                generation.owner_user_id = self.owner_user_id
                generation.owner_profile_id = self.owner_profile_id
                owner_changed = True
        for template in self._templates:
            if not template.owner_user_id and not template.owner_profile_id:
                template.owner_user_id = self.owner_user_id
                template.owner_profile_id = self.owner_profile_id
                owner_changed = True
        legacy = [generation for generation in self._history if not generation.session_id]
        if not legacy:
            if owner_changed:
                self._save_history()
                self._save_templates()
                self._save_sessions()
            return
        session = self._sessions[0] if self._sessions else self.create_session("历史创作")
        for generation in legacy:
            generation.session_id = session.id
        newest = max(legacy, key=lambda generation: generation.created_at)
        session.draft = PlaygroundDraft(
            mode=newest.mode,
            model_id=newest.model_id,
            prompt=newest.prompt,
            negative_prompt=newest.negative_prompt,
            input_media=list(newest.input_media),
            parameters=dict(newest.parameters),
            batch_size=newest.batch_size,
            parent_generation_id=newest.id,
        )
        session.updated_at = newest.created_at
        self._save_history()
        self._save_sessions()

    def _save_file(self, path: str, items: list) -> None:
        with self._lock:
            try:
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(
                        [item.model_dump() for item in items],
                        f,
                        indent=2,
                        ensure_ascii=False,
                    )
            except Exception as e:
                logger.error("Failed to save %s: %s", path, e)

    # ------------------------------------------------------------------
    # History CRUD
    # ------------------------------------------------------------------

    def add_generation(self, gen: PlaygroundGeneration) -> None:
        """Append a generation record and persist."""
        self._assert_owner(gen.owner_user_id, gen.owner_profile_id)
        self._history.append(gen)
        self._save_history()

    def get_generation(self, gen_id: str) -> Optional[PlaygroundGeneration]:
        """Look up a generation by its id."""
        for gen in self._history:
            if gen.id == gen_id:
                return gen
        return None

    def resolve_media_reference(self, value: str) -> str:
        if value.startswith(("/playground/media/", "/playground/input-media/")):
            value = urlsplit(value).path
        prefix = "/playground/media/"
        if not value.startswith(prefix):
            input_prefix = "/playground/input-media/"
            if value.startswith(input_prefix):
                filename = value.removeprefix(input_prefix)
                if not filename or os.path.basename(filename) != filename:
                    raise ValueError("Invalid playground input media reference")
                path = os.path.join(self.output_dir, "uploads", filename)
                if not os.path.isfile(path):
                    raise FileNotFoundError("Playground input media not found")
                return path
            return value
        parts = value.removeprefix(prefix).split("/")
        if len(parts) != 2:
            raise ValueError("Invalid playground media reference")
        generation = self.get_generation(parts[0])
        if not generation:
            raise FileNotFoundError("Playground media not found")
        output = next((item for item in generation.outputs if item.id == parts[1]), None)
        if not output:
            raise FileNotFoundError("Playground media not found")
        return output.media_path

    def browser_media_reference(self, value: str) -> str:
        if value.startswith(("/playground/media/", "/playground/input-media/")):
            return urlsplit(value).path
        if urlsplit(value).scheme:
            return value
        target = os.path.realpath(value)
        for generation in self._history:
            for output in generation.outputs:
                if os.path.realpath(output.media_path) == target:
                    return f"/playground/media/{generation.id}/{output.id}"
        uploads = os.path.realpath(os.path.join(self.output_dir, "uploads"))
        if os.path.dirname(target) == uploads and os.path.isfile(target):
            return f"/playground/input-media/{os.path.basename(target)}"
        return value

    def list_history(
        self, limit: int = 50, offset: int = 0, session_id: Optional[str] = None
    ) -> List[PlaygroundGeneration]:
        """Return paginated history, newest first."""
        history = self._history if not session_id else [generation for generation in self._history if generation.session_id == session_id]
        ordered = list(reversed(history))
        return ordered[offset : offset + limit]

    def update_generation(self, gen: PlaygroundGeneration) -> None:
        """Replace an existing generation record (matched by id) and persist."""
        self._assert_owner(gen.owner_user_id, gen.owner_profile_id)
        for i, existing in enumerate(self._history):
            if existing.id == gen.id:
                self._history[i] = gen
                self._save_history()
                return
        logger.warning("update_generation: id %s not found", gen.id)

    def delete_generation(self, gen_id: str) -> bool:
        """Remove a generation by id. Returns True if found and deleted."""
        for i, gen in enumerate(self._history):
            if gen.id == gen_id:
                self._history.pop(i)
                self._save_history()
                return True
        return False

    # ------------------------------------------------------------------
    # Session CRUD
    # ------------------------------------------------------------------

    def create_session(self, title: str = "新建创作") -> PlaygroundSession:
        now = datetime.now(timezone.utc).isoformat()
        session = PlaygroundSession(
            id=str(uuid.uuid4()),
            title=title.strip() or "新建创作",
            created_at=now,
            updated_at=now,
            owner_user_id=self.owner_user_id,
            owner_profile_id=self.owner_profile_id,
        )
        self._sessions.append(session)
        self._save_sessions()
        return session

    def list_sessions(self) -> List[PlaygroundSession]:
        return sorted(self._sessions, key=lambda session: session.updated_at, reverse=True)

    def get_session(self, session_id: str) -> Optional[PlaygroundSession]:
        return next((session for session in self._sessions if session.id == session_id), None)

    def update_session(self, session: PlaygroundSession) -> PlaygroundSession:
        with self._lock:
            for index, existing in enumerate(self._sessions):
                if existing.id == session.id:
                    self._sessions[index] = session
                    self._save_sessions()
                    return session
        raise KeyError(session.id)

    def ensure_session(self, session_id: Optional[str] = None, title: str = "新建创作") -> PlaygroundSession:
        if session_id:
            session = self.get_session(session_id)
            if session:
                return session
        sessions = self.list_sessions()
        return sessions[0] if sessions else self.create_session(title)

    def save_session_draft(self, session_id: str, draft: PlaygroundDraft, auto_title: Optional[str] = None) -> PlaygroundSession:
        session = self.get_session(session_id)
        if not session:
            raise KeyError(session_id)
        session.draft = draft
        session.updated_at = datetime.now(timezone.utc).isoformat()
        if auto_title and session.title == "新建创作":
            collapsed = " ".join(auto_title.split())
            session.title = collapsed[:32] or session.title
        return self.update_session(session)

    # ------------------------------------------------------------------
    # Template CRUD
    # ------------------------------------------------------------------

    def add_template(self, template: PlaygroundTemplate) -> None:
        """Append a template record and persist."""
        self._assert_owner(template.owner_user_id, template.owner_profile_id)
        self._templates.append(template)
        self._save_templates()

    def get_template(self, template_id: str) -> Optional[PlaygroundTemplate]:
        """Look up a template by its id."""
        for t in self._templates:
            if t.id == template_id:
                return t
        return None

    def list_templates(self) -> List[PlaygroundTemplate]:
        """Return all templates."""
        return list(self._templates)

    def update_template(self, template: PlaygroundTemplate) -> None:
        """Replace an existing template (matched by id) and persist."""
        self._assert_owner(template.owner_user_id, template.owner_profile_id)
        for i, existing in enumerate(self._templates):
            if existing.id == template.id:
                self._templates[i] = template
                self._save_templates()
                return
        logger.warning("update_template: id %s not found", template.id)

    def delete_template(self, template_id: str) -> bool:
        """Remove a template by id. Returns True if found and deleted."""
        for i, t in enumerate(self._templates):
            if t.id == template_id:
                self._templates.pop(i)
                self._save_templates()
                return True
        return False

    def _assert_owner(self, owner_user_id: Optional[str], owner_profile_id: Optional[str]) -> None:
        if owner_user_id != self.owner_user_id or owner_profile_id != self.owner_profile_id:
            raise PermissionError("Playground record owner does not match storage owner")
