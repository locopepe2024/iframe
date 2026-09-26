from typing import Dict, Any, List, Optional, Tuple
import hashlib
import json
import os
import re
import time
import uuid
import subprocess
import threading
import platform
from urllib.parse import quote
from .models import (
    Script,
    GenerationStatus,
    VideoTask,
    Character,
    Scene,
    StoryboardFrame,
    LightingData,
    Series,
    PromptConfig,
    ArtDirection,
    DirectorProfile,
    DirectorProfileRevision,
    DirectorShootingPlan,
    DirectorShootingPlanRevision,
    ArtifactLineage,
    SourceRange,
    ScriptSourceRevision,
    ScriptFactLedgerEntry,
    ScriptFactLedgerRevision,
    AssemblyEditPlan,
    director_execution_payload,
    GlobalAssetLibrary,
    AssetLibraryReference,
    AssetReferenceIndex,
    AssetReferenceIndexEntry,
    merge_director_profile_patch,
    normalize_director_profile_draft,
)
from .llm import ScriptProcessor
from .structured_evidence import source_version
from .assets import AssetGenerator
from .storyboard import StoryboardGenerator
from .video import VideoGenerator
from .audio import AudioGenerator
from .export import ExportManager
from ...utils import get_logger
from ...utils.oss_utils import is_object_key
from ...utils.provider_registry import resolve_provider_backend
from ...utils.system_check import get_ffmpeg_path, get_ffmpeg_install_instructions
from ..studio_access import (
    StudioOwnerMixin,
    owned_by,
    reset_studio_uniart_config,
    runtime_uniart_for_owner,
    set_studio_uniart_config,
    studio_owner_dir,
    resolve_studio_reference,
)

logger = get_logger(__name__)

# --- Security helpers ---

# Allowed pattern for IDs used in file paths (UUID hex + hyphens)
_SAFE_ID_RE = re.compile(r'^[a-zA-Z0-9_\-]+$')
_DIRECTOR_PROFILE_UNSET = object()
_DIRECTOR_CONTEXT_UNSET = object()


def _validate_safe_id(value: str, label: str = "id") -> str:
    """Ensure a value is safe to embed in file paths / command args (UUID-like)."""
    if not value or not _SAFE_ID_RE.match(value):
        raise ValueError(f"Invalid {label}: contains unsafe characters")
    return value


def _director_profile_content(value: Any) -> Dict[str, Any]:
    """Return versioned Director content without server metadata.

    ``story_map`` was added after existing Director drafts had already been
    stored. Omit its empty default so legacy draft comparisons and content
    hashes keep their pre-story-map shape.
    """
    profile = value if isinstance(value, DirectorProfile) else DirectorProfile(**value)
    content = profile.model_dump(exclude={"revision", "content_hash", "confirmed_at"})
    if content.get("story_map") is None:
        content.pop("story_map", None)
    return content


def _safe_resolve_path(base_dir: str, untrusted_rel: str) -> str:
    """Resolve *untrusted_rel* under *base_dir* and ensure the result stays inside it.

    Prevents path-traversal attacks (e.g. ``../../etc/passwd``).
    Returns the resolved absolute path; raises ValueError on escape attempts.
    """
    base = os.path.realpath(base_dir)
    resolved = os.path.realpath(os.path.join(base, untrusted_rel))
    if not resolved.startswith(base + os.sep):
        raise ValueError(f"Path escapes base directory: {untrusted_rel}")
    return resolved


class LibraryAssetInUseError(Exception):
    """Raised when a global library asset cannot be hard-deleted because it is
    still referenced by one or more storyboard frames (design Q2 reference
    integrity). Carries the referrers so the API can surface them (HTTP 409).

    ``references`` is a list of dicts, each:
        {"owner_kind": "project"|"series", "owner_id": str,
         "owner_title": Optional[str], "frame_id": str}
    """

    def __init__(self, asset_type: str, asset_id: str, references: List[Dict[str, Any]]):
        self.asset_type = asset_type
        self.asset_id = asset_id
        self.references = references
        super().__init__(
            f"Library {asset_type} {asset_id} is referenced by "
            f"{len(references)} storyboard frame(s); refusing to delete "
            f"(pass force=True to delete anyway)."
        )


class InvalidAssetReference(ValueError):
    """Raised when a requested asset-library reference cannot be resolved."""


class AssetGenerationInProgress(ValueError):
    """Raised when an asset already has an active image-generation task."""


class AssemblyPlanValidationError(ValueError):
    """Raised when an Assembly plan crosses an owner/reference boundary."""


class AssemblyPlanConflictError(ValueError):
    """Raised when an Assembly plan update uses a stale revision."""

    def __init__(self, message: str, current_revision: Optional[int] = None):
        self.current_revision = current_revision
        super().__init__(message)


class StaleStoryboardDraftError(ValueError):
    """Raised when a reviewed storyboard draft no longer matches its input lineage."""


class ComicGenPipeline(StudioOwnerMixin):
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.script_processor = ScriptProcessor()
        self.asset_generator = AssetGenerator(self.config.get('assets'))
        self.storyboard_generator = StoryboardGenerator(self.config.get('storyboard'))
        self.video_generator = VideoGenerator(self.config.get('video'))
        self.audio_generator = AudioGenerator(self.config.get('audio'))
        self.export_manager = ExportManager(self.config.get('export'))
        
        self.data_file = "output/projects.json"
        self.series_data_file = "output/series.json"
        self.library_data_file = "output/library_assets.json"
        self._save_lock = threading.RLock()  # Reentrant lock to prevent concurrent file writes
        self.scripts: Dict[str, Script] = self._load_data()
        self.series_store: Dict[str, Series] = self._load_series_data()
        # Project-independent global asset library (lowest resolver layer).
        self.library_store: GlobalAssetLibrary = self._load_library_data()
        self._migrate_legacy_studio_owners()
        self._repair_series_bindings()
        self._migrate_uploaded_asset_statuses()

        # Extraction preview cache: {project_id: (timestamp, Script)}
        self._extraction_cache: Dict[str, tuple] = {}

        # Task management for async asset generation
        # Format: { task_id: { status: str, progress: int, error: str, script_id: str, asset_id: str, created_at: float } }
        self.asset_generation_tasks: Dict[str, Dict[str, Any]] = {}
        self.video_generation_tasks: Dict[str, Dict[str, Any]] = {}
        # Temporary cache for file import previews
        # (import_id -> (owner_profile_id, text))
        self._import_cache: Dict[str, Tuple[str, str]] = {}
        # Cached model instances (lazily initialized)
        self._kling_model = None
        self._vidu_model = None
        self._mulerouter_video_model = None
        self._uniart_video_model = None

        # Pre-download Demucs model in background so first dub request is fast
        self._demucs_ready = threading.Event()
        self._demucs_error: Optional[str] = None
        threading.Thread(target=self._warmup_demucs_model, daemon=True).start()

        # Recover orphan async tasks. FastAPI BackgroundTasks live in
        # process memory — any restart between submit + execute leaves
        # them permanently `pending` (or `processing` if interrupted
        # mid-call) on disk. We mark such tasks `failed` with a clear
        # reason so the user sees a Retry affordance instead of an
        # eternal spinner. We do NOT auto-resume because re-running a
        # half-completed video task could double-charge providers.
        try:
            self._recover_orphan_tasks()
            self._recover_orphan_asset_states()
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("Orphan task recovery failed: %s", exc)

    @staticmethod
    def _owner_output_dir(resource: Any, category: str) -> str:
        owner_profile_id = getattr(resource, "owner_profile_id", None)
        if owner_profile_id:
            return os.path.join(studio_owner_dir(owner_profile_id), category)
        return os.path.join("output", category)

    _ORPHAN_RECOVERY_REASON = (
        "Backend was restarted while this task was running. Click Retry to run it again."
    )

    def _recover_orphan_tasks(self) -> None:
        """Sweep persisted state for video tasks left in pending/processing.

        FastAPI's BackgroundTasks queue lives entirely in process memory:
        if uvicorn restarts (dev --reload, OOM, OS reboot, ctrl-C) every
        queued processor is gone but the task records on disk still say
        "pending" or "processing". The frontend then shows an eternal
        spinner and the user has no recovery path.

        Strategy: on boot, find every such record and stamp it `failed`
        with a clear, user-readable reason so the existing Retry button
        becomes usable. Auto-resume is intentionally NOT done — a
        half-run video generation may have already incurred provider
        cost and re-running could double-charge.

        Asset / motion-ref tasks live in transient in-process dicts
        (self.asset_generation_tasks etc.) and never persist, so they
        die naturally with the process and don't need recovery.
        """
        STUCK = ("pending", "processing")
        recovered = 0

        for script in self.scripts.values():
            tasks = getattr(script, "video_tasks", None) or []
            for task in tasks:
                if getattr(task, "status", None) in STUCK:
                    task.status = "failed"
                    if not getattr(task, "error", None):
                        try:
                            task.error = self._ORPHAN_RECOVERY_REASON
                        except Exception:
                            pass
                    recovered += 1

        if recovered > 0:
            try:
                self._save_data()
            except Exception:
                logger.warning("Orphan recovery: failed to persist sweep")
            logger.warning(
                "Orphan task recovery: marked %d stuck task(s) as failed.",
                recovered,
            )
        else:
            logger.debug("Orphan task recovery: no stuck tasks found.")

    def _recover_orphan_asset_states(self) -> None:
        """Convert persisted image assets left in processing after a restart.

        Image generation tasks currently live in memory, so a restart removes
        their task record while the target asset can remain persisted as
        ``processing``. Mark that state as recoverable failure instead of
        exposing an eternal spinner. Successful existing variants remain
        untouched and can be selected or used for an explicit retry.
        """
        recovered = 0
        resources = [
            (self.scripts.values(), "script"),
            (self.series_store.values(), "series"),
            (self.library_store, "global"),
        ]
        for containers, source in resources:
            owners = containers if source != "global" else [containers]
            for owner in owners:
                for asset_type in ("character", "scene", "prop"):
                    for asset in getattr(owner, f"{asset_type}s", []) or []:
                        if asset.status != GenerationStatus.PROCESSING:
                            continue
                        asset.status = GenerationStatus.FAILED
                        asset.generation_error = "Generation interrupted by backend restart. Retry or clear the status."
                        recovered += 1
            if source == "script" and recovered:
                self._save_data()
            elif source == "series" and recovered:
                self._save_series_data()
            elif source == "global" and recovered:
                self._save_library_data()
        if recovered:
            logger.warning("Orphan asset recovery: marked %d image asset(s) recoverable", recovered)

    def clear_asset_generation_state(self, script_id: str, asset_id: str, asset_type: str) -> Script:
        """Clear a failed/orphaned image generation marker without deleting assets."""
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            target, source = self._find_asset_with_source(script, asset_id, asset_type)
            if target is None:
                raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")
            if target.status == GenerationStatus.PROCESSING:
                raise AssetGenerationInProgress("Asset generation is still processing")
            target.status = GenerationStatus.COMPLETED if self._asset_has_uploaded_image(target) else GenerationStatus.PENDING
            target.generation_error = None
            self._save_after_asset_mutation(source)
            return script

    _MAX_LABEL_LEN = 20

    def annotate_video_task(
        self,
        script_id: str,
        task_id: str,
        is_starred: Optional[bool] = None,
        label: Optional[str] = None,
        clear_label: bool = False,
    ) -> Optional["VideoTask"]:
        """Set the user's review annotations on a video task. Two fields,
        both optional so callers can update either independently:
          - is_starred: shortlist flag, multi-select per shot
          - label: short free-text note (≤20 chars). Pass clear_label=True
            to explicitly remove the label (None on its own means "don't
            change").
        Returns the updated VideoTask, or None if script/task not found
        (caller can decide whether that's a 404)."""
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                return None
            tasks = getattr(script, "video_tasks", None) or []
            task = next((t for t in tasks if getattr(t, "id", None) == task_id), None)
            if not task:
                return None
            if is_starred is not None:
                task.is_starred = bool(is_starred)
            if clear_label:
                task.label = None
            elif label is not None:
                trimmed = label.strip()[: self._MAX_LABEL_LEN]
                task.label = trimmed or None
            try:
                self._save_data()
            except Exception:
                logger.warning("annotate_video_task: save failed")
            return task

    _T2I_HISTORY_LIMIT = 10
    _MAX_GENERATE_COUNT = 6
    _WORKBENCH_TAB_VALUES = ("t2i_i2v", "direct_r2v")

    def update_frame_workbench(
        self,
        script_id: str,
        frame_id: str,
        workbench_tab_mode: Optional[str] = None,
        t2i_image_urls: Optional[List[str]] = None,
        t2i_selected_index: Optional[int] = None,
        workbench_generate_count: Optional[int] = None,
        video_model: Optional[str] = None,
        workbench_generate_audio: Optional[bool] = None,
        workbench_reference_variant_ids: Optional[Dict[str, List[str]]] = None,
        workbench_pose_reference_variant_ids: Optional[Dict[str, List[str]]] = None,
        workbench_director_snapshot_media_id: Optional[str] = None,
    ) -> Optional["StoryboardFrame"]:
        """Persist Storyboard R2V workbench state onto a frame.

        Each field is optional; only the ones the caller passes get
        written. The four fields cover everything the per-shot panel
        carries that needs to survive refresh/cross-device:
          - workbench_tab_mode: 't2i_i2v' | 'direct_r2v'
          - t2i_image_urls: full ordered history (caller is the source
            of truth, server clamps to _T2I_HISTORY_LIMIT FIFO)
          - t2i_selected_index: active首帧 index, clamped to range
          - workbench_generate_count: per-shot batch size, clamped to
            [1, _MAX_GENERATE_COUNT]

        Returns the updated StoryboardFrame, or None if the
        script/frame can't be found (caller maps to 404).
        Unknown enum values for workbench_tab_mode are rejected with
        ValueError so a typo doesn't silently persist garbage."""
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                return None
            frames = getattr(script, "frames", None) or []
            frame = next((f for f in frames if getattr(f, "id", None) == frame_id), None)
            if not frame:
                return None
            if workbench_tab_mode is not None:
                if workbench_tab_mode not in self._WORKBENCH_TAB_VALUES:
                    raise ValueError(
                        f"workbench_tab_mode must be one of {self._WORKBENCH_TAB_VALUES}, "
                        f"got {workbench_tab_mode!r}",
                    )
                frame.workbench_tab_mode = workbench_tab_mode
            if t2i_image_urls is not None:
                # Filter empties + cap FIFO so the client can't grow the
                # list unbounded by repeated calls. The client also caps
                # at the same limit, but defense in depth.
                cleaned = [u for u in t2i_image_urls if isinstance(u, str) and u.strip()]
                if len(cleaned) > self._T2I_HISTORY_LIMIT:
                    cleaned = cleaned[-self._T2I_HISTORY_LIMIT:]
                frame.t2i_image_urls = cleaned
            if t2i_selected_index is not None:
                # Clamp against the resulting URL list, not whatever was
                # there before — t2i_image_urls may have been written
                # this same call.
                urls = frame.t2i_image_urls or []
                if not urls:
                    frame.t2i_selected_index = 0
                else:
                    frame.t2i_selected_index = max(0, min(int(t2i_selected_index), len(urls) - 1))
            if workbench_generate_count is not None:
                frame.workbench_generate_count = max(
                    1, min(int(workbench_generate_count), self._MAX_GENERATE_COUNT)
                )
            if video_model is not None:
                frame.video_model = video_model.strip() or None
            if workbench_generate_audio is not None:
                frame.workbench_generate_audio = bool(workbench_generate_audio)
            if workbench_reference_variant_ids is not None:
                cleaned_selections: Dict[str, List[str]] = {}
                for asset_id, variant_ids in workbench_reference_variant_ids.items():
                    if not isinstance(asset_id, str) or not asset_id.strip() or not isinstance(variant_ids, list):
                        continue
                    unique_ids: List[str] = []
                    for variant_id in variant_ids:
                        if isinstance(variant_id, str) and variant_id.strip() and variant_id not in unique_ids:
                            unique_ids.append(variant_id)
                    if unique_ids:
                        cleaned_selections[asset_id] = unique_ids
                frame.workbench_reference_variant_ids = cleaned_selections
            if workbench_pose_reference_variant_ids is not None:
                cleaned_pose_selections: Dict[str, List[str]] = {}
                for asset_id, variant_ids in workbench_pose_reference_variant_ids.items():
                    if not isinstance(asset_id, str) or not asset_id.strip() or not isinstance(variant_ids, list):
                        continue
                    unique_ids: List[str] = []
                    for variant_id in variant_ids:
                        if isinstance(variant_id, str) and variant_id.strip() and variant_id not in unique_ids:
                            unique_ids.append(variant_id)
                    if unique_ids:
                        cleaned_pose_selections[asset_id] = unique_ids
                frame.workbench_pose_reference_variant_ids = cleaned_pose_selections
            if workbench_director_snapshot_media_id is not None:
                frame.workbench_director_snapshot_media_id = (
                    workbench_director_snapshot_media_id.strip() or None
                )
            frame.updated_at = time.time()
            try:
                self._save_data()
            except Exception:
                logger.warning("update_frame_workbench: save failed")
            return frame

    def upload_t2i_frame(
        self,
        script_id: str,
        frame_id: str,
        file_path: str,
    ) -> Optional["StoryboardFrame"]:
        """Append an uploaded image to a frame's T2I history and auto-select it.

        Mirrors `update_frame_workbench`'s clamping rules (≤ _T2I_HISTORY_LIMIT
        FIFO; t2i_selected_index → index of the newly appended URL). Caller is
        expected to have already saved the file under output/uploads/ and pass
        the relative URL path the frontend can resolve via /files.

        Returns the updated frame, or None if script/frame can't be found.
        """
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                return None
            frames = getattr(script, "frames", None) or []
            frame = next((f for f in frames if getattr(f, "id", None) == frame_id), None)
            if not frame:
                return None
            current = list(getattr(frame, "t2i_image_urls", None) or [])
            current.append(file_path)
            # Same FIFO cap as update_frame_workbench so uploads can't grow
            # the history unbounded either.
            if len(current) > self._T2I_HISTORY_LIMIT:
                current = current[-self._T2I_HISTORY_LIMIT:]
            frame.t2i_image_urls = current
            # Newly uploaded image becomes the active首帧 — Issue 10 design
            # requires the upload immediately unlocks Step 2.
            frame.t2i_selected_index = len(current) - 1
            frame.updated_at = time.time()
            try:
                self._save_data()
            except Exception:
                logger.warning("upload_t2i_frame: save failed")
            return frame

    def mark_video_task_failed(
        self, script_id: str, task_id: str, error_message: str
    ) -> bool:
        """Belt-and-suspenders setter used by BG-task wrappers when an
        exception escapes the pipeline's own try/except. Writes
        status='failed' + error so the UI never sees an eternal
        spinner. Also used by the cancel endpoint. Returns True when a
        task was found and marked."""
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                return False
            tasks = getattr(script, "video_tasks", None) or []
            task = next((t for t in tasks if getattr(t, "id", None) == task_id), None)
            if not task:
                return False
            if getattr(task, "status", None) == "completed":
                # Already successfully completed — don't downgrade on a
                # spurious wrapper exception or a late cancel.
                return False
            task.status = "failed"
            try:
                if not getattr(task, "error", None):
                    task.error = error_message
            except Exception:
                pass
            try:
                self._save_data()
            except Exception:
                logger.warning("mark_video_task_failed: save failed")
            return True

    def _resolve_video_backend(self, model_name: str) -> str:
        try:
            return resolve_provider_backend(model_name)
        except (KeyError, ValueError):
            logger.debug(
                "Provider backend not registered for video model %s, defaulting to dashscope.",
                model_name,
            )
            return "dashscope"
        except Exception as e:
            logger.warning(
                "Unexpected error resolving provider backend for video model %s: %s. "
                "Falling back to dashscope.",
                model_name,
                e,
            )
            return "dashscope"

    # ... (existing methods)

    def export_project(self, script_id: str, options: Dict[str, Any]) -> str:
        """Step 7: Export project to final video."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        export_url = self.export_manager.render_project(script, options)
        return export_url

    def _load_data(self) -> Dict[str, Script]:
        if not os.path.exists(self.data_file):
            return {}
        try:
            with open(self.data_file, 'r') as f:
                data = json.load(f)
                return {k: Script(**v) for k, v in data.items()}
        except Exception as e:
            logger.error(f"Failed to load data: {e}")
            return {}

    def _save_data(self):
        """Save data with thread lock to prevent concurrent write issues."""
        with self._save_lock:
            try:
                os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
                with open(self.data_file, 'w') as f:
                    json.dump({k: v.dict() for k, v in self.scripts.items()}, f, indent=2)
            except Exception as e:
                logger.error(f"Failed to save data: {e}")

    def _repair_series_bindings(self):
        """Repair episodes listed in series.episode_ids that have series_id=None."""
        repaired = False
        for series_id, series in self.series_store.items():
            for ep_id in series.episode_ids:
                script = self.scripts.get(ep_id)
                same_owner = (
                    script
                    and script.owner_profile_id
                    and script.owner_profile_id == series.owner_profile_id
                )
                if same_owner and not script.series_id:
                    script.series_id = series_id
                    if not script.episode_number:
                        script.episode_number = series.episode_ids.index(ep_id) + 1
                    repaired = True
                    logger.info(f"Repaired series binding: episode {ep_id} → series {series_id}")
        if repaired:
            self._save_data()

    @staticmethod
    def _asset_has_uploaded_image(asset: Any) -> bool:
        """Return whether an asset already has a usable uploaded image.

        The canonical character reference lives in ``reference_sheet`` while
        older records may still use one of the legacy image containers.  The
        helper intentionally checks the explicit upload provenance flag so a
        partially generated asset is not mistaken for a completed upload.
        """
        if asset is None:
            return False
        containers = (
            [
                getattr(asset, "reference_sheet", None),
                getattr(asset, "full_body_asset", None),
                getattr(asset, "three_view_asset", None),
                getattr(asset, "headshot_asset", None),
            ]
            if hasattr(asset, "reference_sheet")
            else [getattr(asset, "image_asset", None)]
        )
        for container in containers:
            if container is None:
                continue
            variants = getattr(container, "image_variants", None)
            if variants is None:
                variants = getattr(container, "variants", None)
            if any(
                getattr(variant, "is_uploaded_source", False)
                and bool(getattr(variant, "url", None))
                for variant in (variants or [])
            ):
                return True
        return False

    def _migrate_uploaded_asset_statuses(self) -> None:
        """Mark upload-only assets ready when older records still say pending.

        Uploads predating the status fix already contain a selected reference
        image but remain ``pending`` because no generation task ran.  Repair
        only that safe, explicit state at startup; failed/processing
        generations remain untouched.
        """
        def repair_assets(resources: Any) -> bool:
            changed = False
            containers = resources.values() if isinstance(resources, dict) else [resources]
            for resource in containers:
                for collection_name in ("characters", "scenes", "props"):
                    for asset in getattr(resource, collection_name, []) or []:
                        status = getattr(asset, "status", None)
                        if status in (GenerationStatus.PENDING, GenerationStatus.PENDING.value) and self._asset_has_uploaded_image(asset):
                            asset.status = GenerationStatus.COMPLETED
                            changed = True
            return changed

        if repair_assets(self.scripts):
            self._save_data()
        if repair_assets(self.series_store):
            self._save_series_data()
        if repair_assets(self.library_store):
            self._save_library_data()

    def create_project(
        self,
        title: str,
        text: str,
        skip_analysis: bool = False,
        workflow_mode: str = "i2v_legacy",
        series_id: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        owner_profile_id: Optional[str] = None,
    ) -> Script:
        """Step 1: Parse novel and create project.

        When `series_id` is provided the new project is bound as the next
        episode of that existing series (episode_number = current max
        episode number in the series + 1) via the same
        `add_episode_to_series` mechanism used elsewhere. When `series_id`
        is None the behavior is the original standalone-project path,
        bit-for-bit unchanged.
        """
        if series_id and not self.get_series(series_id, owner_profile_id):
            raise ValueError("Series not found")

        if skip_analysis:
            script = self.script_processor.create_draft_script(title, text)
        else:
            script = self.script_processor.parse_novel(title, text)

        script.workflow_mode = workflow_mode
        script.owner_user_id = owner_user_id
        script.owner_profile_id = owner_profile_id
        self._record_source_text(script, script.original_text)
        self.stamp_owned_children(script)
        self.scripts[script.id] = script
        self._save_data()

        # Optional series binding (T9). Reuses add_episode_to_series so the
        # episode_ids / series_id / episode_number wiring matches every
        # other "attach episode to series" path. add_episode_to_series
        # mutates the in-memory script in place (same object reference) and
        # persists both projects.json and series.json.
        if series_id:
            existing = self.get_series_episodes(series_id)
            max_ep = max([ep.episode_number for ep in existing if ep.episode_number] or [0])
            self.add_episode_to_series(
                series_id,
                script.id,
                episode_number=max_ep + 1,
                owner_profile_id=owner_profile_id,
            )
        return script
    
    def extract_preview(self, script_id: str, text: str) -> Script:
        """Run entity extraction without saving. Cache result for subsequent apply."""
        existing_script = self.scripts.get(script_id)
        if not existing_script:
            raise ValueError("Script not found")
        custom_extraction = getattr(getattr(existing_script, "prompt_config", None), "entity_extraction", "")
        new_script = self.script_processor.parse_novel(existing_script.title, text, custom_extraction)
        self._extraction_cache[script_id] = (time.time(), new_script)
        return new_script

    @staticmethod
    def _record_source_text(script: Script, text: str) -> bool:
        """Archive the current source before changing the compatibility read model."""
        text = text or ""
        if not script.source_revisions:
            script.source_revisions.append(ScriptSourceRevision(
                revision=script.source_revision,
                content_hash=source_version(script.original_text),
                text=script.original_text,
                created_at=script.created_at,
            ))
        latest = script.source_revisions[-1]
        if latest.revision != script.source_revision or latest.text != script.original_text:
            raise ValueError("Script source revision does not match current text")
        if text == script.original_text:
            return False
        script.source_revision += 1
        script.original_text = text
        script.source_revisions.append(ScriptSourceRevision(
            revision=script.source_revision,
            content_hash=source_version(text),
            text=text,
            created_at=time.time(),
        ))
        script.director_review_required = True
        return True

    def update_script_text(self, script_id: str, text: str) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            if self._record_source_text(script, text):
                script.updated_at = time.time()
            self._save_data()
            return script

    def reparse_project(self, script_id: str, text: str,
                        draft: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> Script:
        """Re-parse the text for an existing project, replacing all entities."""
        existing_script = self.scripts.get(script_id)
        if not existing_script:
            raise ValueError("Script not found")

        # Applying an explicit draft must persist exactly what the user reviewed,
        # even when the short-lived preview cache has expired.
        cached = self._extraction_cache.pop(script_id, None)
        if draft is not None:
            normalized = {key: list(draft.get(key, [])) for key in ("characters", "scenes", "props")}
            new_script = self.script_processor._create_script_from_data(
                existing_script.title, text, normalized
            )
        elif cached and (time.time() - cached[0]) < 300 and cached[1].original_text == text:
            new_script = cached[1]
        else:
            custom_extraction = getattr(getattr(existing_script, "prompt_config", None), "entity_extraction", "")
            new_script = self.script_processor.parse_novel(existing_script.title, text, custom_extraction)
        
        # Preserve the original script ID and timestamps
        new_script.id = existing_script.id
        new_script.created_at = existing_script.created_at
        new_script.updated_at = time.time()

        # Extraction creates a new Script, but ownership belongs to the
        # existing project, never to the parser or its cached result.
        new_script.owner_user_id = existing_script.owner_user_id
        new_script.owner_profile_id = existing_script.owner_profile_id
        self.stamp_owned_children(new_script)

        self._record_source_text(existing_script, text)
        new_script.original_text = existing_script.original_text
        new_script.source_revision = existing_script.source_revision
        new_script.source_revisions = [item.model_copy(deep=True) for item in existing_script.source_revisions]
        new_script.fact_ledger_revision = existing_script.fact_ledger_revision
        new_script.fact_ledger = [item.model_copy(deep=True) for item in existing_script.fact_ledger]
        new_script.fact_ledger_revisions = [
            item.model_copy(deep=True) for item in existing_script.fact_ledger_revisions
        ]
        new_script.fact_ledger_draft_revision = existing_script.fact_ledger_draft_revision
        new_script.fact_ledger_draft_source_revision = existing_script.fact_ledger_draft_source_revision
        new_script.fact_ledger_draft = [item.model_copy(deep=True) for item in existing_script.fact_ledger_draft]
        new_script.fact_ledger_draft_updated_at = existing_script.fact_ledger_draft_updated_at
        new_script.director_profile_revisions = [
            item.model_copy(deep=True) for item in existing_script.director_profile_revisions
        ]
        new_script.director_profile_draft = (
            existing_script.director_profile_draft.model_copy(deep=True)
            if existing_script.director_profile_draft else None
        )
        new_script.director_profile_draft_revision = existing_script.director_profile_draft_revision
        new_script.director_profile_draft_source_revision = existing_script.director_profile_draft_source_revision
        new_script.director_profile_draft_updated_at = existing_script.director_profile_draft_updated_at
        new_script.director_shooting_plan_revisions = [
            item.model_copy(deep=True) for item in existing_script.director_shooting_plan_revisions
        ]
        new_script.director_shooting_plan_draft = (
            existing_script.director_shooting_plan_draft.model_copy(deep=True)
            if existing_script.director_shooting_plan_draft else None
        )
        new_script.director_shooting_plan_draft_revision = existing_script.director_shooting_plan_draft_revision
        new_script.director_shooting_plan_draft_updated_at = existing_script.director_shooting_plan_draft_updated_at
        new_script.director_review_required = existing_script.director_review_required
        
        # Preserve project-level settings
        new_script.art_direction = existing_script.art_direction
        new_script.model_settings = existing_script.model_settings
        new_script.style_preset = existing_script.style_preset
        new_script.style_prompt = existing_script.style_prompt
        new_script.merged_video_url = existing_script.merged_video_url
        new_script.workflow_mode = existing_script.workflow_mode
        # Preserve series binding — the freshly parsed Script defaults
        # series_id/episode_number to None, which would orphan an episode
        # mid-reparse and break the Reconcile suggestions endpoint
        # (it returns [] for any project without a series_id). Same for
        # prompt_config, default_generation_mode, bgm_url, mix_settings —
        # all project-level fields unrelated to entity extraction.
        # custom_voices lives on Series, NOT Script — do not touch it here.
        new_script.series_id = existing_script.series_id
        new_script.episode_number = existing_script.episode_number
        new_script.prompt_config = existing_script.prompt_config
        new_script.default_generation_mode = existing_script.default_generation_mode
        new_script.bgm_url = existing_script.bgm_url
        new_script.mix_settings = existing_script.mix_settings
        
        # Replace the script in memory
        self.scripts[script_id] = new_script
        self._save_data()
        return new_script


    def generate_assets(self, script_id: str) -> Script:
        """Step 2: Generate character and scene assets (Batch)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        logger.info(f"Generating assets for script {script.id}")
        
        # Sort characters: Base characters first (those without base_character_id)
        sorted_chars = sorted(script.characters, key=lambda c: 0 if not c.base_character_id else 1)

        for char in sorted_chars:
            self.generate_asset(script_id, char.id, "character")
            
        for scene in script.scenes:
            self.generate_asset(script_id, scene.id, "scene")
            
        for prop in script.props:
            self.generate_asset(script_id, prop.id, "prop")
            
        self._save_data()
        return script

    def generate_asset(self, script_id: str, asset_id: str, asset_type: str, style_preset: str = None, reference_image_url: str = None, style_prompt: str = None, generation_type: str = "all", prompt: str = None, apply_style: bool = True, negative_prompt: str = None, batch_size: int = 1, model_name: str = None, aspect_ratio: str = None, use_reference_image: bool = True, reference: Any = None, references: Any = None, image_generation_mode: str = "text", _generation_task_id: Optional[str] = None) -> Script:
        """Step 2: Generate a specific asset (character/scene/prop).
        If style_preset is None, uses the project's global style."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        if references and (reference is not None or reference_image_url):
            raise InvalidAssetReference("multiple structured references cannot be combined with a singular legacy reference")
        self._validate_asset_generation_mode(
            image_generation_mode,
            bool(reference is not None or reference_image_url or references),
        )

        reference_provenance = None
        if reference is not None:
            # Structured identity always wins over the legacy URL. Resolve it
            # again during execution so a queued task cannot use a deleted or
            # cross-owner variant.
            reference_image_url, reference_provenance = self._resolve_asset_library_reference(
                script,
                reference,
            )
            use_reference_image = True

        resolved_references = []
        reference_provenance_list = []
        if references:
            normalized_references = self._normalize_asset_references(references)
            for structured_reference in normalized_references:
                resolved, provenance = self._resolve_asset_library_reference(script, structured_reference)
                resolved_references.append(resolved)
                reference_provenance_list.append(provenance)
        
        # Get effective model names from project settings if not overridden
        t2i_model = model_name or script.model_settings.t2i_model
        i2i_model = script.model_settings.i2i_model
        
        # Get effective size based on asset type (aspect_ratio param overrides model_settings)
        from .assets import ASPECT_RATIO_TO_SIZE
        if aspect_ratio:
            effective_aspect = aspect_ratio
        elif asset_type == "character":
            effective_aspect = script.model_settings.character_aspect_ratio
        elif asset_type == "scene":
            effective_aspect = script.model_settings.scene_aspect_ratio
        elif asset_type == "prop":
            effective_aspect = script.model_settings.prop_aspect_ratio
        else:
            effective_aspect = "9:16"

        if asset_type == "character":
            default_size = "576*1024"
        elif asset_type == "scene":
            default_size = "1024*576"
        else:
            default_size = "1024*1024"

        effective_size = ASPECT_RATIO_TO_SIZE.get(effective_aspect, default_size)
        
        # Determine effective style: Art Direction > passed style > legacy style
        effective_positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""
        director_profile = None
        director_execution = None

        # Resolve art_direction: episode own > series inherited
        resolved_art_direction = script.art_direction
        if not resolved_art_direction and script.series_id:
            series = self.series_store.get(script.series_id)
            if series and series.art_direction:
                resolved_art_direction = series.art_direction
        if isinstance(resolved_art_direction, dict):
            resolved_art_direction = ArtDirection(**resolved_art_direction)

        if apply_style:
            if resolved_art_direction and resolved_art_direction.style_config:
                effective_positive_prompt = resolved_art_direction.style_config.get('positive_prompt', '')
                global_neg = resolved_art_direction.style_config.get('negative_prompt', '')
                if global_neg:
                    effective_negative_prompt = f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
            elif style_prompt:
                effective_positive_prompt = style_prompt
            elif style_preset:
                effective_positive_prompt = f"{style_preset} style"
            elif script.style_preset:
                effective_positive_prompt = f"{script.style_preset} style"
                if script.style_prompt:
                    effective_positive_prompt += f", {script.style_prompt}"

            director_profile = self.effective_director_profile(script)
            director_execution = self.director_execution_context(
                script,
                subject_ids=[asset_id],
                director_profile=director_profile,
            )
            director_context = self.director_prompt_context(
                script,
                subject_ids=[asset_id],
                director_profile=director_profile,
                execution_context=director_execution,
            )
            if director_context:
                effective_positive_prompt = ". ".join(filter(None, [
                    effective_positive_prompt, director_context,
                ]))
        generation_lineage = self.generation_lineage(
            script, director_profile, director_execution,
        )
        
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset_type: {asset_type}")
        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")

        with self._save_lock:
            target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
            if target_asset is None:
                raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")
            if target_asset.status == GenerationStatus.PROCESSING:
                owned_task = self.asset_generation_tasks.get(_generation_task_id or "")
                if not owned_task or owned_task.get("asset_id") != asset_id or owned_task.get("script_id") != script_id:
                    raise AssetGenerationInProgress("Asset generation is already processing")
            target_asset.status = GenerationStatus.PROCESSING
            target_asset.generation_error = None
            if not target_asset.owner_user_id:
                target_asset.owner_user_id = script.owner_user_id
            if not target_asset.owner_profile_id:
                target_asset.owner_profile_id = script.owner_profile_id
            self._save_after_asset_mutation(source)
        
        try:
            # Generate with Art Direction style injected
            if asset_type == "character":
                # Pass generation_type and specific prompt if available
                # If prompt is provided (from Workbench), use it directly. 
                # Otherwise, asset_generator will construct it using effective_positive_prompt.
                # Note: If prompt is provided, we might still want to append style if it's not included?
                # For now, let's assume the Workbench passes the FULL prompt or we pass style separately.
                # The asset_generator.generate_character expects 'prompt' as the specific prompt.
                # If 'prompt' is None, it constructs one.
                # We should pass effective_positive_prompt as 'positive_prompt' (style suffix) to be appended if needed.
                self.asset_generator.generate_character(
                    target_asset, 
                    generation_type=generation_type, 
                    prompt=prompt, 
                    reference_image_url=reference_image_url,
                    use_reference_image=use_reference_image,
                    positive_prompt=effective_positive_prompt, # Used as style suffix if prompt is auto-generated
                    negative_prompt=effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    i2i_model_name=i2i_model,
                    size=effective_size,
                    reference_provenance=reference_provenance,
                    reference_image_urls=resolved_references,
                    reference_provenance_list=reference_provenance_list,
                    image_generation_mode=image_generation_mode,
                )
            elif asset_type == "scene":
                self.asset_generator.generate_scene(
                    target_asset,
                    effective_positive_prompt,
                    effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    size=effective_size,
                    prompt=prompt,
                    reference_image_url=reference_image_url,
                    reference_provenance=reference_provenance,
                    reference_image_urls=resolved_references,
                    reference_provenance_list=reference_provenance_list,
                    image_generation_mode=image_generation_mode,
                )
            elif asset_type == "prop":
                self.asset_generator.generate_prop(
                    target_asset,
                    effective_positive_prompt,
                    effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    size=effective_size,
                    prompt=prompt,
                    reference_image_url=reference_image_url,
                    reference_provenance=reference_provenance,
                    reference_image_urls=resolved_references,
                    reference_provenance_list=reference_provenance_list,
                    image_generation_mode=image_generation_mode,
                )
                
            target_asset.status = GenerationStatus.COMPLETED
            target_asset.generation_error = None
            target_asset.generation_lineage = generation_lineage.model_copy(deep=True)
            target_asset.director_profile_revision = generation_lineage.director_profile_revision
            target_asset.director_profile_hash = generation_lineage.director_profile_hash
            target_asset.director_review_required = False
        except Exception as e:
            target_asset.status = GenerationStatus.FAILED
            target_asset.generation_error = str(e)
            raise e
        finally:
            self._save_after_asset_mutation(source)

        return script

    def create_asset_generation_task(self, script_id: str, asset_id: str, asset_type: str,
                                      style_preset: str = None, reference_image_url: str = None,
                                      style_prompt: str = None, generation_type: str = "all",
                                      prompt: str = None, apply_style: bool = True,
                                      negative_prompt: str = None, batch_size: int = 1,
                                      model_name: str = None, aspect_ratio: str = None,
                                      reference: Any = None, references: Any = None,
                                      image_generation_mode: str = "text") -> Tuple[Script, str]:
        """Creates an async asset generation task and returns (script, task_id) immediately."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset_type: {asset_type}")
        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")

        if references and (reference is not None or reference_image_url):
            raise InvalidAssetReference("multiple structured references cannot be combined with a singular legacy reference")
        self._validate_asset_generation_mode(
            image_generation_mode,
            bool(reference is not None or reference_image_url or references),
        )

        normalized_reference = None
        if reference is not None:
            # Validate both identity and media before creating the task. The
            # same IDs are resolved again when the background task executes.
            _resolved_reference, normalized_reference = self._resolve_asset_library_reference(
                script,
                reference,
            )
            # A structured library reference is the durable source of truth.
            # Do not retain a browser/provider URL alongside it in the async
            # snapshot; this also guarantees the structured reference wins if
            # an older client sends both fields.
            reference_image_url = None

        normalized_references = self._normalize_asset_references(references or [])
        effective_reference_model = model_name or script.model_settings.t2i_model
        reference_limit = self._asset_reference_limit(effective_reference_model)
        if len(normalized_references) > reference_limit:
            raise InvalidAssetReference(
                f"model '{effective_reference_model}' supports at most {reference_limit} referenced images"
            )
        # Resolve now to reject stale, deleted, or cross-owner inputs before a
        # paid asynchronous task can be persisted. Execution resolves again.
        for structured_reference in normalized_references:
            self._resolve_asset_library_reference(script, structured_reference)

        task_id = str(uuid.uuid4())
        with self._save_lock:
            target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
            if target_asset is None:
                raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")
            if target_asset.status == GenerationStatus.PROCESSING:
                raise AssetGenerationInProgress("Asset generation is already processing")

            target_asset.status = GenerationStatus.PROCESSING
            target_asset.generation_error = None
            self.asset_generation_tasks[task_id] = {
                "status": "pending",  # pending -> processing -> completed/failed
                "progress": 0,
                "error": None,
                "script_id": script_id,
                "asset_id": asset_id,
                "asset_type": asset_type,
                "created_at": time.time(),
                "owner_user_id": script.owner_user_id,
                "owner_profile_id": script.owner_profile_id,
                "params": {
                    "style_preset": style_preset,
                    "reference_image_url": reference_image_url,
                    "reference": normalized_reference,
                    "references": normalized_references,
                    "image_generation_mode": image_generation_mode,
                    "style_prompt": style_prompt,
                    "generation_type": generation_type,
                    "prompt": prompt,
                    "apply_style": apply_style,
                    "negative_prompt": negative_prompt,
                    "batch_size": batch_size,
                    "model_name": model_name,
                    "aspect_ratio": aspect_ratio,
                    "use_reference_image": bool(reference_image_url),
                }
            }
            self._save_after_asset_mutation(source)
        return script, task_id

    def process_asset_generation_task(self, task_id: str):
        """Processes an asset generation task in the background."""
        with self._save_lock:
            task = self.asset_generation_tasks.get(task_id)
            if not task:
                logger.error(f"Task {task_id} not found")
                return
            if task.get("status") != "pending":
                logger.warning("Ignoring duplicate or terminal asset task execution: %s", task_id)
                return
            task["status"] = "processing"

        provider_token = None
        try:
            owner_user_id = task.get("owner_user_id")
            owner_profile_id = task.get("owner_profile_id")
            if owner_user_id and owner_profile_id:
                provider_token = set_studio_uniart_config(
                    runtime_uniart_for_owner(owner_user_id, owner_profile_id)
                )
            params = task["params"]
            if task.get("is_series"):
                # Series asset generation — operate on series_store
                self._process_series_asset_task(task, params)
            else:
                # Project asset generation — existing logic
                self.generate_asset(
                    task["script_id"],
                    task["asset_id"],
                    task["asset_type"],
                    params["style_preset"],
                    params["reference_image_url"],
                    params["style_prompt"],
                    params["generation_type"],
                    params["prompt"],
                    params["apply_style"],
                    params["negative_prompt"],
                    params["batch_size"],
                    params["model_name"],
                    params.get("aspect_ratio"),
                    params.get("use_reference_image", False),
                    params.get("reference"),
                    params.get("references"),
                    params.get("image_generation_mode", "text"),
                    _generation_task_id=task_id,
                )
            task["result_asset"], task["asset_source"] = self._asset_generation_result(task)
            task["status"] = "completed"
            task["progress"] = 100
            logger.info(f"Task {task_id} completed successfully")
        except Exception as e:
            task["status"] = "failed"
            task["error"] = str(e)
            with self._save_lock:
                try:
                    if task.get("is_series"):
                        owner = self.series_store.get(task.get("script_id"))
                        source = "series"
                    else:
                        owner = self.scripts.get(task.get("script_id"))
                        source = "script"
                    if owner:
                        asset_type = task.get("asset_type")
                        if task.get("is_series"):
                            pool = getattr(owner, f"{asset_type}s", []) if asset_type in ("character", "scene", "prop") else []
                            asset = next((item for item in pool if item.id == task.get("asset_id")), None)
                        else:
                            asset, source = self._find_asset_with_source(
                                owner, task.get("asset_id"), asset_type,
                            )
                        if asset and asset.status == GenerationStatus.PROCESSING:
                            asset.status = GenerationStatus.FAILED
                            asset.generation_error = str(e)
                            self._save_after_asset_mutation(source)
                except Exception:
                    logger.exception("Could not persist failed asset state for task %s", task_id)
            logger.error(f"Task {task_id} failed: {e}")
        finally:
            if provider_token is not None:
                reset_studio_uniart_config(provider_token)

    def _asset_generation_result(self, task: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Snapshot only the generated asset for incremental task polling."""
        asset_id = task.get("asset_id")
        asset_type = task.get("asset_type")
        if not asset_id or asset_type not in ("character", "scene", "prop"):
            return None, None

        if task.get("is_series"):
            series = self.series_store.get(task.get("script_id"))
            if not series:
                return None, None
            pool = getattr(series, f"{asset_type}s", [])
            asset = next((item for item in pool if item.id == asset_id), None)
            source = "series"
        else:
            script = self.scripts.get(task.get("script_id"))
            if not script:
                return None, None
            asset, source = self._find_asset_with_source(script, asset_id, asset_type)

        if asset is None:
            return None, None
        payload = asset.model_dump() if hasattr(asset, "model_dump") else asset.dict()
        public_source = {"script": "episode", "series": "series", "global": "global"}.get(source, source)
        payload["source"] = public_source
        return payload, public_source

    def _process_series_asset_task(self, task: Dict, params: Dict):
        """Process a Series asset generation task."""
        series_id = task["script_id"]  # stored as script_id for compatibility
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")

        asset_id = task["asset_id"]
        asset_type = task["asset_type"]
        positive_prompt = params.get("effective_positive_prompt", "")
        negative_prompt = params.get("effective_negative_prompt", "")
        t2i_model = params.get("t2i_model", "wan2.6-t2i")
        effective_size = params.get("effective_size", "576*1024")
        batch_size = params.get("batch_size", 1)
        generation_type = params.get("generation_type", "all")
        prompt = params.get("prompt")
        reference_image_url = params.get("reference_image_url")
        image_generation_mode = params.get("image_generation_mode", "text")
        reference_provenance = None
        if params.get("reference") is not None:
            reference_image_url, reference_provenance = self._resolve_asset_library_reference(
                series,
                params["reference"],
            )
        resolved_references = []
        reference_provenance_list = []
        if params.get("references"):
            normalized_references = self._normalize_asset_references(params["references"])
            for structured_reference in normalized_references:
                resolved, provenance = self._resolve_asset_library_reference(series, structured_reference)
                resolved_references.append(resolved)
                reference_provenance_list.append(provenance)

        if asset_type == "character":
            target = next((c for c in series.characters if c.id == asset_id), None)
            if not target:
                raise ValueError(f"Character {asset_id} not found in series")
            self.asset_generator.generate_character(
                target, generation_type=generation_type, prompt=prompt or "",
                positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
                reference_image_url=reference_image_url,
                reference_provenance=reference_provenance,
                reference_image_urls=resolved_references,
                reference_provenance_list=reference_provenance_list,
                image_generation_mode=image_generation_mode,
            )
        elif asset_type == "scene":
            target = next((s for s in series.scenes if s.id == asset_id), None)
            if not target:
                raise ValueError(f"Scene {asset_id} not found in series")
            self.asset_generator.generate_scene(
                target, positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
                prompt=prompt,
                reference_image_url=reference_image_url,
                reference_provenance=reference_provenance,
                reference_image_urls=resolved_references,
                reference_provenance_list=reference_provenance_list,
                image_generation_mode=image_generation_mode,
            )
        elif asset_type == "prop":
            target = next((p for p in series.props if p.id == asset_id), None)
            if not target:
                raise ValueError(f"Prop {asset_id} not found in series")
            self.asset_generator.generate_prop(
                target, positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
                prompt=prompt,
                reference_image_url=reference_image_url,
                reference_provenance=reference_provenance,
                reference_image_urls=resolved_references,
                reference_provenance_list=reference_provenance_list,
                image_generation_mode=image_generation_mode,
            )
        else:
            raise ValueError(f"Unknown asset type: {asset_type}")

        self._save_series_data()

    def get_asset_generation_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Returns the status of an asset generation task."""
        # Check image tasks first
        task = self.asset_generation_tasks.get(task_id)
        if not task:
            # Then check video tasks
            task = self.video_generation_tasks.get(task_id)
            
        if not task:
            return None

        requested_owner = self._requested_owner_profile_id()
        if requested_owner and task.get("owner_profile_id") != requested_owner:
            return None

        result = {
            "task_id": task_id,
            "status": task["status"],
            "progress": task.get("progress", 0),
            "error": task.get("error"),
            "asset_id": task.get("asset_id"),
            "asset_type": task.get("result_asset_type", task.get("asset_type")),
            "script_id": task.get("script_id"),
            "created_at": task.get("created_at")
        }
        if task.get("status") == "completed" and task.get("result_asset"):
            result["asset"] = task["result_asset"]
            result["asset_source"] = task.get("asset_source")
        return result

    def get_video_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Return a persisted storyboard video task for the active owner."""
        requested_owner = self._requested_owner_profile_id()
        if not requested_owner:
            return None
        for script in self.scripts.values():
            if not owned_by(script, requested_owner):
                continue
            task = next((item for item in script.video_tasks if item.id == task_id), None)
            if not task:
                continue
            return {
                "task_id": task.id,
                "status": task.status,
                "error": task.error,
                "video_url": task.video_url,
                "result_url": task.video_url,
                "script_id": script.id,
                "frame_id": task.frame_id,
            }
        return None

    def create_motion_ref_task(self, script_id: str, asset_id: str, asset_type: str, 
                                prompt: Optional[str] = None, audio_url: Optional[str] = None, 
                                duration: int = 5, batch_size: int = 1) -> Tuple[Script, str]:
        """Creates an async motion reference generation task."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        task_id = str(uuid.uuid4())
        self.video_generation_tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "error": None,
            "script_id": script_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "created_at": time.time(),
            "owner_user_id": script.owner_user_id,
            "owner_profile_id": script.owner_profile_id,
            "params": {
                "prompt": prompt,
                "audio_url": audio_url,
                "duration": duration,
                "batch_size": batch_size
            }
        }
        
        self._save_data()
        return script, task_id

    def process_motion_ref_task(self, script_id: str, task_id: str):
        """Processes a video generation task in the background."""
        task = self.video_generation_tasks.get(task_id)
        if not task:
            logger.error(f"Video task {task_id} not found")
            return
            
        task["status"] = "processing"
        
        try:
            params = task["params"]
            # Call the synchronous generate_motion_ref method
            self.generate_motion_ref(
                script_id=script_id,
                asset_id=task["asset_id"],
                asset_type=task["asset_type"],
                prompt=params["prompt"],
                audio_url=params["audio_url"],
                duration=params["duration"],
                batch_size=params["batch_size"]
            )
            result_asset_type = "character" if task["asset_type"] in ("full_body", "head_shot") else task["asset_type"]
            result_task = {**task, "asset_type": result_asset_type}
            task["result_asset"], task["asset_source"] = self._asset_generation_result(result_task)
            task["result_asset_type"] = result_asset_type
            task["status"] = "completed"
            task["progress"] = 100
            logger.info(f"Video task {task_id} completed successfully")
        except Exception as e:
            task["status"] = "failed"
            task["error"] = str(e)
            logger.error(f"Video task {task_id} failed: {e}")

    def sync_descriptions_from_script_entities(self, script_id: str) -> Script:
        """
        Syncs entity descriptions from ScriptProcessor parsed entities.
        This clears saved prompts so the UI will regenerate them from the current description.
        
        Note: This only updates prompts, not generated images/videos.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # Clear saved prompts for all characters so UI will regenerate from description
        for character in script.characters:
            character.full_body_prompt = None
            character.three_view_prompt = None
            character.headshot_prompt = None
            character.video_prompt = None
        
        # Scenes and props might also have prompts to clear (if applicable)
        for scene in script.scenes:
            if hasattr(scene, 'prompt'):
                scene.prompt = None
        
        for prop in script.props:
            if hasattr(prop, 'prompt'):
                prop.prompt = None
        
        self._save_data()
        logger.info(f"Descriptions synced for script {script_id}: cleared prompts for {len(script.characters)} characters, {len(script.scenes)} scenes, {len(script.props)} props")
        return script

    def add_character(self, script_id: str, name: str, description: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_char = Character(
            id=f"char_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description
        )
        script.characters.append(new_char)
        self._save_data()
        return script

    def delete_character(self, script_id: str, char_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.characters = [c for c in script.characters if c.id != char_id]
        self._save_data()
        return script

    def add_scene(self, script_id: str, name: str, description: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_scene = Scene(
            id=f"scene_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description
        )
        script.scenes.append(new_scene)
        self._save_data()
        return script

    def delete_scene(self, script_id: str, scene_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.scenes = [s for s in script.scenes if s.id != scene_id]
        self._save_data()
        return script
    
    def _find_asset_with_source(
        self, script: "Script", asset_id: str, asset_type: str
    ) -> Tuple[Optional[object], Optional[str]]:
        """Locate an asset by (id, type) in either the episode's local
        list OR the parent series' shared pool. Returns
        (asset, source) where source ∈ {"script", "series", "global"} so the
        caller can mutate the right object and save the right side.

        Episode-local always wins (the user explicitly forked this
        asset to override the series version). Falls back to series
        only when the id isn't local. Returns (None, None) when the
        asset doesn't exist in either container — caller should 404.
        """
        if asset_type == "character":
            ep_list = script.characters
        elif asset_type == "scene":
            ep_list = script.scenes
        elif asset_type == "prop":
            ep_list = script.props
        else:
            return None, None
        local = next((a for a in ep_list if a.id == asset_id), None)
        if local is not None:
            return local, "script"
        # Fall back to series shared pool if this episode belongs to
        # a series.
        if script.series_id:
            series = self.get_series(script.series_id, script.owner_profile_id)
            if series:
                if asset_type == "character":
                    sh_list = series.characters
                elif asset_type == "scene":
                    sh_list = series.scenes
                else:  # prop
                    sh_list = series.props
                shared = next((a for a in sh_list if a.id == asset_id), None)
                if shared is not None:
                    return shared, "series"
            # Series miss → fall through to the global library below.
        # Fall back to the project-independent global asset library
        # (lowest layer). Empty by default, so this is a no-op until
        # the global pool is populated.
        gl_list = self._library_list_for_type(asset_type, script.owner_profile_id)
        glob = next((a for a in gl_list if a.id == asset_id), None)
        if glob is not None:
            return glob, "global"
        return None, None

    def _save_after_asset_mutation(self, source: str) -> None:
        """Persist after mutating an asset; pick the right save path
        based on which container the asset lives in (episode vs series
        vs global library)."""
        if source == "series":
            self._save_series_data()
        elif source == "global":
            self._save_library_data()
        else:
            self._save_data()

    @staticmethod
    def _normalize_asset_reference(reference: Any) -> Optional[Dict[str, str]]:
        """Normalize the public reference contract before resolving it.

        This deliberately keeps only the three stable identifiers. Provider
        URLs are never copied into an async task snapshot or provenance field.
        """
        if reference is None:
            return None
        if isinstance(reference, AssetLibraryReference):
            raw = reference.model_dump()
        elif isinstance(reference, dict):
            raw = reference
        else:
            raise InvalidAssetReference("reference must be an asset-library reference object")

        asset_type = raw.get("asset_type")
        asset_id = raw.get("asset_id")
        variant_id = raw.get("variant_id")
        if asset_type not in ("character", "scene", "prop"):
            raise InvalidAssetReference("reference.asset_type is invalid")
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise InvalidAssetReference("reference.asset_id is required")
        if not isinstance(variant_id, str) or not variant_id.strip():
            raise InvalidAssetReference("reference.variant_id is required")
        return {
            "asset_type": asset_type,
            "asset_id": asset_id.strip(),
            "variant_id": variant_id.strip(),
        }

    @classmethod
    def _normalize_asset_references(cls, references: Any) -> List[Dict[str, str]]:
        if references is None:
            return []
        if not isinstance(references, (list, tuple)):
            raise InvalidAssetReference("references must be a list")
        normalized = []
        identities = set()
        for reference in references:
            if isinstance(reference, AssetLibraryReference):
                raw = reference.model_dump()
            elif isinstance(reference, dict):
                raw = reference
            else:
                raise InvalidAssetReference("each reference must be an asset-library reference object")
            stable = cls._normalize_asset_reference(raw)
            identity = (stable["asset_type"], stable["asset_id"], stable["variant_id"])
            if identity in identities:
                raise InvalidAssetReference("duplicate asset reference")
            identities.add(identity)
            normalized.append(stable)
        return normalized

    @staticmethod
    def _validate_asset_generation_mode(image_generation_mode: str, has_references: bool) -> None:
        if image_generation_mode not in ("text", "reference"):
            raise InvalidAssetReference("image_generation_mode must be 'text' or 'reference'")
        if image_generation_mode == "text" and has_references:
            raise InvalidAssetReference("text mode cannot include reference images")
        if image_generation_mode == "reference" and not has_references:
            raise InvalidAssetReference("reference mode requires at least one reference image")

    @staticmethod
    def _asset_reference_limit(model_name: Optional[str]) -> int:
        normalized = str(model_name or "").removeprefix("uniart/")
        if normalized.startswith(("gpt-image-", "wan2.7-image", "qwen-image")):
            return 9
        if normalized == "wan2.6-image":
            return 4
        return 3

    @staticmethod
    def _asset_image_variants(asset: Any, asset_type: str) -> List[Any]:
        """Return every image variant owned by an asset.

        The character schema has a canonical ``reference_sheet`` plus legacy
        containers. Scenes and props use ``image_asset``. Keeping the legacy
        containers in the resolver allows older library records to remain
        selectable while the UI prefers the canonical sheet when present.
        """
        if asset_type == "character":
            containers = [
                getattr(asset, "reference_sheet", None),
                getattr(asset, "full_body_asset", None),
                getattr(asset, "three_view_asset", None),
                getattr(asset, "headshot_asset", None),
            ]
        else:
            containers = [getattr(asset, "image_asset", None)]

        variants: List[Any] = []
        seen_ids = set()
        for container in containers:
            if container is None:
                continue
            candidates = getattr(container, "image_variants", None)
            if candidates is None:
                candidates = getattr(container, "variants", None)
            for variant in candidates or []:
                variant_id = getattr(variant, "id", None)
                if variant_id and variant_id not in seen_ids:
                    seen_ids.add(variant_id)
                    variants.append(variant)
        return variants

    @staticmethod
    def _selected_asset_variant_id(asset: Any, asset_type: str) -> Optional[str]:
        if asset_type == "character":
            selected = getattr(getattr(asset, "reference_sheet", None), "selected_image_id", None)
            if selected:
                return selected
            for name in ("full_body_asset", "three_view_asset", "headshot_asset"):
                selected = getattr(getattr(asset, name, None), "selected_id", None)
                if selected:
                    return selected
            return None
        return getattr(getattr(asset, "image_asset", None), "selected_id", None)

    @staticmethod
    def _explicit_asset_cover_variant_id(asset: Any, asset_type: str) -> Optional[str]:
        cover_id = getattr(asset, "cover_variant_id", None)
        if cover_id and any(
            getattr(variant, "id", None) == cover_id
            for variant in ComicGenPipeline._asset_image_variants(asset, asset_type)
        ):
            return cover_id
        return None

    def get_asset_reference_index(self, script_id: str) -> AssetReferenceIndex:
        """Return the normalized effective assets used by reference pickers."""
        script = self.get_script(script_id)
        if not script:
            raise ValueError("Project not found")

        series = (
            self.get_series(script.series_id, script.owner_profile_id)
            if script.series_id
            else None
        )
        entries: List[AssetReferenceIndexEntry] = []

        def append_scope(
            asset_type: str,
            assets: List[Any],
            source_scope: str,
            source_container_id: Optional[str],
            source_name: Optional[str],
            seen: set,
        ) -> None:
            for asset in assets:
                if asset.id in seen:
                    continue
                seen.add(asset.id)
                entries.append(AssetReferenceIndexEntry(
                    asset_type=asset_type,
                    asset_id=asset.id,
                    name=asset.name,
                    description=getattr(asset, "description", "") or "",
                    starred=bool(getattr(asset, "starred", False)),
                    source_scope=source_scope,
                    source_container_id=source_container_id,
                    source_name=source_name,
                    selected_variant_id=self._selected_asset_variant_id(asset, asset_type),
                    cover_variant_id=self._explicit_asset_cover_variant_id(asset, asset_type),
                    variants=self._asset_image_variants(asset, asset_type),
                ))

        for asset_type, attr in (
            ("character", "characters"),
            ("scene", "scenes"),
            ("prop", "props"),
        ):
            seen: set = set()
            append_scope(asset_type, getattr(script, attr), "episode", script.id, script.title, seen)
            if series:
                append_scope(asset_type, getattr(series, attr), "series", series.id, series.title, seen)
            append_scope(
                asset_type,
                self._library_list_for_type(asset_type, script.owner_profile_id),
                "global",
                None,
                None,
                seen,
            )

        return AssetReferenceIndex(project_id=script.id, assets=entries)

    def get_asset_library_reference_index(self, owner_profile_id: Optional[str] = None) -> AssetReferenceIndex:
        """Return the normalized cross-container asset view for the library."""
        entries: List[AssetReferenceIndexEntry] = []

        def append_container(container: Any, scope: str, container_id: Optional[str], name: Optional[str]) -> None:
            for asset_type, attr in (("character", "characters"), ("scene", "scenes"), ("prop", "props")):
                for asset in getattr(container, attr, []) or []:
                    entries.append(AssetReferenceIndexEntry(
                        asset_type=asset_type,
                        asset_id=asset.id,
                        name=asset.name,
                        description=getattr(asset, "description", "") or "",
                        starred=bool(getattr(asset, "starred", False)),
                        source_scope=scope,
                        source_container_id=container_id,
                        source_name=name,
                        selected_variant_id=self._selected_asset_variant_id(asset, asset_type),
                        cover_variant_id=self._explicit_asset_cover_variant_id(asset, asset_type),
                        variants=self._asset_image_variants(asset, asset_type),
                    ))

        for series in self.list_series(owner_profile_id):
            append_container(series, "series", series.id, series.title)
        for script in self.list_scripts(owner_profile_id):
            if not script.series_id:
                append_container(script, "project", script.id, script.title)
        global_pool = GlobalAssetLibrary(
            characters=self._library_list_for_type("character", owner_profile_id),
            scenes=self._library_list_for_type("scene", owner_profile_id),
            props=self._library_list_for_type("prop", owner_profile_id),
        )
        append_container(global_pool, "global", None, None)
        return AssetReferenceIndex(project_id="library", assets=entries)

    @staticmethod
    def _resolve_stored_reference_value(value: str, owner_profile_id: Optional[str]) -> str:
        """Resolve a persisted variant URL/path for a provider adapter.

        HTTP URLs and OSS object keys are already provider-compatible. Local
        material is accepted only from the managed ``output`` tree and must
        exist at execution time; this prevents a stale or traversal path from
        reaching an image provider.
        """
        if value.startswith(("https://", "http://")) or is_object_key(value):
            return value

        # A signed Studio URL can be stored by an older client. Resolve it
        # through the owner boundary before turning it back into a local path.
        if value.startswith("/studio/media/") or value.startswith("studio/media/"):
            if not owner_profile_id:
                raise InvalidAssetReference("reference media requires an authenticated owner")
            try:
                return resolve_studio_reference(
                    value if value.startswith("/") else f"/{value}",
                    owner_profile_id,
                )
            except Exception as exc:
                raise InvalidAssetReference("reference variant media is invalid or expired") from exc

        candidate = os.path.realpath(
            value if value.startswith("output/") or os.path.isabs(value)
            else os.path.join("output", value)
        )
        output_root = os.path.realpath("output")
        if not candidate.startswith(output_root + os.sep) or not os.path.isfile(candidate):
            raise InvalidAssetReference("reference variant media is missing")
        return candidate

    def _resolve_asset_library_reference(
        self,
        container: Any,
        reference: Any,
    ) -> Tuple[str, Dict[str, str]]:
        """Resolve a reference against a project or series visible to its owner."""
        normalized = self._normalize_asset_reference(reference)
        if normalized is None:
            raise InvalidAssetReference("reference is required")

        asset_type = normalized["asset_type"]
        asset_id = normalized["asset_id"]
        if isinstance(container, Script):
            asset, _source = self._find_asset_with_source(container, asset_id, asset_type)
        elif isinstance(container, Series):
            if asset_type == "character":
                own_list = container.characters
            elif asset_type == "scene":
                own_list = container.scenes
            else:
                own_list = container.props
            asset = next((item for item in own_list if item.id == asset_id), None)
            if asset is None:
                asset = next(
                    (
                        item
                        for item in self._library_list_for_type(asset_type, container.owner_profile_id)
                        if item.id == asset_id
                    ),
                    None,
                )
        else:
            raise InvalidAssetReference("reference target container is invalid")

        if asset is None:
            raise InvalidAssetReference("reference asset is not visible to this owner")

        variant = next(
            (
                item
                for item in self._asset_image_variants(asset, asset_type)
                if getattr(item, "id", None) == normalized["variant_id"]
            ),
            None,
        )
        if variant is None:
            raise InvalidAssetReference(
                "reference variant does not belong to the asset "
                f"(asset_type={asset_type}, asset_id={asset_id}, "
                f"variant_id={normalized['variant_id']})"
            )
        value = getattr(variant, "url", None)
        if not isinstance(value, str) or not value.strip():
            raise InvalidAssetReference("reference variant has no image material")
        resolved = self._resolve_stored_reference_value(
            value.strip(),
            getattr(container, "owner_profile_id", None),
        )
        return resolved, normalized

    def toggle_asset_lock(self, script_id: str, asset_id: str, asset_type: str) -> Script:
        """Toggle the locked status of an asset. Works on both
        episode-local and series-shared assets (A2 decision: default
        write to series, since locking a shared character should
        affect all episodes that use it)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        # Toggle the locked status
        target_asset.locked = not target_asset.locked
        self._save_after_asset_mutation(source)
        return script

    def toggle_asset_starred(self, script_id: str, asset_id: str, asset_type: str) -> Script:
        """Toggle the starred (asset-library shortlist) status of an asset.
        Mirrors toggle_asset_lock — works on both episode-local and
        series-shared assets via _find_asset_with_source."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        target_asset.starred = not target_asset.starred
        self._save_after_asset_mutation(source)
        return script

    def toggle_project_starred(self, script_id: str) -> Script:
        """Toggle the user-starred (featured shortlist) flag on a project.
        Starred projects get the amber-halation 'featured' treatment in the
        gallery. Mirrors toggle_asset_starred but at the Script level. The
        read-modify-write is wrapped in _save_lock so the toggle is atomic."""
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            script.starred = not script.starred
            self._save_data()
            return script

    def toggle_frame_lock(self, script_id: str, frame_id: str) -> Script:
        """Toggle the locked status of a frame."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_frame = next((f for f in script.frames if f.id == frame_id), None)
        if not target_frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        # Toggle the locked status
        target_frame.locked = not target_frame.locked
        self._save_data()
        return script

    def update_asset_image(self, script_id: str, asset_id: str, asset_type: str, image_url: str) -> Script:
        """Updates the image URL of an asset manually. Per A2 decision,
        series-shared assets are updated in place (shared semantics);
        episode-local assets are updated locally."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        target_asset.image_url = image_url
        # For characters, also update avatar if it's not set or if we want to sync them
        # For now, let's assume the uploaded image is the main reference.
        # If it's a character, we might want to set avatar_url to the same image for simplicity
        if asset_type == "character":
            target_asset.avatar_url = image_url

        self._save_after_asset_mutation(source)
        return script

    def update_asset_description(self, script_id: str, asset_id: str, asset_type: str, description: str) -> Script:
        """Updates the description of an asset."""
        return self.update_asset_attributes(script_id, asset_id, asset_type, {"description": description})

    def update_asset_attributes(self, script_id: str, asset_id: str, asset_type: str, attributes: Dict[str, Any]) -> Script:
        """Updates arbitrary attributes of an asset. Routes the write
        to either the episode-local or the parent series' shared copy
        depending on which container owns the asset (A2 decision)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        # Update attributes
        for key, value in attributes.items():
            if hasattr(target_asset, key):
                setattr(target_asset, key, value)
            else:
                logger.warning(f"Attribute {key} not found in {asset_type} model")

        self._save_after_asset_mutation(source)
        return script

    def add_uploaded_asset_variant(
        self, 
        script_id: str, 
        asset_type: str, 
        asset_id: str, 
        upload_type: str, 
        image_url: str, 
        description: Optional[str] = None
    ) -> Script:
        """
        Adds an uploaded image as a new variant to an asset.
        The uploaded image is marked with is_uploaded_source=True.
        
        Args:
            script_id: The project ID
            asset_type: "character", "scene", or "prop"
            asset_id: The asset ID
            upload_type: "full_body", "head_shot", "three_views", or "image"
            image_url: URL of the uploaded image (OSS Object Key)
            description: Optional modified description for reverse generation
        """
        from .models import ImageVariant, AssetUnit
        
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)

        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        
        # Create new variant with upload source flag
        new_variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used=description or target_asset.description,
            is_uploaded_source=True,
            upload_type=upload_type,
            source_origin="upload",
        )
        
        # Update description if provided
        if description:
            target_asset.description = description
        
        # Add variant to the appropriate asset unit
        if asset_type == "character":
            # Map upload_type to the correct asset unit
            if upload_type == "reference_sheet":
                target_unit = target_asset.reference_sheet
            elif upload_type == "full_body":
                target_unit = target_asset.full_body
            elif upload_type == "head_shot":
                target_unit = target_asset.head_shot
            elif upload_type == "three_views":
                target_unit = target_asset.three_views
            else:
                raise ValueError(f"Invalid upload_type for character: {upload_type}")
            
            # Ensure AssetUnit exists
            if target_unit is None:
                target_unit = AssetUnit()
                if upload_type == "reference_sheet":
                    target_asset.reference_sheet = target_unit
                elif upload_type == "full_body":
                    target_asset.full_body = target_unit
                elif upload_type == "head_shot":
                    target_asset.head_shot = target_unit
                elif upload_type == "three_views":
                    target_asset.three_views = target_unit
            
            # Add variant and select it
            target_unit.image_variants.append(new_variant)
            target_unit.selected_image_id = new_variant.id
            target_unit.image_updated_at = time.time()
            if upload_type == "reference_sheet":
                target_asset.image_url = image_url
            
            # === ALSO UPDATE LEGACY FIELDS for frontend compatibility ===
            # Create variant for legacy ImageAsset structure
            legacy_variant = ImageVariant(
                id=new_variant.id,
                url=image_url,
                prompt_used=description or target_asset.description,
                is_uploaded_source=True,
                upload_type=upload_type,
                source_origin="upload",
            )
            
            if upload_type == "full_body":
                # Ensure full_body_asset exists
                if target_asset.full_body_asset is None:
                    from .models import ImageAsset
                    target_asset.full_body_asset = ImageAsset()
                target_asset.full_body_asset.variants.append(legacy_variant)
                target_asset.full_body_asset.selected_id = new_variant.id
                target_asset.full_body_image_url = image_url
            elif upload_type == "head_shot":
                # Ensure headshot_asset exists
                if target_asset.headshot_asset is None:
                    from .models import ImageAsset
                    target_asset.headshot_asset = ImageAsset()
                target_asset.headshot_asset.variants.append(legacy_variant)
                target_asset.headshot_asset.selected_id = new_variant.id
                target_asset.headshot_image_url = image_url
            elif upload_type == "three_views":
                # Ensure three_view_asset exists
                if target_asset.three_view_asset is None:
                    from .models import ImageAsset
                    target_asset.three_view_asset = ImageAsset()
                target_asset.three_view_asset.variants.append(legacy_variant)
                target_asset.three_view_asset.selected_id = new_variant.id
                target_asset.three_view_image_url = image_url
            
            logger.info(f"Added uploaded variant {new_variant.id} to character {asset_id} {upload_type}")
            
        elif asset_type in ["scene", "prop"]:
            from .models import ImageAsset
            if target_asset.image_asset is None:
                target_asset.image_asset = ImageAsset()
            target_asset.image_asset.variants.append(new_variant)
            target_asset.image_asset.selected_id = new_variant.id

            # Also update legacy image_url field
            target_asset.image_url = image_url
            
            logger.info(f"Added uploaded variant {new_variant.id} to {asset_type} {asset_id}")

        # An uploaded, selected reference is already a usable asset.  Keep the
        # generation status in sync with the canonical image container so
        # callers do not require a redundant AI generation before treating the
        # upload as ready.  This applies equally to project, series, and global
        # assets because `_find_asset_with_source` has already resolved the
        # owning container above.
        target_asset.status = GenerationStatus.COMPLETED
        
        self._save_after_asset_mutation(source)
        return script

    def update_project_style(self, script_id: str, style_preset: str, style_prompt: Optional[str] = None) -> Script:
        """Updates the global style settings for a project."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        script.style_preset = style_preset
        script.style_prompt = style_prompt
        script.updated_at = time.time()
        self._save_data()
        return script
    
    def save_art_direction(self, script_id: str, selected_style_id: str, style_config: Dict[str, Any], custom_styles: List[Dict[str, Any]] = None, ai_recommendations: List[Dict[str, Any]] = None) -> Script:
        """Saves the Art Direction configuration."""
        from .models import ArtDirection
        
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        effective_before_save = self.effective_art_direction(script)
        # Create Art Direction object
        art_direction = ArtDirection(
            selected_style_id=selected_style_id,
            style_config=style_config,
            custom_styles=custom_styles or [],
            ai_recommendations=ai_recommendations or [],
            director_profile=effective_before_save.director_profile if effective_before_save else None,
        )
        
        script.art_direction = art_direction
        script.updated_at = time.time()
        self._save_data()
        return script

    def effective_art_direction(self, script: Script) -> Optional[ArtDirection]:
        resolved = script.art_direction
        if not resolved and script.series_id:
            series = self.series_store.get(script.series_id)
            resolved = series.art_direction if series else None
        return ArtDirection(**resolved) if isinstance(resolved, dict) else resolved

    def effective_director_profile(self, script: Script) -> Optional[DirectorProfile]:
        art_direction = self.effective_art_direction(script)
        return art_direction.director_profile if art_direction else None

    def storyboard_visual_style(self, script: Script) -> Dict[str, Any]:
        """Return the stable project-level style contract used across storyboard frames."""
        art_direction = self.effective_art_direction(script)
        if art_direction:
            return {
                "selected_style_id": art_direction.selected_style_id,
                "style_config": art_direction.style_config,
            }
        return {
            "style_preset": script.style_preset,
            "style_prompt": script.style_prompt,
        }

    def director_prompt_context(
        self,
        script: Script,
        subject_ids: Optional[List[str]] = None,
        *,
        director_profile: Any = _DIRECTOR_PROFILE_UNSET,
        execution_context: Any = _DIRECTOR_CONTEXT_UNSET,
    ) -> str:
        profile = (
            self.effective_director_profile(script)
            if director_profile is _DIRECTOR_PROFILE_UNSET
            else director_profile
        )
        if execution_context is _DIRECTOR_CONTEXT_UNSET:
            execution_context = self.director_execution_context(script, subject_ids=subject_ids)
        if not profile and not execution_context:
            return ""
        payload = execution_context or {}
        return (
            f"Director profile revision: {profile.revision if profile else 'none'}. Treat confirmed "
            "director decisions as execution context. Script fact ledger entries carry explicit "
            "evidence_status; uncertain or conflicted entries must not be treated as established facts. "
            "Ranges use zero-based Unicode code points and [start, end). "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        )

    def generation_lineage(
        self,
        script: Script,
        director_profile: Optional[DirectorProfile] = None,
        execution_context: Optional[Dict[str, Any]] = None,
        source_range: Optional[Tuple[int, int]] = None,
        *,
        pinned: bool = True,
    ) -> ArtifactLineage:
        """Capture only revision references that were available to this generation call."""
        if not pinned:
            return ArtifactLineage(status="legacy_unpinned")

        source_revision_id = self.source_revision_id(script, script.source_revision)
        ledger = (execution_context or {}).get("script_fact_ledger") or {}
        ledger_status = ledger.get("status", "none")
        fact_ids: List[str] = []
        source_ranges: List[SourceRange] = []
        if source_range:
            source_ranges.append(SourceRange(start=source_range[0], end=source_range[1]))
        if ledger_status == "current":
            for fact in ledger.get("facts", []):
                if fact.get("fact_id"):
                    fact_ids.append(fact["fact_id"])
                for span in fact.get("source_ranges", []):
                    source_ranges.append(SourceRange(**span))

        unique_ranges = {
            (span.start, span.end): span for span in source_ranges
        }
        return ArtifactLineage(
            status="pinned",
            source_revision=script.source_revision,
            source_revision_id=source_revision_id,
            director_profile_revision=(director_profile.revision if director_profile else None),
            director_profile_hash=(director_profile.content_hash if director_profile else None),
            fact_ledger_revision=ledger.get("ledger_revision"),
            fact_ledger_source_revision_id=ledger.get("source_revision_id"),
            fact_ledger_status=ledger_status,
            fact_ids=list(dict.fromkeys(fact_ids))[:40],
            source_ranges=list(unique_ranges.values())[:40],
        )

    def storyboard_analysis_lineage(self, script_id: str, text: str) -> ArtifactLineage:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        source_range = self._source_range_for_text(script, text)
        profile = self.effective_director_profile(script)
        execution_context = self.director_execution_context(
            script, source_range=source_range, director_profile=profile,
        )
        return self.generation_lineage(
            script, profile, execution_context, source_range,
        )

    def validate_storyboard_lineage(
        self,
        script_id: str,
        text: str,
        lineage: ArtifactLineage,
    ) -> None:
        """Reject applying a pinned draft after any pinned upstream revision changes."""
        if lineage.status != "pinned":
            return
        current = self.storyboard_analysis_lineage(script_id, text)
        pinned_fields = (
            "source_revision", "source_revision_id", "director_profile_revision",
            "director_profile_hash", "fact_ledger_revision",
            "fact_ledger_source_revision_id", "fact_ledger_status",
        )
        changed = [
            field for field in pinned_fields
            if getattr(lineage, field) != getattr(current, field)
        ]
        if changed:
            raise StaleStoryboardDraftError(
                "Storyboard draft lineage is stale; upstream revisions changed: "
                + ", ".join(changed)
            )

    def director_execution_context(
        self,
        script: Script,
        source_range: Optional[Tuple[int, int]] = None,
        subject_ids: Optional[List[str]] = None,
        director_profile: Any = _DIRECTOR_PROFILE_UNSET,
    ) -> Optional[Dict[str, Any]]:
        """Return bounded, version-pinned Director and approved fact context."""
        profile = (
            self.effective_director_profile(script)
            if director_profile is _DIRECTOR_PROFILE_UNSET
            else director_profile
        )
        ledger_context = self._fact_ledger_execution_context(
            script,
            source_range=source_range,
            subject_ids=subject_ids,
        )
        if not profile and ledger_context is None:
            return None
        payload = director_execution_payload(profile) if profile else {}
        if ledger_context is not None:
            payload["script_fact_ledger"] = ledger_context
        return payload

    @staticmethod
    def _fact_ledger_execution_context(
        script: Script,
        source_range: Optional[Tuple[int, int]] = None,
        subject_ids: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Build a bounded projection of the approved ledger for one stage call."""
        if not script.fact_ledger_revision:
            return None
        current = script.fact_ledger_revisions[-1] if script.fact_ledger_revisions else None
        if current is None or current.revision != script.fact_ledger_revision:
            return {
                "status": "unavailable",
                "ledger_revision": script.fact_ledger_revision or None,
                "reason": "ledger_snapshot_missing",
                "facts": [],
            }
        if current.source_revision != script.source_revision:
            return {
                "status": "stale",
                "ledger_revision": current.revision,
                "source_revision": current.source_revision,
                "source_revision_id": current.source_revision_id,
                "current_source_revision": script.source_revision,
                "facts": [],
            }
        wanted = set(subject_ids or [])
        facts = []
        truncated = False
        for fact in current.facts:
            if fact.evidence_status == "rejected":
                continue
            if wanted and fact.subject_ids and not wanted.intersection(fact.subject_ids):
                continue
            if source_range and fact.source_ranges:
                start, end = source_range
                if not any(span.start < end and start < span.end for span in fact.source_ranges):
                    continue
            projected = fact.model_dump()
            candidate = facts + [projected]
            if len(candidate) > 40 or len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))) > 7200:
                truncated = True
                break
            facts.append(projected)
        return {
            "status": "current",
            "ledger_revision": current.revision,
            "source_revision": current.source_revision,
            "source_revision_id": current.source_revision_id,
            "facts": facts,
            "truncated": truncated,
        }

    @staticmethod
    def _source_range_for_text(script: Script, text: str) -> Optional[Tuple[int, int]]:
        if not text:
            return None
        first = script.original_text.find(text)
        if first < 0 or script.original_text.find(text, first + 1) >= 0:
            return None
        return first, first + len(text)

    def director_analysis_context(self, script_id: str) -> Tuple[Script, Dict[str, Any], Dict[str, Any]]:
        script, entities, _ = self.storyboard_analysis_context(script_id)
        art_direction = self.effective_art_direction(script)
        style = art_direction.style_config if art_direction else {}
        return script, entities, style

    def preview_director_profile(self, script_id: str) -> Dict[str, Any]:
        script, entities, style = self.director_analysis_context(script_id)
        draft = self.script_processor.analyze_director_profile(script.original_text, entities, style)
        normalized = normalize_director_profile_draft(draft)
        self._bind_director_story_map(script, entities, normalized)
        DirectorProfile(**normalized)
        self._validate_director_story_map(script, normalized.get("story_map"))
        return normalized

    def refine_director_profile(self, script_id: str, draft: Dict[str, Any],
                                instructions: List[str]) -> Dict[str, Any]:
        script, entities, style = self.director_analysis_context(script_id)
        normalized_draft = normalize_director_profile_draft(draft)
        self._bind_director_story_map(script, entities, normalized_draft)
        DirectorProfile(**normalized_draft)
        self._validate_director_story_map(script, normalized_draft.get("story_map"))
        revised_patch = self.script_processor.refine_director_profile(
            script.original_text, entities, style, normalized_draft, instructions
        )
        normalized_result = merge_director_profile_patch(normalized_draft, revised_patch)
        self._bind_director_story_map(script, entities, normalized_result)
        DirectorProfile(**normalized_result)
        self._validate_director_story_map(script, normalized_result.get("story_map"))
        return normalized_result

    @staticmethod
    def _director_story_people(characters: List[Any]) -> List[Dict[str, Any]]:
        """Group visual character variants under their stable base character ID."""
        by_id = {str(getattr(item, "id", "")): item for item in characters if getattr(item, "id", None)}
        grouped: Dict[str, Dict[str, Any]] = {}
        for character in characters:
            character_id = str(getattr(character, "id", "") or "")
            if not character_id:
                continue
            person_id = str(getattr(character, "base_character_id", None) or character_id)
            base = by_id.get(person_id, character)
            display_name = (
                getattr(base, "persona", "")
                or getattr(base, "name", "")
                or getattr(character, "persona", "")
                or getattr(character, "name", "")
                or person_id
            )
            entry = grouped.setdefault(person_id, {
                "person_id": person_id,
                "display_name": str(display_name),
                "variant_character_ids": [],
            })
            if character_id not in entry["variant_character_ids"]:
                entry["variant_character_ids"].append(character_id)
        return sorted(grouped.values(), key=lambda item: item["display_name"])

    def _bind_director_story_map(
        self,
        script: Script,
        entities: Dict[str, Any],
        profile: Dict[str, Any],
    ) -> None:
        """Bind a current story map to server-owned source and character IDs."""
        story_map = profile.get("story_map")
        if story_map is None:
            return
        if not isinstance(story_map, dict):
            raise ValueError("story_map must be an object")
        story_map = dict(story_map)
        source_revision = story_map.get("source_revision")
        if source_revision is not None and source_revision != script.source_revision:
            raise ValueError("Story map source revision changed; refresh it before saving")
        source_revision_id = self.source_revision_id(script, script.source_revision)
        supplied_source_id = story_map.get("source_revision_id")
        if supplied_source_id and supplied_source_id != source_revision_id:
            raise ValueError("Story map source revision identity does not match the current script")
        story_map["schema_version"] = 1
        story_map["source_revision"] = script.source_revision
        story_map["source_revision_id"] = source_revision_id
        story_map.setdefault("fact_ledger_revision", None)
        story_map["people"] = self._director_story_people(entities.get("characters", []))
        profile["story_map"] = story_map

    def _validate_director_story_map(self, script: Script, value: Any) -> None:
        if value is None:
            return
        story_map = value.model_dump() if hasattr(value, "model_dump") else value
        if not isinstance(story_map, dict):
            raise ValueError("story_map must be an object")
        source_revision = story_map.get("source_revision")
        if source_revision != script.source_revision:
            raise ValueError("Story map source revision changed; regenerate or refresh the Director interpretation")
        expected_source_id = self.source_revision_id(script, script.source_revision)
        if story_map.get("source_revision_id") != expected_source_id:
            raise ValueError("Story map source revision identity does not match the current script")

        resolved = self.resolve_episode_assets(script)
        available_characters = resolved.get("characters", [])
        valid_people = {
            item["person_id"]: set(item["variant_character_ids"])
            for item in self._director_story_people(available_characters)
        }
        people = story_map.get("people", [])
        for person in people:
            person_id = person.get("person_id")
            if person_id not in valid_people:
                raise ValueError(f"Story map references unknown person {person_id}")
            if not set(person.get("variant_character_ids", [])).issubset(valid_people[person_id]):
                raise ValueError(f"Story map person {person_id} references an unknown character variant")

        referenced_fact_ids = set()
        for phase in story_map.get("phases", []):
            for event in phase.get("events", []):
                referenced_fact_ids.update(event.get("source_fact_ids", []))
        for arc in story_map.get("relationship_arcs", []):
            for state in arc.get("states", []):
                referenced_fact_ids.update(state.get("source_fact_ids", []))
        if not referenced_fact_ids:
            return

        ledger_revision = story_map.get("fact_ledger_revision")
        snapshot = next((
            item for item in script.fact_ledger_revisions
            if item.revision == ledger_revision
        ), None)
        if snapshot is None or snapshot.source_revision != script.source_revision:
            raise ValueError("Story map fact citations must reference a confirmed ledger for the current script revision")
        facts_by_id = {fact.fact_id: fact for fact in snapshot.facts}
        missing = referenced_fact_ids - set(facts_by_id)
        if missing:
            raise ValueError("Story map references facts absent from its pinned ledger: " + ", ".join(sorted(missing)))
        rejected = [
            fact_id for fact_id in referenced_fact_ids
            if facts_by_id[fact_id].evidence_status == "rejected"
        ]
        if rejected:
            raise ValueError("Story map cannot cite rejected facts: " + ", ".join(sorted(rejected)))

        explicit_fact_ids = {
            fact_id
            for phase in story_map.get("phases", [])
            for event in phase.get("events", [])
            if event.get("evidence_status") == "explicit"
            for fact_id in event.get("source_fact_ids", [])
        } | {
            fact_id
            for arc in story_map.get("relationship_arcs", [])
            for state in arc.get("states", [])
            if state.get("evidence_status") == "explicit"
            for fact_id in state.get("source_fact_ids", [])
        }
        unconfirmed = [
            fact_id for fact_id in explicit_fact_ids
            if facts_by_id[fact_id].evidence_status != "confirmed"
        ]
        if unconfirmed:
            raise ValueError("Explicit story-map claims must cite confirmed facts: " + ", ".join(sorted(unconfirmed)))

    @staticmethod
    def _validate_director_story_map_for_confirmation(value: Any) -> None:
        """Allow incomplete maps to be saved as drafts, but not confirmed."""
        if value is None:
            return
        story_map = value.model_dump() if hasattr(value, "model_dump") else value
        phases = story_map.get("phases", [])
        if not phases:
            raise ValueError("Add at least one story phase before confirming the story map")
        events = [event for phase in phases for event in phase.get("events", [])]
        if not events:
            raise ValueError("Add at least one story event before confirming the story map")
        for phase in phases:
            if not str(phase.get("label", "")).strip():
                raise ValueError("Name every story phase before confirming the story map")
            for event in phase.get("events", []):
                if not str(event.get("description", "")).strip():
                    raise ValueError("Describe every story event before confirming the story map")
                if event.get("evidence_status") == "explicit" and not event.get("source_fact_ids"):
                    raise ValueError("Explicit story events must link confirmed Fact Ledger entries")
        for arc in story_map.get("relationship_arcs", []):
            for state in arc.get("states", []):
                if state.get("evidence_status") == "explicit" and not state.get("source_fact_ids"):
                    raise ValueError("Explicit relationship states must link confirmed Fact Ledger entries")
        for thread in story_map.get("story_threads", []):
            if not str(thread.get("label", "")).strip():
                raise ValueError("Name every story thread before confirming the story map")

    @staticmethod
    def _shooting_plan_content(plan: Any) -> Dict[str, Any]:
        if plan is None:
            return {}
        return plan.model_dump(exclude={"generated_at"}) if hasattr(plan, "model_dump") else {
            key: value for key, value in plan.items() if key != "generated_at"
        }

    def director_shooting_plan_lineage(self, script_id: str) -> Dict[str, Any]:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        profile = self.effective_director_profile(script)
        if profile is None:
            raise ValueError("Confirm a Director interpretation before generating a shooting plan")
        if profile.story_map is None:
            raise ValueError("Create and confirm the visual story map before generating a shooting plan")
        if profile.story_map.source_revision != script.source_revision:
            raise ValueError("The confirmed story map is stale; re-confirm Director interpretation first")
        if profile.story_map.source_revision_id != self.source_revision_id(script, script.source_revision):
            raise ValueError("The confirmed story map source content is stale; re-confirm Director interpretation first")
        style = self.storyboard_visual_style(script)
        style_hash = hashlib.sha256(json.dumps(
            style, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()).hexdigest()
        return {
            "source_revision": script.source_revision,
            "source_revision_id": self.source_revision_id(script, script.source_revision),
            "director_profile_revision": profile.revision,
            "director_profile_hash": profile.content_hash,
            "effective_style_hash": style_hash,
        }

    def _validate_director_shooting_plan(self, script: Script, value: Any) -> DirectorShootingPlan:
        plan = value if isinstance(value, DirectorShootingPlan) else DirectorShootingPlan(**value)
        profile = self.effective_director_profile(script)
        if profile is None or profile.story_map is None:
            raise ValueError("A confirmed Director story map is required for the shooting plan")
        expected = self.director_shooting_plan_lineage(script.id)
        for key, current_value in expected.items():
            if getattr(plan, key) != current_value:
                raise ValueError(f"Shooting plan lineage is stale: {key} changed")
        valid_event_ids = {
            event.event_id for phase in profile.story_map.phases for event in phase.events
        }
        requested_event_ids = {
            event_id for scene in plan.scenes for beat in scene.beats for event_id in beat.story_event_ids
        }
        missing_events = requested_event_ids - valid_event_ids
        if missing_events:
            raise ValueError("Shooting plan references unknown Director story events: " + ", ".join(sorted(missing_events)))

        available_entities = self.resolve_episode_assets(script)
        available_characters = {character.id for character in available_entities["characters"]}
        requested_characters = {
            character_id
            for scene in plan.scenes
            for beat in scene.beats
            for shot in beat.shots
            for character_id in shot.character_ids
        }
        missing_characters = requested_characters - available_characters
        if missing_characters:
            raise ValueError("Shooting plan references unavailable character variants: " + ", ".join(sorted(missing_characters)))

        available_props = {prop.id for prop in available_entities["props"]}
        requested_props = {
            prop_id
            for scene in plan.scenes
            for prop_id in scene.prop_ids
        } | {
            prop_id
            for scene in plan.scenes
            for beat in scene.beats
            for shot in beat.shots
            for prop_id in shot.prop_ids
        }
        missing_props = requested_props - available_props
        if missing_props:
            raise ValueError("Shooting plan references unavailable props: " + ", ".join(sorted(missing_props)))

        from .llm import split_director_source
        allowed_source_refs = {
            item["source_ref"] for item in split_director_source(
                script.original_text, direct_max_chars=4500, target_chars=4000, max_chars=4500,
            )
        }
        requested_source_refs = {
            source_ref for scene in plan.scenes for source_ref in scene.source_chunk_refs
        }
        unknown_source_refs = requested_source_refs - allowed_source_refs
        if unknown_source_refs:
            raise ValueError("Shooting plan references unknown script source chunks: " + ", ".join(sorted(unknown_source_refs)))
        return plan

    def preview_director_shooting_plan(
        self,
        script_id: str,
        *,
        load_batches=None,
        save_batch=None,
        expected_lineage: Optional[Dict[str, Any]] = None,
    ) -> DirectorShootingPlan:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        lineage = self.director_shooting_plan_lineage(script_id)
        if expected_lineage and expected_lineage != lineage:
            raise ValueError("Shooting plan inputs changed before generation started")
        profile = self.effective_director_profile(script)
        assert profile is not None and profile.story_map is not None
        resolved = self.resolve_episode_assets(script)
        entities = {
            "characters": [{
                "id": item.id,
                "name": item.name,
                "persona": item.persona,
                "base_character_id": item.base_character_id,
                "description": item.description,
            } for item in resolved["characters"]],
            "scenes": [{"id": item.id, "name": item.name, "description": item.description} for item in resolved["scenes"]],
            "props": [{"id": item.id, "name": item.name, "description": item.description} for item in resolved["props"]],
        }
        from .llm import split_director_source
        chunks = split_director_source(
            script.original_text, direct_max_chars=4500, target_chars=4000, max_chars=4500,
        )
        cached = load_batches() if load_batches else {}
        scenes: List[Dict[str, Any]] = []
        unresolved_questions: List[str] = []
        for index, chunk in enumerate(chunks):
            if self.director_shooting_plan_lineage(script_id) != lineage:
                raise ValueError("Shooting plan inputs changed during generation")
            prior = cached.get(index)
            cached_payload = prior.get("frames") if isinstance(prior, dict) else None
            if isinstance(cached_payload, dict) and isinstance(cached_payload.get("result"), dict):
                cached_result = cached_payload["result"]
            elif isinstance(prior, dict) and isinstance(prior.get("result"), dict):
                # Accept the early in-process cache shape while no durable rows
                # from this implementation have shipped.
                cached_result = prior["result"]
            else:
                cached_result = None
            if prior and prior.get("source_ref") == chunk["source_ref"] and cached_result is not None:
                chunk_result = cached_result
            else:
                previous_scene = None
                if scenes:
                    last = scenes[-1]
                    previous_scene = {
                        "scene_ref": last["scene_ref"],
                        "heading": last["heading"],
                        "location": last["location"],
                        "time_anchor": last["time_anchor"],
                        "environment_atmosphere": last["environment_atmosphere"],
                        "last_beat": last["beats"][-1]["title"] if last["beats"] else "",
                    }
                chunk_result = self.script_processor.plan_director_shooting_chunk(
                    chunk["text"],
                    entities,
                    director_execution_payload(profile),
                    self.storyboard_visual_style(script),
                    previous_scene,
                    source_ref=chunk["source_ref"],
                )
                chunk_error = ScriptProcessor._validate_director_shooting_chunk(chunk_result)
                if chunk_error:
                    raise RuntimeError(
                        f"拍摄计划分析第 {index + 1}/{len(chunks)} 段未通过镜头契约校验：{chunk_error}"
                    )
                if save_batch and not save_batch(index, chunk["source_ref"], {"result": chunk_result}):
                    raise RuntimeError("拍摄计划任务已过期，请重试。")
            if ScriptProcessor._validate_director_shooting_chunk(chunk_result):
                raise RuntimeError(f"拍摄计划缓存段 {index + 1}/{len(chunks)} 已不符合当前镜头契约，请重新生成。")

            chunk_questions = chunk_result.get("unresolved_questions", [])
            if isinstance(chunk_questions, list):
                unresolved_questions.extend(str(item)[:500] for item in chunk_questions[:20] if str(item).strip())
            raw_scenes = chunk_result.get("scenes", [])
            if not raw_scenes:
                raise RuntimeError(f"拍摄计划分析第 {index + 1}/{len(chunks)} 段没有返回场景。")
            for scene_index, raw_scene in enumerate(raw_scenes):
                if not isinstance(raw_scene, dict):
                    raise RuntimeError("拍摄计划场景必须是对象。")
                continuation = raw_scene.get("continues_previous_scene") is True and scene_index == 0 and bool(scenes)
                if continuation:
                    target = scenes[-1]
                    target["source_chunk_refs"].append(chunk["source_ref"])
                    target["source_chunk_refs"] = list(dict.fromkeys(target["source_chunk_refs"]))
                    if not target["heading"]:
                        target["heading"] = str(raw_scene.get("heading", ""))[:240]
                    if not target["location"]:
                        target["location"] = str(raw_scene.get("location", ""))[:240]
                    if not target["time_anchor"]:
                        target["time_anchor"] = str(raw_scene.get("time_anchor", ""))[:160]
                    if not target["environment_atmosphere"]:
                        target["environment_atmosphere"] = str(raw_scene.get("environment_atmosphere", ""))[:1600]
                    if not target["continuity_in"]:
                        target["continuity_in"] = str(raw_scene.get("continuity_in", ""))[:1200]
                    if raw_scene.get("continuity_out"):
                        target["continuity_out"] = str(raw_scene.get("continuity_out", ""))[:1200]
                    if target["duration_seconds"] is None and isinstance(raw_scene.get("duration_seconds"), int):
                        target["duration_seconds"] = raw_scene["duration_seconds"]
                    beat_offset = len(target["beats"])
                else:
                    target = {
                        "scene_id": f"plan-scene-{uuid.uuid4().hex}",
                        "order": len(scenes),
                        "scene_ref": str(raw_scene.get("scene_ref", ""))[:240],
                        "heading": str(raw_scene.get("heading", ""))[:240],
                        "location": str(raw_scene.get("location", ""))[:240],
                        "time_anchor": str(raw_scene.get("time_anchor", ""))[:160],
                        "environment_atmosphere": str(raw_scene.get("environment_atmosphere", ""))[:1600],
                        "continues_previous_scene": continuation,
                        "continuity_in": str(raw_scene.get("continuity_in", ""))[:1200],
                        "continuity_out": str(raw_scene.get("continuity_out", ""))[:1200],
                        "duration_seconds": raw_scene.get("duration_seconds") if isinstance(raw_scene.get("duration_seconds"), int) else None,
                        "unresolved_questions": [],
                        "source_chunk_refs": [chunk["source_ref"]],
                        "prop_ids": [],
                        "beats": [],
                    }
                    scenes.append(target)
                    beat_offset = 0
                questions = raw_scene.get("unresolved_questions", [])
                if isinstance(questions, list):
                    target["unresolved_questions"].extend(str(item)[:500] for item in questions[:20] if str(item).strip())
                scene_prop_ids = raw_scene.get("prop_ids", [])
                if isinstance(scene_prop_ids, list):
                    target["prop_ids"] = list(dict.fromkeys(target["prop_ids"] + scene_prop_ids))
                raw_beats = raw_scene.get("beats", [])
                if not isinstance(raw_beats, list):
                    raise RuntimeError("拍摄计划的 beats 必须是数组。")
                for beat_index, raw_beat in enumerate(raw_beats):
                    if not isinstance(raw_beat, dict):
                        raise RuntimeError("拍摄计划 beat 必须是对象。")
                    raw_shots = raw_beat.get("shots", [])
                    if not isinstance(raw_shots, list):
                        raise RuntimeError("拍摄计划的 shots 必须是数组。")
                    beat = {
                        "beat_id": f"plan-beat-{uuid.uuid4().hex}",
                        "order": beat_offset + beat_index,
                        "title": str(raw_beat.get("title", ""))[:180],
                        "dramatic_purpose": str(raw_beat.get("dramatic_purpose", ""))[:1200],
                        "emotional_change": str(raw_beat.get("emotional_change", ""))[:1000],
                        "duration_seconds": raw_beat.get("duration_seconds") if isinstance(raw_beat.get("duration_seconds"), int) else None,
                        "keep_with_next": raw_beat.get("keep_with_next") is True,
                        "source_chunk_refs": [chunk["source_ref"]],
                        "story_event_ids": raw_beat.get("story_event_ids", []),
                        "shots": [],
                    }
                    for shot_index, raw_shot in enumerate(raw_shots):
                        if not isinstance(raw_shot, dict):
                            raise RuntimeError("拍摄计划 shot 必须是对象。")
                        dialogue = raw_shot.get("dialogue", [])
                        if not isinstance(dialogue, list):
                            raise RuntimeError("shot dialogue 必须是数组。")
                        beat["shots"].append({
                            "shot_id": f"plan-shot-{uuid.uuid4().hex}",
                            "order": shot_index,
                            "title": str(raw_shot.get("title", ""))[:180],
                            "visual_intent": str(raw_shot.get("visual_intent", ""))[:2400],
                            "performance_action": str(raw_shot.get("performance_action", ""))[:2400],
                            "action_physics": str(raw_shot.get("action_physics", ""))[:1800],
                            "shot_size": str(raw_shot.get("shot_size", ""))[:64],
                            "camera_angle": str(raw_shot.get("camera_angle", ""))[:120],
                            "composition": str(raw_shot.get("composition", ""))[:1200],
                            "camera_movement": str(raw_shot.get("camera_movement", ""))[:500],
                            "lighting": raw_shot.get("lighting", {}),
                            "duration_seconds": raw_shot.get("duration_seconds"),
                            "dialogue": dialogue,
                            "ambient_sound": str(raw_shot.get("ambient_sound", ""))[:1000],
                            "character_ids": raw_shot.get("character_ids", []),
                            "prop_ids": raw_shot.get("prop_ids", []),
                        })
                    target["beats"].append(beat)
        if not scenes:
            raise RuntimeError("Director shooting-plan analysis returned no scenes")
        plan = DirectorShootingPlan(
            **lineage,
            scenes=scenes,
            unresolved_questions=list(dict.fromkeys(unresolved_questions))[:80],
            generated_at=time.time(),
        )
        return self._validate_director_shooting_plan(script, plan)

    @staticmethod
    def _validate_director_shooting_plan_for_confirmation(value: DirectorShootingPlan) -> None:
        if not value.scenes:
            raise ValueError("Add at least one scene before confirming the shooting plan")
        for scene in value.scenes:
            if not scene.scene_ref.strip():
                raise ValueError("Name every scene before confirming the shooting plan")
            if not scene.environment_atmosphere.strip():
                raise ValueError("Describe the scene environment and atmosphere before confirming")
            if not scene.source_chunk_refs:
                raise ValueError("Link every scene to at least one source chunk before confirming")
            if not scene.beats:
                raise ValueError("Add at least one dramatic beat to every scene before confirming")
            for beat in scene.beats:
                if not beat.title.strip() or not beat.dramatic_purpose.strip():
                    raise ValueError("Describe each dramatic beat before confirming the shooting plan")
                if not beat.shots:
                    raise ValueError("Add at least one shot to every beat before confirming")
                for shot in beat.shots:
                    missing = [
                        name for name, text in (
                            ("visual intent", shot.visual_intent),
                            ("character performance", shot.performance_action),
                            ("physical action", shot.action_physics),
                            ("shot size", shot.shot_size),
                            ("camera angle", shot.camera_angle),
                            ("composition", shot.composition),
                            ("camera movement", shot.camera_movement),
                            ("ambient sound", shot.ambient_sound),
                        ) if not text.strip()
                    ]
                    if missing:
                        raise ValueError("Complete shot " + ", ".join(missing) + " before confirming")
                    if any(not item.strip() for item in (
                        shot.lighting.key_source,
                        shot.lighting.color_tone,
                        shot.lighting.contrast,
                    )):
                        raise ValueError("Complete shot lighting source, color tone, and contrast before confirming")
                    if shot.duration_seconds is None:
                        raise ValueError("Set a duration for every shot before confirming the shooting plan")

    def save_director_shooting_plan_draft(
        self,
        script_id: str,
        expected_source_revision: int,
        expected_draft_revision: int,
        plan: Any,
    ) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            if expected_source_revision != script.source_revision:
                raise ValueError("Script source revision changed; reload the shooting plan")
            if expected_draft_revision != script.director_shooting_plan_draft_revision:
                raise ValueError("Shooting-plan draft revision changed; reload before saving")
            validated = self._validate_director_shooting_plan(script, plan)
            script.director_shooting_plan_draft = validated.model_copy(deep=True)
            script.director_shooting_plan_draft_revision += 1
            script.director_shooting_plan_draft_updated_at = time.time()
            script.updated_at = script.director_shooting_plan_draft_updated_at
            self._save_data()
            return script

    def apply_director_shooting_plan(
        self,
        script_id: str,
        plan: Any,
        expected_current_revision: int,
        expected_draft_revision: int,
    ) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            current_revision = script.director_shooting_plan_revisions[-1].revision if script.director_shooting_plan_revisions else 0
            if expected_current_revision != current_revision:
                raise ValueError("Confirmed shooting-plan revision changed; reload before confirming")
            if expected_draft_revision != script.director_shooting_plan_draft_revision:
                raise ValueError("Shooting-plan draft revision changed; save or reload before confirming")
            if not script.director_shooting_plan_draft:
                raise ValueError("Save the shooting-plan draft before confirming")
            validated = self._validate_director_shooting_plan(script, plan)
            self._validate_director_shooting_plan_for_confirmation(validated)
            if self._shooting_plan_content(script.director_shooting_plan_draft) != self._shooting_plan_content(validated):
                raise ValueError("Shooting plan has unsaved edits; save it before confirming")
            content = self._shooting_plan_content(validated)
            content_hash = hashlib.sha256(json.dumps(
                content, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode()).hexdigest()
            if script.director_shooting_plan_revisions and script.director_shooting_plan_revisions[-1].content_hash == content_hash:
                return script
            revision = current_revision + 1
            confirmed = DirectorShootingPlanRevision(
                revision=revision,
                content_hash=content_hash,
                plan=validated.model_copy(deep=True),
                confirmed_at=time.time(),
            )
            script.director_shooting_plan_revisions.append(confirmed)
            script.director_shooting_plan_draft = validated.model_copy(deep=True)
            script.director_shooting_plan_draft_updated_at = confirmed.confirmed_at
            script.updated_at = confirmed.confirmed_at
            self._save_data()
            return script

    def restore_director_shooting_plan_revision(
        self,
        script_id: str,
        revision: int,
        expected_draft_revision: int,
    ) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            if expected_draft_revision != script.director_shooting_plan_draft_revision:
                raise ValueError("Shooting-plan draft revision changed; reload before restoring")
            snapshot = next(
                (item for item in script.director_shooting_plan_revisions if item.revision == revision),
                None,
            )
            if snapshot is None:
                raise ValueError("Shooting-plan revision not found")
            restored = self._validate_director_shooting_plan(script, snapshot.plan)
            script.director_shooting_plan_draft = restored.model_copy(deep=True)
            script.director_shooting_plan_draft_revision += 1
            script.director_shooting_plan_draft_updated_at = time.time()
            script.updated_at = script.director_shooting_plan_draft_updated_at
            self._save_data()
            return script

    def save_director_profile_draft(
        self,
        script_id: str,
        source_revision: int,
        expected_draft_revision: int,
        draft: Dict[str, Any],
    ) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            if source_revision != script.source_revision:
                raise ValueError("Source revision changed; reload the Director draft")
            if expected_draft_revision != script.director_profile_draft_revision:
                raise ValueError("Director draft revision changed; reload before saving")

            normalized = normalize_director_profile_draft(draft)
            self._bind_director_story_map(
                script,
                self.resolve_episode_assets(script),
                normalized,
            )
            self._validate_director_story_map(script, normalized.get("story_map"))
            clean = _director_profile_content(normalized)
            script.director_profile_draft = DirectorProfile(**clean)
            script.director_profile_draft_revision += 1
            script.director_profile_draft_source_revision = source_revision
            script.director_profile_draft_updated_at = time.time()
            script.updated_at = script.director_profile_draft_updated_at
            self._save_data()
            return script

    def apply_director_profile(
        self,
        script_id: str,
        draft: Dict[str, Any],
        expected_current_revision: Optional[int] = None,
        expected_draft_revision: Optional[int] = None,
    ) -> Script:
        with self._save_lock:
            return self._apply_director_profile_locked(
                script_id,
                draft,
                expected_current_revision,
                expected_draft_revision,
            )

    def _apply_director_profile_locked(
        self,
        script_id: str,
        draft: Dict[str, Any],
        expected_current_revision: Optional[int],
        expected_draft_revision: Optional[int],
    ) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        current = self.effective_director_profile(script)
        current_revision = current.revision if current else 0
        if expected_current_revision is not None and expected_current_revision != current_revision:
            raise ValueError("Director profile revision changed; reload before confirming")
        if expected_draft_revision is not None:
            if expected_draft_revision != script.director_profile_draft_revision:
                raise ValueError("Director draft revision changed; save or reload before confirming")
            if script.director_profile_draft_source_revision != script.source_revision:
                raise ValueError("Source revision changed; reload the Director draft before confirming")

        normalized = normalize_director_profile_draft(draft)
        self._bind_director_story_map(
            script,
            self.resolve_episode_assets(script),
            normalized,
        )
        self._validate_director_story_map(script, normalized.get("story_map"))
        self._validate_director_story_map_for_confirmation(normalized.get("story_map"))
        clean = _director_profile_content(normalized)
        if expected_draft_revision is not None:
            saved_draft = script.director_profile_draft
            saved_content = _director_profile_content(saved_draft) if saved_draft else None
            if saved_content != clean:
                raise ValueError("Director draft has unsaved edits; save it before confirming")
        # Summaries are bounded downstream projections, not a second source of
        # narrative truth. Keep historical content hash/revision semantics
        # based on the full Director fields only.
        hash_payload = {
            key: value for key, value in clean.items()
            if key not in {"execution_summary", "scene_summaries"}
            and not (key == "canon_state" and value in (None, {}, []))
        }
        content_hash = hashlib.sha256(json.dumps(
            hash_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()).hexdigest()
        revision = (current.revision + 1) if current and current.content_hash != content_hash else (current.revision if current else 1)
        confirmed = DirectorProfile(
            **clean, revision=revision, content_hash=content_hash, confirmed_at=time.time()
        )
        if script.art_direction:
            script.art_direction.director_profile = confirmed
        else:
            inherited = self.effective_art_direction(script)
            script.art_direction = inherited.model_copy(deep=True) if inherited else ArtDirection(
                selected_style_id="director-profile", style_config={}
            )
            script.art_direction.director_profile = confirmed
        changed = not current or current.content_hash != content_hash
        if changed:
            # Keep the active profile as the compatibility read model, while
            # preserving each confirmed decision as an append-only snapshot.
            script.director_profile_revisions.append(
                DirectorProfileRevision(
                    revision=confirmed.revision,
                    content_hash=confirmed.content_hash,
                    profile=confirmed.model_copy(deep=True),
                    confirmed_at=confirmed.confirmed_at,
                )
            )
        if changed:
            script.director_review_required = True
            for item in [*script.characters, *script.scenes, *script.props, *script.frames]:
                item.director_review_required = True
        script.director_profile_draft = confirmed.model_copy(deep=True)
        script.director_profile_draft_source_revision = script.source_revision
        script.updated_at = time.time()
        self._save_data()
        return script

    def apply_fact_ledger(
        self,
        script_id: str,
        source_revision: int,
        expected_revision: int,
        facts: List[ScriptFactLedgerEntry],
    ) -> Script:
        with self._save_lock:
            return self._apply_fact_ledger_locked(
                script_id, source_revision, expected_revision, facts
            )

    def _apply_fact_ledger_locked(
        self,
        script_id: str,
        source_revision: int,
        expected_revision: int,
        facts: List[ScriptFactLedgerEntry],
    ) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        if source_revision != script.source_revision:
            raise ValueError("Script source revision changed")
        if expected_revision != script.fact_ledger_revision:
            raise ValueError("Fact ledger revision changed")
        ids = [fact.fact_id for fact in facts]
        if len(ids) != len(set(ids)):
            raise ValueError("Fact IDs must be unique")
        source_id = self.source_revision_id(script, source_revision)
        normalized_facts = []
        for fact in facts:
            if fact.source_revision != source_revision:
                raise ValueError(f"Fact {fact.fact_id} has a stale source revision")
            if fact.source_revision_id not in (None, source_id):
                raise ValueError(f"Fact {fact.fact_id} has a stale source revision id")
            if fact.evidence_status == "confirmed" and not fact.source_ranges:
                raise ValueError(f"Confirmed fact {fact.fact_id} requires a source range")
            for span in fact.source_ranges:
                if span.start == span.end or span.end > len(script.original_text):
                    raise ValueError(f"Fact {fact.fact_id} has an invalid source range")
            normalized_facts.append(fact.model_copy(update={"source_revision_id": source_id}))
        if script.fact_ledger_revision and normalized_facts == script.fact_ledger:
            return script
        revision = script.fact_ledger_revision + 1
        snapshot = ScriptFactLedgerRevision(
            revision=revision,
            source_revision=source_revision,
            source_revision_id=source_id,
            facts=[fact.model_copy(deep=True) for fact in normalized_facts],
            confirmed_at=time.time(),
        )
        script.fact_ledger_revision = revision
        script.fact_ledger = [fact.model_copy(deep=True) for fact in normalized_facts]
        script.fact_ledger_revisions.append(snapshot)
        script.director_review_required = True
        script.updated_at = time.time()
        self._save_data()
        return script

    @staticmethod
    def source_revision_id(script: Script, revision: int) -> str:
        source = next((item for item in script.source_revisions if item.revision == revision), None)
        if source:
            return source.source_revision_id
        if revision == script.source_revision:
            return ScriptSourceRevision(
                revision=revision,
                content_hash=source_version(script.original_text),
                text=script.original_text,
                created_at=script.created_at,
            ).source_revision_id
        raise ValueError("Script source revision not found")

    def save_fact_ledger_draft(
        self,
        script_id: str,
        source_revision: int,
        expected_draft_revision: int,
        facts: List[ScriptFactLedgerEntry],
    ) -> Script:
        with self._save_lock:
            return self._save_fact_ledger_draft_locked(
                script_id, source_revision, expected_draft_revision, facts
            )

    def _save_fact_ledger_draft_locked(
        self,
        script_id: str,
        source_revision: int,
        expected_draft_revision: int,
        facts: List[ScriptFactLedgerEntry],
    ) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        if source_revision != script.source_revision:
            raise ValueError("Script source revision changed")
        if expected_draft_revision != script.fact_ledger_draft_revision:
            raise ValueError("Fact ledger draft revision changed")
        ids = [fact.fact_id for fact in facts]
        if len(ids) != len(set(ids)):
            raise ValueError("Fact IDs must be unique")
        source_id = self.source_revision_id(script, source_revision)
        normalized_facts = []
        for fact in facts:
            if fact.source_revision != source_revision:
                raise ValueError(f"Fact {fact.fact_id} has a stale source revision")
            if fact.source_revision_id not in (None, source_id):
                raise ValueError(f"Fact {fact.fact_id} has a stale source revision id")
            if any(span.end > len(script.original_text) for span in fact.source_ranges):
                raise ValueError(f"Fact {fact.fact_id} has an invalid source range")
            normalized_facts.append(fact.model_copy(update={"source_revision_id": source_id}))
        script.fact_ledger_draft_revision += 1
        script.fact_ledger_draft_source_revision = source_revision
        script.fact_ledger_draft = [fact.model_copy(deep=True) for fact in normalized_facts]
        script.fact_ledger_draft_updated_at = time.time()
        script.updated_at = time.time()
        self._save_data()
        return script

    def confirm_fact_ledger(
        self,
        script_id: str,
        expected_revision: int,
        expected_draft_revision: int,
    ) -> Script:
        with self._save_lock:
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            if expected_draft_revision != script.fact_ledger_draft_revision:
                raise ValueError("Fact ledger draft revision changed")
            if script.fact_ledger_draft_source_revision != script.source_revision:
                raise ValueError("Script source revision changed; refresh the fact ledger draft")
            return self.apply_fact_ledger(
                script_id,
                script.fact_ledger_draft_source_revision,
                expected_revision,
                script.fact_ledger_draft,
            )

    # === STORYBOARD DRAMATIZATION v2 ===

    def storyboard_analysis_context(self, script_id: str) -> Tuple[Script, Dict[str, Any], str]:
        """Return the stable project context used by storyboard analysis jobs."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        resolved = self.resolve_episode_assets(script)
        entities_json = {
            "characters": [{
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "persona": c.persona,
                "base_character_id": c.base_character_id,
                "person_id": c.base_character_id or c.id,
            } for c in resolved["characters"]],
            "scenes": [{"id": s.id, "name": s.name, "description": s.description} for s in resolved["scenes"]],
            "props": [{"id": p.id, "name": p.name, "description": p.description} for p in resolved["props"]],
        }
        series = self.get_series(script.series_id) if getattr(script, "series_id", None) else None
        prompt = self.get_effective_prompt("storyboard_extraction", script, series)
        return script, entities_json, prompt

    def preview_storyboard_analysis(self, script_id: str, text: str,
                                    load_batches=None, save_batch=None,
                                    expected_lineage: Optional[ArtifactLineage] = None) -> List[Dict[str, Any]]:
        """Generate a storyboard draft without mutating persisted frames."""
        script, entities_json, prompt = self.storyboard_analysis_context(script_id)
        source_range = self._source_range_for_text(script, text)
        confirmed_director_profile = self.effective_director_profile(script)
        director_profile = self.director_execution_context(
            script,
            source_range=source_range,
            director_profile=confirmed_director_profile,
        )
        lineage = self.generation_lineage(
            script, confirmed_director_profile, director_profile, source_range,
        )
        if expected_lineage:
            self.validate_storyboard_lineage(script_id, text, expected_lineage)
            lineage = expected_lineage
        visual_style = self.storyboard_visual_style(script)
        if len(text) <= 1800 or load_batches is None or save_batch is None:
            if lineage.status == "pinned":
                self.validate_storyboard_lineage(script_id, text, lineage)
            frames = self.script_processor.analyze_to_storyboard(
                text, entities_json, custom_extraction_prompt=prompt,
                director_profile=director_profile, visual_style=visual_style,
            )
        else:
            from .llm import split_director_source
            chunks = split_director_source(
                text, direct_max_chars=1800, target_chars=1600, max_chars=1800
            )
            matched_range = self._source_range_for_text(script, text)
            cached = load_batches()
            frames = []
            for index, chunk in enumerate(chunks):
                prior = cached.get(index)
                if prior and prior.get("source_ref") == chunk["source_ref"]:
                    batch_frames = prior["frames"]
                else:
                    if lineage.status == "pinned":
                        self.validate_storyboard_lineage(script_id, text, lineage)
                    chunk_source_range = (
                        (
                            matched_range[0] + chunk["char_start"],
                            matched_range[0] + chunk["char_end"],
                        )
                        if matched_range else None
                    )
                    batch_frames = self.script_processor.analyze_to_storyboard(
                        chunk["text"], entities_json,
                        custom_extraction_prompt=prompt,
                        director_profile=self.director_execution_context(
                            script,
                            source_range=chunk_source_range,
                            director_profile=confirmed_director_profile,
                        ),
                        visual_style=visual_style,
                        previous_frames=frames[-3:],
                    )
                    if not batch_frames:
                        raise RuntimeError(f"分镜分析第 {index + 1}/{len(chunks)} 段没有返回镜头。")
                    batch_frames = [{**frame, "source_ref": chunk["source_ref"]} for frame in batch_frames]
                    if not save_batch(index, chunk["source_ref"], batch_frames):
                        raise RuntimeError("分镜分析任务已过期，请重试。")
                frames.extend(batch_frames)
        if not frames:
            raise RuntimeError("AI 分镜分析未返回任何帧数据，请重试。")
        if lineage.status == "pinned":
            self.validate_storyboard_lineage(script_id, text, lineage)
        return frames

    def refine_storyboard_analysis(self, script_id: str, text: str,
                                    draft: List[Dict[str, Any]],
                                    instructions: List[str],
                                    lineage: Optional[ArtifactLineage] = None) -> List[Dict[str, Any]]:
        """Revise a storyboard draft without changing the project's frames."""
        script, entities_json, prompt = self.storyboard_analysis_context(script_id)
        if lineage and lineage.status == "pinned":
            self.validate_storyboard_lineage(script_id, text, lineage)
        director_profile = self.director_execution_context(
            script,
            source_range=self._source_range_for_text(script, text),
            director_profile=self.effective_director_profile(script),
        )
        frames = self.script_processor.refine_storyboard_analysis(
            text, entities_json, draft, instructions, custom_extraction_prompt=prompt,
            director_profile=director_profile,
            visual_style=self.storyboard_visual_style(script),
        )
        if not frames:
            raise RuntimeError("AI 分镜修订未返回任何帧数据，请重试。")
        if lineage and lineage.status == "pinned":
            self.validate_storyboard_lineage(script_id, text, lineage)
        return frames

    def analyze_text_to_frames(self, script_id: str, text: str,
                               draft: Optional[List[Dict[str, Any]]] = None,
                               lineage: Optional[ArtifactLineage] = None) -> Script:
        """
        Analyzes script text and generates storyboard frames using LLM.
        Replaces existing frames with newly generated ones.
        """
        script, entities_json, storyboard_extraction_prompt = self.storyboard_analysis_context(script_id)
        logger.info(f"Analyzing text to frames for project {script_id}")

        # Resolve assets (merge Series + Episode if applicable)
        resolved = self.resolve_episode_assets(script)
        all_characters = resolved["characters"]
        all_scenes = resolved["scenes"]
        all_props = resolved["props"]

        # An explicit reviewed draft is applied exactly as shown and never
        # triggers a second analysis call.
        source_range = self._source_range_for_text(script, text)
        confirmed_director_profile = self.effective_director_profile(script)
        director_profile = self.director_execution_context(
            script,
            source_range=source_range,
            director_profile=confirmed_director_profile,
        )
        generated_lineage = self.generation_lineage(
            script, confirmed_director_profile, director_profile, source_range,
            pinned=draft is None or (lineage is not None and lineage.status == "pinned"),
        )
        if draft is not None and lineage and lineage.status == "pinned":
            self.validate_storyboard_lineage(script_id, text, lineage)
            # Rebuild trusted provenance server-side; the browser only submits
            # revision preconditions and cannot invent fact IDs or source ranges.
            generated_lineage = self.storyboard_analysis_lineage(script_id, text)
        raw_frames = draft if draft is not None else self.script_processor.analyze_to_storyboard(
            text, entities_json, custom_extraction_prompt=storyboard_extraction_prompt,
            director_profile=director_profile,
            visual_style=self.storyboard_visual_style(script),
        )

        if not raw_frames:
            raise RuntimeError("AI 分镜分析未返回任何帧数据，请重试。")

        # Convert raw frame dicts to StoryboardFrame objects
        new_frames = []
        for idx, frame_data in enumerate(raw_frames):
            # Resolve scene ID by name
            scene_ref_name = frame_data.get("scene_ref_name", "")
            scene_id = None
            for scene in all_scenes:
                if scene.name == scene_ref_name or scene_ref_name in scene.name:
                    scene_id = scene.id
                    break
            if not scene_id and all_scenes:
                scene_id = all_scenes[0].id  # Fallback to first scene
            elif not scene_id:
                scene_id = str(uuid.uuid4())  # Generate a placeholder ID

            # Resolve character IDs by names (case-insensitive, bidirectional contains)
            char_ref_names = frame_data.get("character_ref_names", [])
            character_ids = []
            for char_name in char_ref_names:
                cn = char_name.strip().lower()
                # Prefer an exact temporal/identity variant match.  A base
                # name such as "周涵" is contained in "周涵（大学时期）";
                # checking contains in list order first would silently bind a
                # university shot to the base character's design.
                matched = next(
                    (char for char in all_characters if char.name.strip().lower() == cn),
                    None,
                )
                if not matched:
                    matched = next(
                        (
                            char
                            for char in all_characters
                            if cn in char.name.strip().lower()
                            or char.name.strip().lower() in cn
                        ),
                        None,
                    )
                if matched:
                    character_ids.append(matched.id)

            # Resolve prop IDs by names (case-insensitive, bidirectional contains)
            prop_ref_names = frame_data.get("prop_ref_names", [])
            prop_ids = []
            for prop_name in prop_ref_names:
                pn = prop_name.strip().lower()
                for prop in all_props:
                    pname = prop.name.strip().lower()
                    if pname == pn or pn in pname or pname in pn:
                        prop_ids.append(prop.id)
                        break
            
            frame = StoryboardFrame(
                id=str(uuid.uuid4()),
                owner_user_id=script.owner_user_id,
                owner_profile_id=script.owner_profile_id,
                scene_id=scene_id,
                character_ids=character_ids,
                prop_ids=prop_ids,
                action_description=frame_data.get("action_summary", frame_data.get("action_description", "")),
                visual_atmosphere=frame_data.get("visual_atmosphere"),
                character_acting=frame_data.get("character_acting"),
                key_action_physics=frame_data.get("key_action_physics"),
                facial_expression=frame_data.get("facial_expression"),
                atmosphere=frame_data.get("atmosphere"),
                lighting=(LightingData(**frame_data["lighting"])
                          if isinstance(frame_data.get("lighting"), dict) else None),
                shot_size=frame_data.get("shot_size"),
                camera_angle=frame_data.get("camera_angle", "平视"),
                camera_movement=frame_data.get("camera_movement"),
                dialogue=frame_data.get("dialogue"),
                speaker=frame_data.get("speaker"),
                duration=frame_data.get("duration"),
                director_profile_revision=(
                    generated_lineage.director_profile_revision
                ),
                director_profile_hash=(
                    generated_lineage.director_profile_hash
                ),
                director_review_required=(generated_lineage.status != "pinned"),
                generation_lineage=generated_lineage.model_copy(deep=True),
                status=GenerationStatus.PENDING
            )
            new_frames.append(frame)

        if generated_lineage.status == "pinned":
            self.validate_storyboard_lineage(script_id, text, generated_lineage)
        
        # Replace existing frames with new ones
        script.frames = new_frames
        self.stamp_owned_children(script)
        script.updated_at = time.time()
        
        logger.info(f"Generated {len(new_frames)} frames from text analysis")
        self._save_data()
        return script

    def refine_frame(self, script_id: str, frame_id: str) -> Optional[StoryboardFrame]:
        """Phase 2: Refine a single coarse frame into a rich frame."""
        from .prompt_assembly import assemble_prompt, sync_dialogue_to_tts
        from .models import DialogueStructured, CameraMovementData, Blocking, AudioNote, LightingData, StageSubject

        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")

        frame_idx = script.frames.index(frame)
        resolved = self.resolve_episode_assets(script)
        all_characters = resolved["characters"]
        all_scenes = resolved["scenes"]

        # Build coarse frame dict for LLM
        coarse = {
            "action_summary": frame.action_description,
            "shot_size": frame.shot_size,
            "camera_angle": frame.camera_angle,
            "camera_movement": frame.camera_movement,
            "dialogue": frame.dialogue,
            "speaker": frame.speaker,
            "duration": frame.duration,
            "character_names": [c.name for c in all_characters if c.id in frame.character_ids],
            "scene_name": next((s.name for s in all_scenes if s.id == frame.scene_id), None),
        }

        # Character/scene assets
        char_assets = [
            {"name": c.name, "description": c.description, "clothing": c.clothing or ""}
            for c in all_characters if c.id in frame.character_ids
        ]
        scene_assets = [
            {"name": s.name, "description": s.description}
            for s in all_scenes if s.id == frame.scene_id
        ]

        # Adjacent frame context
        prev_ctx = None
        if frame_idx > 0:
            pf = script.frames[frame_idx - 1]
            prev_scene = next((s.name for s in all_scenes if s.id == pf.scene_id), None)
            prev_characters = [c.name for c in all_characters if c.id in pf.character_ids]
            prev_ctx = (
                f"Scene: {prev_scene}. Characters: {', '.join(prev_characters)}. "
                f"Action: {pf.action_description}. Dialogue: {pf.dialogue or 'None'}. "
                f"Visual atmosphere: {pf.visual_atmosphere or 'unspecified'}. "
                f"Shot: {pf.shot_size}, {pf.camera_angle}."
            )
        next_ctx = None
        if frame_idx < len(script.frames) - 1:
            nf = script.frames[frame_idx + 1]
            next_scene = next((s.name for s in all_scenes if s.id == nf.scene_id), None)
            next_characters = [c.name for c in all_characters if c.id in nf.character_ids]
            next_ctx = (
                f"Scene: {next_scene}. Characters: {', '.join(next_characters)}. "
                f"Action: {nf.action_description}. Dialogue: {nf.dialogue or 'None'}. "
                f"Visual atmosphere: {nf.visual_atmosphere or 'unspecified'}. "
                f"Shot: {nf.shot_size}, {nf.camera_angle}."
            )

        result = self.script_processor.refine_frame_to_rich(
            coarse, char_assets, scene_assets, prev_ctx, next_ctx,
            visual_style=self.storyboard_visual_style(script),
            director_context=self.director_prompt_context(script),
        )
        if not result:
            return frame

        # Map result onto frame fields
        if result.get("visual_description"):
            from .prompt_assembly import inject_reference_tags
            frame.visual_description = inject_reference_tags(
                result["visual_description"], frame, all_characters, all_scenes
            )
        if result.get("shot_size"):
            frame.shot_size = result["shot_size"]
        if result.get("camera_angle"):
            frame.camera_angle = result["camera_angle"]
        if result.get("duration"):
            frame.duration = result["duration"]
        if result.get("transition_hint"):
            frame.transition_hint = result["transition_hint"]

        # Camera movement structured
        cm = result.get("camera_movement")
        if cm and isinstance(cm, dict) and cm.get("primary"):
            frame.camera_movement_structured = CameraMovementData(
                primary=cm["primary"],
                secondary=cm.get("secondary"),
                speed=cm.get("speed", "normal"),
                description=cm.get("description"),
            )

        # Blocking
        blk = result.get("blocking")
        if blk and isinstance(blk, dict) and blk.get("description"):
            stage_list = None
            if blk.get("stage") and isinstance(blk["stage"], list):
                stage_list = [
                    StageSubject(
                        ref=s.get("ref", ""),
                        zone=s.get("zone", "center"),
                        depth=s.get("depth", "mid"),
                        height=s.get("height"),
                        facing=s.get("facing"),
                        posture=s.get("posture"),
                    )
                    for s in blk["stage"] if isinstance(s, dict)
                ]
            frame.blocking = Blocking(
                description=blk["description"],
                stage=stage_list,
                camera_relation=blk.get("camera_relation"),
            )

        # Dialogue structured
        ds = result.get("dialogue_structured")
        if ds and isinstance(ds, dict) and ds.get("line"):
            frame.dialogue_structured = DialogueStructured(
                speaker=ds.get("speaker", frame.speaker or ""),
                line=ds["line"],
                emotion=ds.get("emotion"),
                delivery=ds.get("delivery"),
            )

        # Audio note
        an = result.get("audio_note")
        if an and isinstance(an, dict) and (an.get("sfx") or an.get("ambience")):
            frame.audio_note = AudioNote(
                sfx=an.get("sfx"),
                ambience=an.get("ambience"),
                bgm_note=an.get("bgm_note"),
            )

        # Lighting
        lt = result.get("lighting")
        if lt and isinstance(lt, dict) and (lt.get("description") or lt.get("direction")):
            frame.lighting = LightingData(
                direction=lt.get("direction"),
                quality=lt.get("quality"),
                color_temp=lt.get("color_temp"),
                description=lt.get("description"),
            )

        # Sync dialogue → TTS instructions & compute assembled prompt
        sync_dialogue_to_tts(frame)
        frame.assembled_prompt = assemble_prompt(frame, all_characters)
        frame.updated_at = time.time()

        self._save_data()
        return frame

    def refine_batch_generator(self, script_id: str):
        """Phase 2: Generator that yields SSE events while refining all frames."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        total = len(script.frames)
        success = 0
        failed = 0

        for idx, frame in enumerate(script.frames):
            yield ("frame_refine_start", {
                "frame_id": frame.id,
                "frame_index": idx,
                "total": total,
                "label": frame.action_description[:40] if frame.action_description else f"Frame {idx+1}",
            })
            try:
                self.refine_frame(script_id, frame.id)
                success += 1
                yield ("frame_refine_complete", {
                    "frame_id": frame.id,
                    "frame_index": idx,
                    "total": total,
                })
            except Exception as exc:
                failed += 1
                logger.error(f"[refine_batch] frame={frame.id} error={exc}")
                yield ("frame_refine_error", {
                    "frame_id": frame.id,
                    "frame_index": idx,
                    # Don't leak exception details to the client (CodeQL
                    # py/stack-trace-exposure); full error is in the log above.
                    "error": f"分镜优化失败（{type(exc).__name__}），详情请查看服务端日志",
                })

        yield ("batch_complete", {"total": total, "success": success, "failed": failed})

    def refine_frame_prompt(self, script_id: str, frame_id: str, raw_prompt: str, assets: List[Dict[str, Any]], feedback: str = "") -> Dict[str, Any]:
        """
        Refines a raw prompt into bilingual (CN/EN) prompts using LLM.
        Also updates the frame with the refined prompts.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        logger.debug(f"Refining prompt for frame {frame_id}")

        # Read custom prompt config with 3-level fallback (Episode → Series → default)
        series = self.series_store.get(script.series_id) if script.series_id else None
        custom_prompt = self.get_effective_prompt("storyboard_polish", script, series)
        # If it's the system default, pass empty so the LLM method uses its built-in default
        from .llm import DEFAULT_STORYBOARD_POLISH_PROMPT
        if custom_prompt == DEFAULT_STORYBOARD_POLISH_PROMPT:
            custom_prompt = ""
        director_context = self.director_prompt_context(script)
        if director_context:
            custom_prompt = "\n\n".join(filter(None, [
                custom_prompt, "CONFIRMED DIRECTOR PROFILE:\n" + director_context,
            ]))

        # Call LLM to refine prompt
        result = self.script_processor.polish_storyboard_prompt(raw_prompt, assets, feedback, custom_prompt)
        
        # Find and update the frame
        frame_found = False
        for frame in script.frames:
            if frame.id == frame_id:
                frame.image_prompt_cn = result.get("prompt_cn")
                frame.image_prompt_en = result.get("prompt_en")
                frame.image_prompt = result.get("prompt_en")  # Also update legacy field
                frame.updated_at = time.time()
                frame_found = True
                break
        
        if frame_found:
            self._save_data()
        
        return {
            "prompt_cn": result.get("prompt_cn"),
            "prompt_en": result.get("prompt_en"),
            "frame_updated": frame_found
        }

    def generate_storyboard(self, script_id: str) -> Script:
        """Step 3: Generate storyboard images (Initial/Batch)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        resolved = self.resolve_episode_assets(script)
        script = self.storyboard_generator.generate_storyboard(
            script,
            characters=resolved["characters"],
            scenes=resolved["scenes"],
        )
        self._save_data()
        return script

    def update_frame(self, script_id: str, frame_id: str, **kwargs) -> Script:
        """Update frame data (prompt, scene_id, character_ids, etc.)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
        
        # Update only provided fields
        if kwargs.get('image_prompt') is not None:
            frame.image_prompt = kwargs['image_prompt']
        if kwargs.get('action_description') is not None:
            frame.action_description = kwargs['action_description']
        if kwargs.get('dialogue') is not None:
            frame.dialogue = kwargs['dialogue']
        if kwargs.get('camera_angle') is not None:
            frame.camera_angle = kwargs['camera_angle']
        if kwargs.get('scene_id') is not None:
            frame.scene_id = kwargs['scene_id']
        if kwargs.get('character_ids') is not None:
            frame.character_ids = kwargs['character_ids']
        if kwargs.get('duration') is not None:
            frame.duration = kwargs['duration']
        if kwargs.get('shot_size') is not None:
            frame.shot_size = kwargs['shot_size']
        if kwargs.get('camera_movement_description') is not None:
            if frame.camera_movement_structured:
                frame.camera_movement_structured.description = kwargs['camera_movement_description']
                frame.camera_movement_structured.primary = kwargs['camera_movement_description']
            else:
                from .models import CameraMovementData
                frame.camera_movement_structured = CameraMovementData(
                    primary=kwargs['camera_movement_description'],
                    speed="normal",
                    description=kwargs['camera_movement_description'],
                )
        if kwargs.get('transition_hint') is not None:
            frame.transition_hint = kwargs['transition_hint']
        if kwargs.get('style_prompt_override') is not None:
            frame.style_prompt_override = kwargs['style_prompt_override']
        if kwargs.get('lighting_override') is not None:
            frame.lighting_override = kwargs['lighting_override']
        if kwargs.get('negative_prompt_override') is not None:
            frame.negative_prompt_override = kwargs['negative_prompt_override']
        
        self._save_data()
        return script

    def add_frame(self, script_id: str, scene_id: str = None, action_description: str = "", camera_angle: str = "medium_shot", insert_at: int = None) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_frame = StoryboardFrame(
            id=f"frame_{uuid.uuid4().hex[:8]}",
            owner_user_id=script.owner_user_id,
            owner_profile_id=script.owner_profile_id,
            scene_id=scene_id or (script.scenes[0].id if script.scenes else ""),
            character_ids=[],
            action_description=action_description,
            camera_angle=camera_angle
        )
        
        if insert_at is not None and 0 <= insert_at <= len(script.frames):
            script.frames.insert(insert_at, new_frame)
        else:
            script.frames.append(new_frame)
            
        self._save_data()
        return script

    def copy_frame(self, script_id: str, frame_id: str, insert_at: int = None) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        original_frame = next((f for f in script.frames if f.id == frame_id), None)
        if not original_frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        # Create a deep copy with new ID
        new_frame = original_frame.copy()
        new_frame.id = f"frame_{uuid.uuid4().hex[:8]}"
        new_frame.updated_at = time.time()
        # Reset generation status and URLs for the copy? 
        # Usually copy implies copying content, but maybe we want to keep the image?
        # Let's keep the image/content but reset status if it was processing?
        # Actually, if we copy, we probably want the same image reference initially.
        # But we should reset the "locked" status maybe?
        new_frame.locked = False
        
        if insert_at is not None and 0 <= insert_at <= len(script.frames):
            script.frames.insert(insert_at, new_frame)
        else:
            # Insert after the original frame by default
            try:
                original_index = script.frames.index(original_frame)
                script.frames.insert(original_index + 1, new_frame)
            except ValueError:
                script.frames.append(new_frame)
                
        self._save_data()
        return script

    def delete_frame(self, script_id: str, frame_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.frames = [f for f in script.frames if f.id != frame_id]
        self._save_data()
        return script

    def reorder_frames(self, script_id: str, frame_ids: List[str]) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        frame_map = {f.id: f for f in script.frames}
        new_frames = []
        for fid in frame_ids:
            if fid in frame_map:
                new_frames.append(frame_map[fid])
        
        script.frames = new_frames
        self._save_data()
        return script

    def generate_motion_ref(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,  # 'full_body' | 'head_shot' for characters; 'scene' | 'prop' for scenes and props
        prompt: Optional[str] = None,
        audio_url: Optional[str] = None,
        duration: int = 5,
        batch_size: int = 1
    ) -> Script:
        """Generate Motion Reference video for an asset (Character Full Body/Headshot, Scene, or Prop).

        Args:
            script_id: ID of the project/script
            asset_id: ID of the asset (character, scene, or prop)
            asset_type: 'full_body' | 'head_shot' for characters; 'scene' or 'prop' for scenes and props
            prompt: Custom prompt for motion generation
            audio_url: URL of driving audio for lip-sync
            duration: Video duration in seconds (5 or 10)
            batch_size: Number of videos to generate
        """
        from .models import VideoVariant, AssetUnit, VideoTask

        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        # Find the target asset based on type
        target_asset = None
        asset_display_name = ""

        if asset_type in ["full_body", "head_shot"]:
            # Find the character
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            asset_display_name = "Character"
        elif asset_type == "scene":
            # Find the scene
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            asset_display_name = "Scene"
        elif asset_type == "prop":
            # Find the prop
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            asset_display_name = "Prop"
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}. Must be 'full_body', 'head_shot', 'scene', or 'prop'")

        if not target_asset:
            raise ValueError(f"{asset_display_name} {asset_id} not found")

        # Get the appropriate AssetUnit or image URL based on the asset type
        asset_unit = None  # For characters with AssetUnit
        generated_videos = []  # Store generated videos

        if asset_type in ["full_body", "head_shot"]:
            # Handle character asset
            asset_unit = getattr(target_asset, asset_type, None)
            # The canonical reference sheet is the master image in R2V v2.
            # Use its selected image for full-body motion while keeping the
            # legacy full_body container as the video-output destination.
            reference_sheet = getattr(target_asset, "reference_sheet", None) if asset_type == "full_body" else None
            reference_variants = getattr(reference_sheet, "image_variants", None) or []
            reference_selected_id = getattr(reference_sheet, "selected_image_id", None)
            if reference_selected_id and reference_variants:
                source_img = next((v for v in reference_variants if v.id == reference_selected_id), None)
                if source_img is None or not source_img.url:
                    raise ValueError("Selected reference image is missing; select it again")
                source_image_url = source_img.url
            elif reference_selected_id and not reference_variants:
                raise ValueError("Selected reference image is missing; select it again")
            elif reference_variants:
                source_image_url = reference_variants[0].url
            # Fall back to the legacy selected image or URL when no canonical
            # reference image exists.
            elif asset_unit and asset_unit.selected_image_id:
                source_img = next(
                    (v for v in asset_unit.image_variants if v.id == asset_unit.selected_image_id),
                    None
                )
                source_image_url = source_img.url if source_img else (
                    target_asset.full_body_image_url if asset_type == "full_body" else target_asset.headshot_image_url
                )
            else:
                source_image_url = (
                    target_asset.full_body_image_url if asset_type == "full_body"
                    else target_asset.headshot_image_url
                )

            # Default prompt for character
            if not prompt:
                if audio_url:
                    prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {target_asset.description}. The character is speaking naturally matching the audio, with accurate lip-sync and facial expressions. Stable camera, high quality, 4k."
                else:
                    prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {target_asset.description}. Looking around, breathing, slight movement, subtle gestures. Stable camera, high quality, 4k."
        else:
            # Handle scene or prop assets
            source_image_url = target_asset.image_url
            # Default prompt for scene and prop
            if not prompt:
                if asset_type == "scene":
                    if audio_url:
                        prompt = f"Cinematic scene video reference of {target_asset.name}. {target_asset.description}. Ambient motion, lighting changes, natural elements moving, birds, clouds. Soundscape matching the audio. High quality, 4k."
                    else:
                        prompt = f"Cinematic scene video reference of {target_asset.name}. {target_asset.description}. Ambient motion, lighting changes, natural elements moving, birds, clouds. Slow pan across the scene. High quality, 4k."
                else:  # prop
                    if audio_url:
                        prompt = f"Cinematic prop video reference of {target_asset.name}. {target_asset.description}. Rotating object, detailed textures visible, ambient motion, subtle movements matching audio. High quality, 4k."
                    else:
                        prompt = f"Cinematic prop video reference of {target_asset.name}. {target_asset.description}. Rotating object, detailed textures visible, ambient motion, subtle movements. High quality, 4k."

        # Check if source image exists
        if not source_image_url:
            raise ValueError(f"No source image available for {asset_type}. Please generate a static image first.")

        # Generate videos based on the asset type
        for i in range(batch_size):
            try:
                # Call video generator (I2V)
                video_result = self.video_generator.generate_i2v(
                    image_url=source_image_url,
                    prompt=prompt,
                    duration=duration,
                    audio_url=audio_url
                )

                if video_result and video_result.get("video_url"):
                    if asset_type in ["full_body", "head_shot"]:
                        # For characters, create VideoVariant in AssetUnit
                        video_variant = VideoVariant(
                            id=f"video_{uuid.uuid4().hex[:8]}",
                            url=video_result["video_url"],
                            prompt_used=prompt,
                            audio_url=audio_url,
                            source_image_id=None  # Don't set this to avoid complications
                        )
                        asset_unit.video_variants.append(video_variant)

                        # Auto-select the first generated video
                        if not asset_unit.selected_video_id:
                            asset_unit.selected_video_id = video_variant.id

                        generated_videos.append(video_variant)
                        logger.info(f"Generated motion ref video: {video_variant.id}")
                    else:
                        # For scenes and props, create VideoTask and add to asset's video_assets
                        video_task = VideoTask(
                            id=f"video_{uuid.uuid4().hex[:8]}",
                            project_id=script_id,
                            owner_user_id=script.owner_user_id,
                            owner_profile_id=script.owner_profile_id,
                            asset_id=asset_id,
                            image_url=source_image_url,
                            prompt=prompt,
                            status="completed",  # Since generation is done in this step
                            video_url=video_result["video_url"],
                            duration=duration,
                            created_at=time.time(),
                            generate_audio=bool(audio_url),
                            model="wan2.6-i2v",
                            generation_mode="i2v"  # Image to video (motion reference)
                        )

                        # Add to the asset's video_assets
                        target_asset.video_assets.append(video_task)
                        generated_videos.append(video_task)
                        logger.info(f"Generated motion ref video for {asset_type}: {video_task.id}")
            except Exception as e:
                logger.error(f"Failed to generate motion ref video for {asset_type}: {e}")

        # For character assets, update the AssetUnit
        if asset_type in ["full_body", "head_shot"]:
            # Ensure AssetUnit exists
            if asset_unit is None:
                asset_unit = AssetUnit()
                setattr(target_asset, asset_type, asset_unit)

            asset_unit.video_prompt = prompt
            asset_unit.video_updated_at = time.time()
        # For scene and prop assets, the video tasks are already added in the generation loop above

        if batch_size > 0 and not generated_videos:
            raise RuntimeError(f"Failed to generate any motion reference videos for {asset_type}")

        self._save_data()
        return script

    def generate_storyboard_render(
        self,
        script_id: str,
        frame_id: str,
        composition_data: Optional[Dict[str, Any]],
        prompt: str,
        batch_size: int = 1,
        negative_prompt: Optional[str] = None,
    ) -> Script:
        """Step 3b: Render a specific frame from composition data."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        frame.status = GenerationStatus.PROCESSING
        if composition_data:
            frame.composition_data = composition_data
        frame.image_prompt = prompt
        self._save_data()
        
        try:
            # Extract reference image URL from composition data if available
            ref_image_url = None
            ref_image_urls = []
            
            if composition_data:
                ref_image_url = composition_data.get('reference_image_url')
                ref_image_urls = composition_data.get('reference_image_urls', [])
            
            ref_image_paths = []
            
            # Resolve multiple paths
            for url in ref_image_urls:
                if not url:
                    continue
                if is_object_key(url) or url.startswith("http"):
                    ref_image_paths.append(url)
                else:
                    potential_path = _safe_resolve_path("output", url)
                    if os.path.exists(potential_path):
                        ref_image_paths.append(potential_path)
            
            # Also handle single path if provided (legacy support)
            if ref_image_url and ref_image_url not in ref_image_urls:
                if is_object_key(ref_image_url) or ref_image_url.startswith("http"):
                    if ref_image_url not in ref_image_paths:
                        ref_image_paths.append(ref_image_url)
                else:
                    potential_path = _safe_resolve_path("output", ref_image_url)
                    if os.path.exists(potential_path):
                        if potential_path not in ref_image_paths:
                            ref_image_paths.append(potential_path)
            
            # Use the first path as ref_image_path for legacy generator support if needed
            ref_image_path = ref_image_paths[0] if ref_image_paths else None
            
            # Use the prompt as-is from frontend (already contains style)
            final_prompt = prompt
            
            # Update frame with final prompt
            frame.image_prompt = final_prompt
            
            # Resolve assets across Episode → Series → Global layers so
            # shared/global characters & scenes are usable when rendering
            # this frame (frame id references are left unchanged).
            resolved = self.resolve_episode_assets(script)
            # Find scene for this frame
            scene = next((s for s in resolved["scenes"] if s.id == frame.scene_id), None)

            # Get effective size from storyboard_aspect_ratio
            from .assets import ASPECT_RATIO_TO_SIZE
            storyboard_aspect_ratio = script.model_settings.storyboard_aspect_ratio
            effective_size = ASPECT_RATIO_TO_SIZE.get(storyboard_aspect_ratio, "1024*576")  # Default to landscape
            
            # Use model from settings
            i2i_model = script.model_settings.i2i_model
            logger.info(f"Rendering frame {frame_id} using model {i2i_model} with {len(ref_image_paths)} reference images")
            if len(ref_image_urls) > 0:
                logger.debug(f"Original reference URLs from frontend: {ref_image_urls}")

            # Call generator
            self.storyboard_generator.generate_frame(
                frame,
                resolved["characters"],
                scene,
                ref_image_path=ref_image_path,
                ref_image_paths=ref_image_paths,
                prompt=final_prompt,
                negative_prompt=negative_prompt,
                batch_size=batch_size,
                size=effective_size,
                model_name=i2i_model
            )
            
            self._save_data()
            return script
        except Exception as e:
            frame.status = GenerationStatus.FAILED
            self._save_data()
            raise e
            # 1. Take the composition_data (positions of assets)
            # 2. Construct a composite image (ControlNet input)
            # 3. Call Img2Img with the composite + prompt
            
            logger.debug(f"Rendering frame {frame_id} with prompt: {prompt}")
            time.sleep(1.5) # Simulate processing
            
            # Mock Result
            mock_url = f"https://placehold.co/1280x720/2a2a2a/FFF?text=Rendered+Frame+{frame_id}"
            frame.rendered_image_url = mock_url
            frame.image_url = mock_url # Update main image too
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Frame rendering failed: {e}")
            frame.status = GenerationStatus.FAILED
            
        self._save_data()
        return script

    def generate_video(self, script_id: str) -> Script:
        """Step 4: Generate video clips."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        script = self.video_generator.generate_video(script)
        self._save_data()
        return script

    def create_video_task(self, script_id: str, image_url: str, prompt: str, duration: int = 5, seed: int = None, resolution: str = "720p", generate_audio: bool = False, audio_url: str = None, prompt_extend: bool = True, negative_prompt: str = None, model: str = "wan2.7-i2v", frame_id: str = None, shot_type: str = "single", generation_mode: str = "i2v", reference_video_urls: list = None, reference_image_urls: list = None, ratio: str = None, watermark: Optional[bool] = None, mode: str = None, sound: str = None, cfg_scale: float = None, vidu_audio: bool = None, movement_amplitude: str = None, workbench_tab: Optional[str] = None, pose_reference_variant_ids: Optional[Dict[str, List[str]]] = None, director_snapshot_media_id: Optional[str] = None) -> Tuple[Script, str]:
        """Creates a new video generation task."""
        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")
        
        task_id = str(uuid.uuid4())
        
        # If R2V mode is selected, use the appropriate R2V model
        is_uniart_video = bool(model and model.startswith(("uniart/minimax-h3-", "uniart/seedance-")))
        if generation_mode == "r2v" and not is_uniart_video:
            # Skip auto-switch if user already selected an R2V model directly
            if not (model and model.endswith("-r2v")):
                if model and model.startswith("happyhorse-"):
                    model = "happyhorse-1.1-r2v"
                elif model and model.startswith("wan2.7-"):
                    model = "wan2.7-r2v"
                elif model and model.startswith("kling"):
                    model = "kling-v3-r2v"
                elif model and model.startswith("pixverse"):
                    model = "pixverse-c1-r2v"
                elif model and model.startswith("vidu"):
                    model = "viduq3-pro-r2v"
                elif model and model.startswith("seedance"):
                    model = "seedance-2.0-r2v"
                else:
                    model = "wan2.7-r2v"

        # Defensive guard against model⇄mode⇄refs mismatch. Every R2V
        # model needs reference inputs; without them the underlying
        # provider call raises mid-generation, the BG task crashes,
        # and the user sees nothing but a spinner. Catch the
        # inconsistency at task-creation time so the frontend gets a
        # clean 400 instead of a permanently-failed task.
        #
        # Originally we only checked wan2.7-r2v / wan2.6-r2v (the
        # first reported case). Production added happyhorse-1.0-r2v,
        # kling-v3-r2v, pixverse-c1-r2v, pixverse-v5.6-r2v,
        # viduq3-pro-r2v, viduq3-turbo-r2v — all need refs too. We
        # now match on the "-r2v" suffix so new R2V families inherit
        # the check automatically. Only wan2.6-r2v (legacy) takes
        # video refs; everything else takes image refs.
        if is_uniart_video:
            references = (reference_image_urls or []) + (reference_video_urls or [])
            if generation_mode == "r2v" and not references and not audio_url:
                raise ValueError("Reference-to-video requires image, video or audio references")
            if generation_mode not in ("r2v", "i2v", "t2v"):
                raise ValueError("Unsupported Studio UniArt generation mode")
            if generation_mode != "r2v" and references:
                raise ValueError("Reference lists require reference-to-video mode")
            if generation_mode == "r2v" and image_url:
                raise ValueError("Use the ordered reference list instead of an additional input image")
            if generation_mode == "i2v" and not image_url:
                raise ValueError("Image-to-video requires an input image")
            if generation_mode == "i2v" and audio_url:
                raise ValueError("Audio references require reference-to-video mode")
            if generation_mode == "t2v" and (image_url or audio_url):
                raise ValueError("Text-to-video cannot accept media references")
            if "minimax-h3" in model.lower() and len(reference_image_urls or []) > 9:
                raise ValueError("MiniMax H3 accepts at most 9 reference images per video request")
            reference_image_urls = [resolve_studio_reference(ref, script.owner_profile_id) for ref in reference_image_urls or []]
            reference_video_urls = [resolve_studio_reference(ref, script.owner_profile_id) for ref in reference_video_urls or []]
            if image_url:
                image_url = resolve_studio_reference(image_url, script.owner_profile_id)
            if audio_url:
                audio_url = resolve_studio_reference(audio_url, script.owner_profile_id)

        is_r2v_model = isinstance(model, str) and model.endswith("-r2v")
        if is_r2v_model:
            needs_video_refs = model == "wan2.6-r2v"
            refs = (
                (reference_video_urls or []) if needs_video_refs
                else (reference_image_urls or [])
            )
            if not refs:
                kind = "video" if needs_video_refs else "image"
                raise ValueError(
                    f"Model '{model}' is reference-to-video and requires {kind} references, "
                    f"but none were provided. Attach reference {kind}s (use @ in the prompt "
                    "to reference characters / scenes / props) or switch to an I2V model "
                    "(e.g. wan2.7-i2v)."
                )

        # Snapshot the input image to ensure consistency
        snapshot_url = image_url
        try:
            # Resolve source path
            if image_url and not image_url.startswith("http"):
                # Assume relative to output dir
                src_path = _safe_resolve_path("output", image_url)
                if os.path.exists(src_path) and os.path.isfile(src_path):
                    # Create snapshot dir
                    snapshot_dir = self._owner_output_dir(script, "video_inputs")
                    os.makedirs(snapshot_dir, exist_ok=True)

                    # Define snapshot path
                    ext = os.path.splitext(os.path.basename(image_url))[1] or ".png"
                    _validate_safe_id(task_id, "task_id")
                    snapshot_filename = f"{task_id}{ext}"
                    snapshot_path = _safe_resolve_path(snapshot_dir, snapshot_filename)
                    
                    # Copy file
                    import shutil
                    shutil.copy2(src_path, snapshot_path)
                    
                    # Update URL to relative path
                    snapshot_url = os.path.relpath(snapshot_path, "output")
        except Exception as e:
            logger.error(f"Failed to snapshot input image: {e}")
            # Fallback to original URL

        # Enrich prompt with dialogue cue when a frame has dialogue text.
        # This gives the video model explicit mouth-movement instructions.
        if frame_id and prompt:
            frame = next((f for f in script.frames if f.id == frame_id), None)
            if frame:
                from .prompt_assembly import enrich_prompt_with_dialogue
                prompt = enrich_prompt_with_dialogue(prompt, frame)

        task = VideoTask(
            id=task_id,
            project_id=script_id,
            owner_user_id=script.owner_user_id,
            owner_profile_id=script.owner_profile_id,
            frame_id=frame_id,
            pose_reference_variant_ids={
                key: list(value)
                for key, value in (pose_reference_variant_ids or {}).items()
                if isinstance(key, str) and isinstance(value, list)
            },
            director_snapshot_media_id=(
                director_snapshot_media_id.strip()
                if isinstance(director_snapshot_media_id, str) and director_snapshot_media_id.strip()
                else None
            ),
            image_url=snapshot_url,
            prompt=prompt,
            status="pending",
            duration=duration,
            seed=seed,
            resolution=resolution,
            generate_audio=generate_audio,
            audio_url=audio_url,
            prompt_extend=prompt_extend,
            negative_prompt=negative_prompt,
            model=model,
            shot_type=shot_type,
            generation_mode=generation_mode,
            reference_video_urls=reference_video_urls or [],
            reference_image_urls=reference_image_urls or [],
            ratio=ratio,
            watermark=watermark,
            mode=mode,
            sound=sound,
            cfg_scale=cfg_scale,
            vidu_audio=vidu_audio,
            movement_amplitude=movement_amplitude,
            workbench_tab=workbench_tab,
            created_at=time.time()
        )

        if not script.video_tasks:
            script.video_tasks = []
        script.video_tasks.append(task)

        self._save_data()
        return script, task_id

    def extract_last_frame(self, script_id: str, frame_id: str, video_task_id: str) -> Script:
        """Extract the last frame from a video task and add it as a variant of the frame's rendered_image_asset."""
        from .models import ImageVariant, ImageAsset

        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        # Find the video task
        video_task = next((t for t in script.video_tasks if t.id == video_task_id), None)
        if not video_task or video_task.status != "completed" or not video_task.video_url:
            raise ValueError("Video task not found or not completed")

        # Resolve video path (managed output/ files, temp downloads, or URLs)
        video_path = video_task.video_url
        if video_path.startswith("http"):
            # Download to temp file first
            video_path = self._download_temp_image(video_path)
        elif video_path.startswith("/"):
            # Legacy absolute path: must stay inside the managed output/ tree
            resolved = os.path.realpath(video_path)
            out_base = os.path.realpath("output")
            if not resolved.startswith(out_base + os.sep):
                raise ValueError(f"Video path outside managed output directory: {video_task.video_url}")
            video_path = resolved
        else:
            video_path = _safe_resolve_path("output", video_path)

        if not os.path.exists(video_path):
            raise ValueError(f"Video file not found: {video_path}")

        # Extract last frame using FFmpeg
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg is required for frame extraction but was not found.")

        output_dir = self._owner_output_dir(script, "storyboard")
        os.makedirs(output_dir, exist_ok=True)
        # Use the store-backed frame.id (identical to the request frame_id by
        # the lookup above) so the ffmpeg arg carries no request-parameter taint.
        safe_frame_id = _validate_safe_id(frame.id, "frame_id")
        output_filename = f"frame_{safe_frame_id}_lastframe_{uuid.uuid4().hex[:8]}.jpg"
        output_path = _safe_resolve_path(output_dir, output_filename)

        cmd = [
            ffmpeg_path, "-sseof", "-0.1",
            "-i", video_path,
            "-frames:v", "1",
            "-q:v", "2",
            "-y", output_path
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg error: {result.stderr}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("FFmpeg frame extraction timed out")

        if not os.path.exists(output_path):
            raise RuntimeError("Failed to extract last frame from video")

        # Upload to OSS if configured
        from ...utils.oss_utils import OSSImageUploader
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(output_path)
        image_url = oss_url if oss_url else os.path.relpath(output_path, "output")

        # Create new variant
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="Extracted last frame from video",
            is_uploaded_source=True,
            upload_type="image",
            source_origin="upload",
        )

        # Initialize rendered_image_asset if needed
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset()

        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        # Also update rendered_image_url so VideoCreator can pick it up
        frame.rendered_image_url = image_url

        script.updated_at = time.time()
        self._save_data()
        return script

    def upload_frame_image(self, script_id: str, frame_id: str, image_path: str) -> Script:
        """Upload an image as a variant of the frame's rendered_image_asset."""
        from .models import ImageVariant, ImageAsset

        # Validate that image_path is inside the output directory
        safe_path = _safe_resolve_path("output", os.path.relpath(image_path, "output") if os.path.isabs(image_path) else image_path)

        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        # Upload to OSS if configured
        from ...utils.oss_utils import OSSImageUploader
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(safe_path)
        image_url = oss_url if oss_url else os.path.relpath(safe_path, "output")

        # Create new variant
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="User uploaded image",
            is_uploaded_source=True,
            upload_type="image",
            source_origin="upload",
        )

        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset()

        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        # Also update rendered_image_url so VideoCreator can pick it up
        frame.rendered_image_url = image_url

        script.updated_at = time.time()
        self._save_data()
        return script

    def _download_temp_image(self, url: str) -> str:
        """Downloads an image to a temporary file."""
        import requests
        import tempfile
        
        # If it's a local file path (relative to output)
        if not url.startswith("http"):
            local_path = _safe_resolve_path("output", url)
            if os.path.exists(local_path):
                return local_path
                
        # Download from URL
        try:
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            # Create temp file
            fd, path = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return path
        except Exception as e:
            logger.error(f"Failed to download image: {e}")
            raise
    def select_video_for_frame(self, script_id: str, frame_id: str, video_id: str) -> Script:
        """Manual select: user pins this video as the active take.

        Sets is_video_pinned=True so subsequent auto_select_latest_video
        calls (fired by polling completion) skip this frame and don't
        overwrite the user's hand-picked choice.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        video = next((v for v in script.video_tasks if v.id == video_id), None)
        if not video:
            raise ValueError("Video task not found")

        frame.selected_video_id = video_id
        frame.video_url = video.video_url
        frame.is_video_pinned = True

        self._save_data()
        return script

    def auto_select_latest_video(self, script_id: str, frame_id: str) -> Script:
        """Auto select: pick the latest completed video task for this frame.

        Idempotent. Skips the update entirely if the frame is pinned by the
        user (is_video_pinned=True). Called by the frontend on every task
        completion poll — the pin check is what makes latest-wins respect
        user intent.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        if frame.is_video_pinned:
            return script  # user has manually pinned — don't overwrite

        # Latest completed task wins. VideoTask carries created_at
        # (default_factory=time.time); we use it as the "completion order"
        # proxy. Backend doesn't track per-task completion time, but tasks
        # in the same batch are queued at roughly the same created_at and
        # complete in arrival order — close enough for "show me what just
        # came out" UX.
        frame_tasks = [
            t for t in script.video_tasks
            if t.frame_id == frame_id
            and t.status == GenerationStatus.COMPLETED
            and t.video_url
        ]
        if not frame_tasks:
            return script  # nothing to select yet

        latest = max(frame_tasks, key=lambda t: getattr(t, "created_at", 0) or 0)
        if frame.selected_video_id == latest.id and frame.video_url == latest.video_url:
            return script  # already selected — no-op

        frame.selected_video_id = latest.id
        frame.video_url = latest.video_url
        # is_video_pinned stays False — this is an auto-select

        self._save_data()
        return script

    def unpin_video(self, script_id: str, frame_id: str) -> Script:
        """Clear the manual pin so auto_select_latest_video resumes.

        Intentionally does NOT touch selected_video_id or video_url — the
        user keeps seeing the same take until the next generation runs
        and auto_select picks a newer one.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        if not frame.is_video_pinned:
            return script  # already unpinned — no-op

        frame.is_video_pinned = False
        self._save_data()
        return script

    def _resolve_media_path(self, url: str, suffix: str = "") -> Optional[str]:
        """Resolve a media URL to a local file path.

        Handles three cases:
        1. Local relative path (e.g. 'video/xxx.mp4') → resolve under output/
        2. OSS object key (e.g. 'lumenx/videos/xxx.mp4') → sign URL then download
        3. Full HTTP URL → download directly
        """
        if not url:
            return None

        # Case 1: Try as local path first
        if not url.startswith("http"):
            local_path = _safe_resolve_path("output", url)
            if os.path.exists(local_path):
                return local_path
            # Not found locally — might be an OSS object key
            if is_object_key(url):
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    url = uploader.sign_url_for_api(url)
                else:
                    logger.error(f"[DUB] File not local and OSS not configured: {url}")
                    return None
            else:
                return None

        # Case 2 & 3: Download from HTTP URL
        import hashlib
        url_hash = hashlib.md5(url.split("?")[0].encode()).hexdigest()[:12]
        cache_dir = os.path.join("output", "cache")
        os.makedirs(cache_dir, exist_ok=True)
        cached = os.path.join(cache_dir, f"{url_hash}{suffix}")
        if os.path.exists(cached) and os.path.getsize(cached) > 0:
            return cached
        try:
            import requests
            resp = requests.get(url, stream=True, timeout=60)
            resp.raise_for_status()
            with open(cached, "wb") as f:
                for chunk in resp.iter_content(chunk_size=65536):
                    f.write(chunk)
            logger.info(f"[DUB] Downloaded remote media -> {cached}")
            return cached
        except Exception as e:
            logger.error(f"[DUB] Failed to download media: {e}")
            if os.path.exists(cached):
                os.remove(cached)
            return None

    def _warmup_demucs_model(self):
        """Pre-download htdemucs model at startup so first dub request is fast."""
        try:
            from demucs.pretrained import get_model
            get_model("htdemucs")
            logger.info("[DUB] Demucs htdemucs model ready")
            self._demucs_ready.set()
        except Exception as e:
            self._demucs_error = str(e)
            self._demucs_ready.set()
            logger.warning(f"[DUB] Demucs model warmup failed: {e}")

    def _separate_background_audio(self, video_path: str, work_dir: str) -> Optional[str]:
        """Extract audio from video and separate background (no_vocals) using Demucs.

        Returns the path to the background audio WAV file, or None if
        separation fails (caller falls back to simple replacement).
        """
        ffmpeg_path = get_ffmpeg_path()
        extracted_audio = os.path.join(work_dir, "original_audio.wav")

        # Step 1: Extract audio from video
        extract_cmd = [
            ffmpeg_path, "-y",
            "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
            extracted_audio,
        ]
        try:
            result = subprocess.run(extract_cmd, capture_output=True, timeout=30)
            if result.returncode != 0 or not os.path.exists(extracted_audio):
                logger.warning("[DUB] No audio track in source video, skipping separation")
                return None
        except Exception as e:
            logger.warning(f"[DUB] Audio extraction failed: {e}")
            return None

        # Check if extracted audio has any content (some videos are silent)
        if os.path.getsize(extracted_audio) < 1000:
            logger.info("[DUB] Source video has negligible audio, skipping separation")
            return None

        # Step 2: Run Demucs separation (two-stems: vocals + no_vocals)
        # Wait for background model warmup to finish (avoids duplicate download)
        if not self._demucs_ready.wait(timeout=120):
            raise RuntimeError("Demucs 模型正在下载中（首次约需30秒），请稍后重试。")

        try:
            import demucs.separate
            demucs.separate.main([
                "--two-stems", "vocals",
                "-n", "htdemucs",
                "--out", work_dir,
                extracted_audio,
            ])
        except Exception as e:
            logger.warning(f"[DUB] Demucs separation failed: {e}, falling back to simple replacement")
            return None

        # Demucs outputs to: {work_dir}/htdemucs/original_audio/no_vocals.wav
        bg_path = os.path.join(work_dir, "htdemucs", "original_audio", "no_vocals.wav")
        if not os.path.exists(bg_path):
            # Try alternate path structures
            for root, dirs, files in os.walk(work_dir):
                if "no_vocals.wav" in files:
                    bg_path = os.path.join(root, "no_vocals.wav")
                    break

        if os.path.exists(bg_path):
            logger.info(f"[DUB] Background audio separated successfully: {bg_path}")
            return bg_path

        logger.warning("[DUB] Demucs output not found, falling back to simple replacement")
        return None

    def _ensure_bg_audio_cached(self, frame, video_path: str, video_url: str) -> Optional[str]:
        """Ensure background audio is separated and cached for this frame's video.

        Returns absolute path to bg audio WAV, or None if video has no audio.
        Caches result to output/audio/bg_{frame_id}.wav — only re-runs Demucs
        if video source changed.
        """
        if frame.bg_audio_url and frame.bg_audio_source_video == video_url:
            cached_path = _safe_resolve_path("output", frame.bg_audio_url)
            if os.path.exists(cached_path):
                logger.info(f"[DUB] Background audio cache hit: {frame.bg_audio_url}")
                return cached_path

        import tempfile
        import shutil
        work_dir = tempfile.mkdtemp(prefix="demucs_")
        try:
            bg_path = self._separate_background_audio(video_path, work_dir)
            if not bg_path:
                frame.bg_audio_url = None
                frame.bg_audio_source_video = video_url
                return None

            cache_filename = f"bg_{frame.id}.wav"
            cache_path = _safe_resolve_path(os.path.join("output", "audio"), cache_filename)
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            shutil.copy2(bg_path, cache_path)

            frame.bg_audio_url = f"audio/{cache_filename}"
            frame.bg_audio_source_video = video_url
            logger.info(f"[DUB] Background audio cached: {cache_filename}")
            return cache_path
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def preview_dub(self, script_id: str, frame_id: str, video_task_id: str, offset_ms: int = 0) -> "Script":
        """Generate a preview dubbed video (Demucs cached + fast adelay+amix+mux).

        Replaces any existing preview_video_url (lazy cleanup).
        Does NOT touch dubbed_video_url.
        """
        _validate_safe_id(script_id, "script_id")
        # Force numeric type so the adelay filter string is provably shell-safe.
        offset_ms = int(offset_ms)
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")

        if not frame.audio_url:
            raise ValueError("Frame has no TTS audio (audio_url). Generate dialogue audio first.")

        video_task = next((t for t in script.video_tasks if t.id == video_task_id), None)
        if not video_task or not video_task.video_url:
            raise ValueError(f"Video task {video_task_id} not found or has no video_url")

        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg is required for audio dubbing but was not found.")

        video_path = self._resolve_media_path(video_task.video_url, suffix=".mp4")
        tts_path = self._resolve_media_path(frame.audio_url, suffix=".mp3")

        if not video_path or not os.path.exists(video_path):
            raise ValueError(f"Video file not found: {video_task.video_url}")
        if not tts_path or not os.path.exists(tts_path):
            raise ValueError(f"Audio file not found: {frame.audio_url}")
        if os.path.getsize(tts_path) < 1000:
            raise ValueError("TTS audio file is invalid or empty. Please regenerate dialogue audio.")

        # Delete old preview (lazy cleanup)
        if frame.preview_video_url:
            old_preview = _safe_resolve_path("output", frame.preview_video_url)
            if os.path.exists(old_preview):
                try:
                    os.remove(old_preview)
                except OSError:
                    pass

        # frame.id comes from the store (== frame_id), keeping ffmpeg args taint-free.
        output_filename = f"preview_{frame.id}_{int(time.time())}.mp4"
        output_path = _safe_resolve_path(self._owner_output_dir(script, "video"), output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Ensure background audio is cached (Demucs runs only on first call or video change)
        bg_audio_path = self._ensure_bg_audio_cached(frame, video_path, video_task.video_url)

        import tempfile
        work_dir = tempfile.mkdtemp(prefix="dub_mix_")
        try:
            if bg_audio_path:
                mixed_audio = os.path.join(work_dir, "mixed.wav")
                delay_str = f"{offset_ms}|{offset_ms}"

                mix_cmd = [
                    ffmpeg_path, "-y",
                    "-i", bg_audio_path,
                    "-i", tts_path,
                    "-filter_complex",
                    f"[1:a]adelay={delay_str}[tts];[0:a][tts]amix=inputs=2:duration=first:weights=1 1[out]",
                    "-map", "[out]",
                    "-ac", "2", "-ar", "44100",
                    mixed_audio,
                ]

                logger.info(f"[DUB] Mixing TTS with background (adelay={offset_ms}ms)")
                subprocess.run(mix_cmd, check=True, capture_output=True, timeout=60)

                if not os.path.exists(mixed_audio):
                    raise RuntimeError("Audio mixing failed: output file not created")

                mux_cmd = [
                    ffmpeg_path, "-y",
                    "-i", video_path,
                    "-i", mixed_audio,
                    "-map", "0:v",
                    "-map", "1:a",
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]
                subprocess.run(mux_cmd, check=True, capture_output=True, timeout=60)
            else:
                delay_str = f"{offset_ms}|{offset_ms}"
                cmd = [
                    ffmpeg_path, "-y",
                    "-i", video_path,
                    "-i", tts_path,
                    "-filter_complex",
                    f"[1:a]adelay={delay_str}[tts];[tts]apad[out]",
                    "-map", "0:v",
                    "-map", "[out]",
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]
                logger.info(f"[DUB] Simple replacement with adelay={offset_ms}ms")
                subprocess.run(cmd, check=True, capture_output=True, timeout=120)

        except subprocess.CalledProcessError as e:
            stderr_msg = e.stderr.decode() if e.stderr else "No error output"
            logger.error(f"[DUB] FFmpeg failed: {stderr_msg[:400]}")
            raise RuntimeError(f"Audio dubbing failed: {stderr_msg[:200]}")
        finally:
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)

        if not os.path.exists(output_path):
            raise RuntimeError("Preview video was not created")

        frame.preview_video_url = os.path.relpath(output_path, "output")
        frame.dubbed_video_task_id = video_task_id
        frame.dub_offset_ms = offset_ms
        self._save_data()

        logger.info(f"[DUB] Preview generated: {output_filename}")
        return script

    def apply_dub(self, script_id: str, frame_id: str) -> "Script":
        """Promote preview_video_url to dubbed_video_url."""
        _validate_safe_id(script_id, "script_id")
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")

        if not frame.preview_video_url:
            raise ValueError("No preview to apply. Generate a preview first.")

        # Delete old dubbed file
        if frame.dubbed_video_url:
            old_path = _safe_resolve_path("output", frame.dubbed_video_url)
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass

        frame.dubbed_video_url = frame.preview_video_url
        frame.preview_video_url = None
        self._save_data()

        logger.info(f"[DUB] Applied: {frame.dubbed_video_url}")
        return script

    def revert_dub(self, script_id: str, frame_id: str) -> "Script":
        """Revert dubbing — clear dubbed and preview, keep bg cache."""
        _validate_safe_id(script_id, "script_id")
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")

        for url_field in ("dubbed_video_url", "preview_video_url"):
            url = getattr(frame, url_field)
            if url:
                path = _safe_resolve_path("output", url)
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                setattr(frame, url_field, None)

        frame.dub_offset_ms = 0
        frame.dubbed_video_task_id = None
        self._save_data()
        return script

    def merge_videos(self, script_id: str) -> Script:
        """Step 5b: Merge selected videos into a single file."""
        _validate_safe_id(script_id, "script_id")
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        logger.info(f"[MERGE] Starting video merge for script {script_id}")
        
        # Check if ffmpeg is available (prioritize bundled version)
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            install_instructions = get_ffmpeg_install_instructions()
            error_msg = (
                "FFmpeg is required for video merging but was not found.\n\n"
                f"{install_instructions}\n\n"
                "After installation, restart the application."
            )
            logger.error(f"[MERGE] FFmpeg not found. {error_msg}")
            raise RuntimeError(error_msg)
        
        # Log ffmpeg version for debugging
        try:
            version_result = subprocess.run(
                [ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if version_result.returncode == 0:
                version_line = version_result.stdout.split('\n')[0] if version_result.stdout else "Unknown"
                logger.debug(f"[MERGE] Using FFmpeg: {version_line}")
                logger.debug(f"[MERGE] FFmpeg path: {ffmpeg_path}")
            else:
                logger.warning(f"[MERGE] Could not get FFmpeg version (exit code {version_result.returncode})")
        except Exception as e:
            logger.warning(f"[MERGE] Could not get FFmpeg version: {e}")
            
        # Collect video paths
        video_paths = []
        for i, frame in enumerate(script.frames):
            logger.info(f"[MERGE] Processing frame {i+1}/{len(script.frames)}: {frame.id}")

            # Prefer dubbed version (TTS audio already overlaid with lip-sync offset)
            if frame.dubbed_video_url:
                dubbed_path = _safe_resolve_path("output", frame.dubbed_video_url)
                if os.path.exists(dubbed_path):
                    logger.debug(f"[MERGE]   -> Using dubbed video: {frame.dubbed_video_url}")
                    video_paths.append(frame.dubbed_video_url)
                    continue
                else:
                    logger.warning(f"[MERGE]   -> Dubbed video file missing: {dubbed_path}, falling back")

            if not frame.selected_video_id:
                # Try to find a default completed video
                default_video = next((v for v in script.video_tasks if v.frame_id == frame.id and v.status == "completed"), None)
                if default_video and default_video.video_url:
                    logger.debug(f"[MERGE]   -> Using default video: {default_video.video_url}")
                    video_paths.append(default_video.video_url)
                else:
                    logger.warning(f"[MERGE]   -> No video selected or available, skipping")
                continue
                
            video = next((v for v in script.video_tasks if v.id == frame.selected_video_id), None)
            if video and video.video_url:
                logger.debug(f"[MERGE]   -> Selected video: {video.video_url}")
                video_paths.append(video.video_url)
            else:
                logger.warning(f"[MERGE]   -> Selected video {frame.selected_video_id} not found or has no URL")
                
        if not video_paths:
            logger.error("[MERGE] No videos found to merge!")
            raise ValueError("No videos selected to merge. Please select videos for each frame first.")
        
        logger.info(f"[MERGE] Found {len(video_paths)} videos to merge")
            
        # Create file list for ffmpeg
        # script.id comes from the store (== script_id), keeping ffmpeg args taint-free.
        list_path = _safe_resolve_path("output", f"merge_list_{script.id}.txt")
        abs_video_paths = []

        with open(list_path, "w") as f:
            for path in video_paths:
                # Resolve to absolute path
                if not path.startswith("http"):
                    abs_path = _safe_resolve_path("output", path)
                    if os.path.exists(abs_path):
                        f.write(f"file '{abs_path}'\n")
                        abs_video_paths.append(abs_path)
                        logger.debug(f"[MERGE] Added to list: {abs_path}")
                    else:
                        logger.warning(f"[MERGE] Video file not found: {abs_path}")
                        
        if not abs_video_paths:
            logger.error("[MERGE] No valid video files found on disk!")
            raise ValueError("No valid video files found. The video files may have been deleted or moved.")
        
        logger.info(f"[MERGE] Merge list created with {len(abs_video_paths)} videos")

        # Output path
        output_filename = f"merged_{script.id}_{int(time.time())}.mp4"
        output_path = _safe_resolve_path(self._owner_output_dir(script, "video"), output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        logger.debug(f"[MERGE] Output path: {output_path}")
        
        # Log video file details for debugging
        for i, path in enumerate(abs_video_paths):
            try:
                size_mb = os.path.getsize(path) / (1024 * 1024)
                logger.debug(f"[MERGE] Input video {i+1}: {os.path.basename(path)} ({size_mb:.2f} MB)")
            except Exception as e:
                logger.warning(f"[MERGE] Could not get size for video {i+1}: {e}")
        
        # Run ffmpeg
        # Use re-encoding for better compatibility (slower but more reliable)
        # -c:v libx264 -c:a aac ensures consistent output format
        cmd = [
            ffmpeg_path, "-y",  # Use the detected ffmpeg path
            "-f", "concat",
            "-safe", "0",
            "-i", list_path,
            "-c:v", "libx264",  # Re-encode video with H.264
            "-crf", "23",       # Quality (lower = better, 23 is default)
            "-preset", "fast",  # Encoding speed
            "-c:a", "aac",      # Re-encode audio with AAC
            "-b:a", "128k",     # Audio bitrate
            "-movflags", "+faststart",  # Web optimization
            output_path
        ]
        
        logger.debug(f"[MERGE] Running FFmpeg command: {' '.join(cmd)}")
        logger.debug(f"[MERGE] Platform: {platform.system()} {platform.release()}")
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, timeout=600)  # 10 min timeout for re-encoding
            logger.debug(f"[MERGE] FFmpeg stdout: {result.stdout.decode()[:500] if result.stdout else 'empty'}")
            logger.info(f"[MERGE] FFmpeg completed successfully")
            
            # Persist the owner-scoped path; API responses convert it into a
            # short-lived signed media URL for the browser.
            script.merged_video_url = os.path.relpath(output_path, "output")

            # Verify file was created and log details
            if os.path.exists(output_path):
                file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
                logger.info(f"[MERGE] ✅ Merged video created successfully: {output_filename} ({file_size_mb:.2f} MB)")
                logger.info(f"[MERGE] ✅ Video stored at: {script.merged_video_url}")
            else:
                logger.error(f"[MERGE] ❌ Merged video file NOT found at: {output_path}")
                raise RuntimeError(f"Video merge completed but output file not found: {output_path}")

            # PR-3l · Pass 2: BGM mux. If script.bgm_url is set and the BGM
            # file exists, overlay it under the existing audio track at the
            # configured mix level. Dialogue stays on the original track of
            # the per-frame videos (sound-driven I2V already embedded it);
            # a future enhancement can swap to per-frame dialogue overlay.
            try:
                mixed_path = self._maybe_apply_bgm_mux(
                    script, output_path, ffmpeg_path,
                )
                if mixed_path:
                    # Replace the concat output with the mixed one (same filename)
                    os.replace(mixed_path, output_path)
                    logger.info(f"[MERGE] ✅ BGM mux applied — final file: {output_filename}")
            except Exception as bgm_err:
                # BGM is optional; log + carry on with the silent video
                logger.warning(f"[MERGE] BGM mux skipped due to error: {bgm_err}")

            self._save_data()

            # Cleanup list file
            if os.path.exists(list_path):
                os.remove(list_path)

            return script
        except subprocess.TimeoutExpired:
            logger.error("[MERGE] FFmpeg timed out after 600 seconds")
            raise RuntimeError("FFmpeg timed out. The videos may be too large.")
        except subprocess.CalledProcessError as e:
            stderr_msg = e.stderr.decode() if e.stderr else "No error output"
            stdout_msg = e.stdout.decode() if e.stdout else "No output"
            
            # Log full details for debugging
            logger.error(f"[MERGE] FFmpeg failed with exit code {e.returncode}")
            logger.error(f"[MERGE] FFmpeg command: {' '.join(cmd)}")
            logger.error(f"[MERGE] FFmpeg stderr: {stderr_msg}")
            logger.error(f"[MERGE] FFmpeg stdout: {stdout_msg}")
            logger.error(f"[MERGE] Video files attempted: {[os.path.basename(p) for p in abs_video_paths]}")
            
            # Extract user-friendly error message
            user_msg = self._extract_ffmpeg_error_message(stderr_msg, abs_video_paths)
            raise RuntimeError(user_msg)
    
    def _maybe_apply_bgm_mux(
        self,
        script: Script,
        video_path: str,
        ffmpeg_path: str,
    ) -> Optional[str]:
        """PR-3l · Overlay BGM at the configured mix level on top of the
        already-merged video. Returns the path of the new file, or None
        when no BGM is configured / the file is missing.

        Strategy: 2-input filter — amix the existing video audio (volume =
        dialogue_level/100) with the looped BGM (volume = bgm_level/100).
        SFX track will be added in a later pass when SFX files exist.
        """
        bgm_rel = (script.bgm_url or "").strip()
        if not bgm_rel:
            return None
        bgm_abs = _safe_resolve_path("output", bgm_rel)
        if not os.path.exists(bgm_abs):
            logger.info(f"[MERGE/BGM] preset file missing — {bgm_abs}; skipping mux")
            return None

        mix = script.mix_settings or {"dialogue": 100, "bgm": 35, "sfx": 60}
        dial = max(0, min(100, int(mix.get("dialogue", 100)))) / 100.0
        bgm_lvl = max(0, min(100, int(mix.get("bgm", 35)))) / 100.0

        mixed_path = video_path.replace(".mp4", "_mixed.mp4")
        # -stream_loop -1 loops BGM until shortest (the video) ends.
        # apad on the dialogue side avoids amix cutting early on silence.
        filter_complex = (
            f"[0:a]volume={dial:.3f},apad[a0];"
            f"[1:a]volume={bgm_lvl:.3f},aloop=loop=-1:size=2e9[a1];"
            f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        cmd = [
            ffmpeg_path, "-y",
            "-i", video_path,
            "-stream_loop", "-1", "-i", bgm_abs,
            "-filter_complex", filter_complex,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            mixed_path,
        ]
        logger.info(f"[MERGE/BGM] muxing BGM dial={dial:.2f} bgm={bgm_lvl:.2f} — {os.path.basename(bgm_abs)}")
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        except subprocess.CalledProcessError as e:
            stderr_msg = e.stderr.decode() if e.stderr else ""
            logger.warning(f"[MERGE/BGM] ffmpeg failed: {stderr_msg[:400]}")
            return None
        if not os.path.exists(mixed_path):
            logger.warning(f"[MERGE/BGM] mixed output not found: {mixed_path}")
            return None
        return mixed_path

    def _extract_ffmpeg_error_message(self, stderr: str, video_paths: List[str]) -> str:
        """
        Extract a user-friendly error message from ffmpeg stderr output.
        
        Args:
            stderr: The stderr output from ffmpeg
            video_paths: List of video file paths that were being processed
            
        Returns:
            A user-friendly error message
        """
        if not stderr:
            return "FFmpeg merge failed with no error output. Please check the log files."
        
        stderr_lower = stderr.lower()
        
        # Common error patterns with user-friendly messages
        if "no such file or directory" in stderr_lower:
            return (
                "One or more video files could not be found.\n"
                "The videos may have been deleted or moved.\n"
                "Please try regenerating the missing videos."
            )
        
        if "invalid data found" in stderr_lower or "invalid file" in stderr_lower or "moov atom not found" in stderr_lower:
            return (
                "One or more video files are corrupted or incomplete.\n"
                "This can happen if video generation was interrupted.\n"
                "Please try regenerating the affected videos."
            )
        
        if ("codec" in stderr_lower and ("not supported" in stderr_lower or "unknown" in stderr_lower)):
            return (
                "Video codec compatibility issue detected.\n"
                "The video format may not be supported by your FFmpeg installation.\n"
                "Try updating FFmpeg to the latest version."
            )
        
        if "permission denied" in stderr_lower or "access is denied" in stderr_lower:
            return (
                "Permission denied when accessing video files.\n"
                "Please check that the application has read/write permissions\n"
                "for the output directory."
            )
        
        if "disk full" in stderr_lower or "no space" in stderr_lower:
            return (
                "Insufficient disk space to create the merged video.\n"
                "Please free up some space and try again."
            )
        
        if "height not divisible" in stderr_lower or "width not divisible" in stderr_lower:
            return (
                "Video resolution compatibility issue.\n"
                "The videos have incompatible dimensions.\n"
                "This should not happen - please report this issue."
            )
        
        if "invalid argument" in stderr_lower:
            # Check if it's related to file list
            if any("filelist" in line.lower() or "concat" in line.lower() for line in stderr.split('\n')):
                return (
                    "FFmpeg could not read the video file list.\n"
                    "This might be a file path encoding issue.\n"
                    "Please ensure video filenames don't contain special characters."
                )
        
        # Fallback: extract the most relevant error line
        # Usually the last non-empty line before the final summary
        error_lines = [line.strip() for line in stderr.split('\n') if line.strip()]
        if error_lines:
            # Look for lines that seem like actual errors (contain "error", "failed", etc.)
            for line in reversed(error_lines):
                line_lower = line.lower()
                if any(keyword in line_lower for keyword in ['error', 'failed', 'invalid', 'cannot', 'unable']):
                    # Truncate if too long
                    if len(line) > 200:
                        line = line[:200] + "..."
                    return f"FFmpeg error: {line}\n\nPlease check the application logs for more details."
            
            # If no error keyword found, use last line
            last_line = error_lines[-1]
            if len(last_line) > 200:
                last_line = last_line[:200] + "..."
            return f"FFmpeg merge failed: {last_line}\n\nPlease check the application logs for more details."
        
        return "FFmpeg merge failed with unknown error. Please check the application logs for details."

    def create_asset_video_task(self, script_id: str, asset_id: str, asset_type: str, prompt: str, duration: int = 5, aspect_ratio: str = None) -> Tuple[Script, str]:
        """Creates a new video generation task for an asset (R2V)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        # Find asset
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
            
        # Use main image as reference
        image_url = target_asset.image_url
        if not image_url:
             # Try fallback for character
             if asset_type == "character":
                 image_url = target_asset.full_body_image_url or target_asset.avatar_url
        
        if not image_url:
            raise ValueError("Asset has no reference image")

        # Save prompt to asset
        if prompt:
            target_asset.video_prompt = prompt
            
        task_id = str(uuid.uuid4())
        
        # Create VideoTask
        task = VideoTask(
            id=task_id,
            project_id=script_id,
            owner_user_id=script.owner_user_id,
            owner_profile_id=script.owner_profile_id,
            asset_id=asset_id, # Link to asset
            image_url=image_url,
            prompt=prompt or f"Cinematic shot of {target_asset.name}",
            status="pending",
            duration=duration,
            model=script.model_settings.r2v_model if hasattr(script.model_settings, 'r2v_model') and script.model_settings.r2v_model else "wan2.7-r2v",
            generation_mode="r2v",
            created_at=time.time()
        )
        
        # Add to script.video_tasks for global tracking
        if not script.video_tasks:
            script.video_tasks = []
        script.video_tasks.append(task)
        
        # Add to asset's video_assets list
        if not target_asset.video_assets:
            target_asset.video_assets = []
        target_asset.video_assets.append(task)
        
        self._save_data()
        return script, task_id

    def process_video_task(self, script_id: str, task_id: str):
        """Processes a video task."""
        script = self.get_script(script_id)
        if not script:
            logger.error(f"Script {script_id} not found for task {task_id}")
            return
            
        task = next((t for t in script.video_tasks if t.id == task_id), None)
        
        if not task:
            logger.error(f"Task {task_id} not found in script {script_id}")
            return

        try:
            # Update status to processing
            task.status = "processing"
            self._save_data()

            # Persisted tasks and asset motion tasks also need ownership validation.
            is_uniart_task = (task.model or "").startswith(("uniart/minimax-h3-", "uniart/seedance-"))
            if is_uniart_task and not (task.provider_name == "uniart" and task.provider_task_id):
                task.reference_image_urls = [resolve_studio_reference(ref, script.owner_profile_id) for ref in task.reference_image_urls]
                task.reference_video_urls = [resolve_studio_reference(ref, script.owner_profile_id) for ref in task.reference_video_urls]
                if task.image_url:
                    task.image_url = resolve_studio_reference(task.image_url, script.owner_profile_id)
                if task.audio_url:
                    task.audio_url = resolve_studio_reference(task.audio_url, script.owner_profile_id)
            
            # Download image to temp file
            img_path = None
            if task.image_url and not (task.provider_name == "uniart" and task.provider_task_id):
                img_path = self._download_temp_image(task.image_url)
            
            # Generate video
            output_filename = f"video_{task_id}.mp4"
            output_path = os.path.join(self._owner_output_dir(script, "video"), output_filename)
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # Handle Audio Logic
            # 1. Silent: audio_url=None, audio=False
            # 2. AI Sound: audio_url=None, audio=True
            # 3. Sound Driven: audio_url=URL (audio param ignored)
            
            final_audio_url = None
            final_generate_audio = False
            
            if task.audio_url:
                # Sound Driven Mode
                final_audio_url = task.audio_url
                final_generate_audio = False # API says audio param ignored if url present, but let's be explicit
            elif task.generate_audio:
                # AI Sound Mode
                final_audio_url = None
                final_generate_audio = True
            else:
                # Silent Mode
                final_audio_url = None
                final_generate_audio = False

            # Ensure img_url is passed correctly for OSS
            img_url = task.image_url

            # Route to the appropriate model based on task.model
            model_name = task.model or ""
            model_name_lower = model_name.lower()
            backend = self._resolve_video_backend(model_name)
            use_vendor_kling = backend == "vendor" and (
                model_name_lower.startswith("kling-") or model_name_lower.startswith("kling/kling-")
            )
            use_vendor_vidu = backend == "vendor" and (
                model_name_lower.startswith("vidu")
                or model_name_lower.startswith("viduq2")
                or model_name_lower.startswith("viduq3")
                or model_name_lower.startswith("vidu/vidu")
            )
            use_uniart = backend == "uniart" and (model_name_lower.startswith("uniart/seedance-") or model_name_lower.startswith("uniart/minimax-h3-"))
            use_mulerouter = backend == "mulerouter" and model_name_lower.startswith("seedance")

            if use_uniart:
                from ...models.uniart import UniArtVideoModel
                script_owner = self.get_script(script_id)
                if not script_owner or not script_owner.owner_user_id or not script_owner.owner_profile_id:
                    raise RuntimeError("Video task has no authenticated owner")
                uniart_model = UniArtVideoModel(
                    runtime_uniart_for_owner(
                        script_owner.owner_user_id,
                        script_owner.owner_profile_id,
                    )
                )
                def save_provider_task(provider_task_id):
                    task.provider_name = "uniart"
                    task.provider_task_id = provider_task_id
                    self._save_data()

                reference_images = list(task.reference_image_urls)
                # Asset motion references use image_url as their sole visual input.
                if task.generation_mode == "r2v" and task.image_url and task.image_url not in reference_images:
                    reference_images.insert(0, task.image_url)
                from .reference_prompt import bind_storyboard_prompt
                submitted_prompt = bind_storyboard_prompt(task.prompt, task.model, len(reference_images))
                # Storyboard cuts can be shorter than the provider's output
                # window. Normalize at the submission boundary as protection
                # for mobile clients or cached frontends that predate the UI
                # validation. The authored shot duration remains unchanged.
                max_duration = 15 if "minimax-h3" in model_name_lower else 30
                provider_duration = max(4, min(max_duration, task.duration))
                video_path, _ = uniart_model.generate(
                    prompt=submitted_prompt, output_path=output_path, img_url=img_url, img_path=img_path,
                    duration=provider_duration, resolution=task.resolution, aspect_ratio=task.ratio or "16:9",
                    model=task.model,
                    mode={"r2v": "reference2video", "i2v": "image2video", "t2v": "text2video"}[task.generation_mode],
                    ref_image_urls=reference_images if task.generation_mode == "r2v" else [],
                    ref_video_urls=task.reference_video_urls if task.generation_mode == "r2v" else [],
                    ref_audio_urls=[task.audio_url] if task.audio_url and task.generation_mode == "r2v" else [],
                    generate_audio=task.generate_audio,
                    seed=task.seed,
                    on_task_submitted=save_provider_task,
                    resume_task_id=task.provider_task_id if task.provider_name == "uniart" else None,
                )
            elif use_mulerouter:
                if self._mulerouter_video_model is None:
                    from ...models.mulerouter import MuleRouterVideoModel
                    self._mulerouter_video_model = MuleRouterVideoModel({})
                video_path, _ = self._mulerouter_video_model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_url=img_url,
                    img_path=img_path,
                    duration=task.duration,
                    resolution=task.resolution,
                    aspect_ratio=task.ratio or "16:9",
                    seed=task.seed,
                    watermark=bool(task.watermark) if task.watermark is not None else False,
                    generation_mode=task.generation_mode,
                    ref_image_urls=task.reference_image_urls if task.generation_mode == "r2v" else None,
                )
            elif use_vendor_kling:
                # Use Kling model (cached)
                if self._kling_model is None:
                    from ...models.kling import KlingModel
                    self._kling_model = KlingModel({})
                video_path, _ = self._kling_model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_url=img_url,
                    img_path=img_path,
                    duration=task.duration,
                    model=task.model,
                    negative_prompt=task.negative_prompt,
                    aspect_ratio="16:9",
                    mode=task.mode or "std",
                    sound=task.sound or "off",
                    cfg_scale=task.cfg_scale,
                )
            elif use_vendor_vidu:
                # Use Vidu model (cached)
                if self._vidu_model is None:
                    from ...models.vidu import ViduModel
                    self._vidu_model = ViduModel({})
                video_path, _ = self._vidu_model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_url=img_url,
                    img_path=img_path,
                    duration=task.duration,
                    model=task.model,
                    resolution=task.resolution,
                    aspect_ratio="16:9",
                    seed=task.seed or 0,
                    audio=task.vidu_audio if task.vidu_audio is not None else True,
                    movement_amplitude=task.movement_amplitude or "auto",
                )
            else:
                # Default: Wanx model
                # Issue 17: persist provider IDs (Bailian / DashScope task_id +
                # request_id) onto our VideoTask the moment wanx gets them, BEFORE
                # the long polling loop. Lets the user copy them from the queue
                # panel even mid-generation if the task hangs.
                def _capture_provider_ids(provider_name: str, ptask_id: Optional[str], preq_id: Optional[str]) -> None:
                    task.provider_name = provider_name
                    task.provider_task_id = ptask_id
                    task.provider_request_id = preq_id
                    try:
                        self._save_data()
                    except Exception:
                        logger.warning("Failed to persist provider IDs mid-flight; will retry at task completion")
                video_path, _ = self.video_generator.model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_path=img_path,
                    img_url=img_url,
                    duration=task.duration,
                    seed=task.seed,
                    resolution=task.resolution,
                    # Pass new params
                    audio_url=final_audio_url,
                    audio=final_generate_audio,
                    prompt_extend=task.prompt_extend,
                    negative_prompt=task.negative_prompt,
                    model=task.model,
                    shot_type=task.shot_type,
                    ref_video_urls=task.reference_video_urls if task.generation_mode == "r2v" else None,
                    ref_image_urls=task.reference_image_urls if task.generation_mode == "r2v" else None,
                    ratio=task.ratio,
                    # Pass watermark explicitly; wanx.generate's default is False so
                    # None becomes False, matching "leave to provider default = off".
                    watermark=bool(task.watermark) if task.watermark is not None else False,
                    audio_setting=task.audio_setting,
                    camera_motion=None,
                    subject_motion=None,
                    on_provider_ids=_capture_provider_ids,
                )
            
            task.video_url = os.path.relpath(output_path, "output")
            task.status = "completed"
            task.error = None
            
            # Sync with asset if this is an asset video
            if task.asset_id:
                self._sync_asset_video_task(script, task)
            
        except Exception as e:
            import traceback
            logger.exception("Failed to process video task")
            logger.error(f"Video generation failed: {e}")
            task.status = "failed"
            task.error = str(e)
            if task.asset_id:
                self._sync_asset_video_task(script, task)
            
        self._save_data()

    def _sync_asset_video_task(self, script: Script, task: VideoTask):
        """Syncs the updated task status/url back to the asset's video_assets list."""
        target_asset = None
        # Search in all asset types
        for char in script.characters:
            if char.id == task.asset_id:
                target_asset = char
                break
        if not target_asset:
            for scene in script.scenes:
                if scene.id == task.asset_id:
                    target_asset = scene
                    break
        if not target_asset:
            for prop in script.props:
                if prop.id == task.asset_id:
                    target_asset = prop
                    break
        
        if target_asset:
            # Find and update the task in the asset's list
            for i, t in enumerate(target_asset.video_assets):
                if t.id == task.id:
                    target_asset.video_assets[i] = task
                    break
            else:
                # Not found, append it (shouldn't happen if created correctly, but good fallback)
                target_asset.video_assets.append(task)

    def delete_asset_video(self, script_id: str, asset_id: str, asset_type: str, video_id: str) -> Script:
        """Deletes a video from an asset."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # Find asset
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
        
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        
        # Find the task first to get video_url for file deletion
        video_task_to_delete = None
        if script.video_tasks:
            video_task_to_delete = next((v for v in script.video_tasks if v.id == video_id), None)
        
        # Remove from asset's video_assets
        if target_asset.video_assets:
            original_len = len(target_asset.video_assets)
            target_asset.video_assets = [v for v in target_asset.video_assets if v.id != video_id]
            if len(target_asset.video_assets) == original_len and not video_task_to_delete:
                 # Only raise if not found in either place, or just log warning?
                 # If found in global list but not asset list, it's weird but we should proceed.
                 pass

        # Also remove from script.video_tasks
        if script.video_tasks:
            script.video_tasks = [v for v in script.video_tasks if v.id != video_id]
        
        # Try to delete the video file
        try:
            if video_task_to_delete and video_task_to_delete.video_url:
                video_path = os.path.join("output", video_task_to_delete.video_url)
                if os.path.exists(video_path):
                    os.remove(video_path)
                    logger.info(f"Deleted video file: {video_path}")
        except Exception as e:
            logger.warning(f"Failed to delete video file: {e}")
        
        self._save_data()
        return script

    def generate_audio(self, script_id: str) -> Script:
        """Step 5: Generate audio (Dialogue & SFX)."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        logger.info(f"Generating audio for script {script.id}")
        
        for frame in script.frames:
            # Generate Dialogue
            if frame.dialogue:
                speaker = None
                if frame.character_ids:
                    speaker = next((c for c in script.characters if c.id == frame.character_ids[0]), None)
                
                if speaker:
                    self.audio_generator.generate_dialogue(
                        frame, speaker,
                        speed=speaker.voice_speed,
                        pitch=speaker.voice_pitch,
                        volume=speaker.voice_volume
                    )
            
            # Generate SFX (Text-to-Audio)
            if frame.action_description:
                self.audio_generator.generate_sfx(frame)
                
            # Generate SFX (Video-to-Audio) - if video exists
            if frame.video_url:
                self.audio_generator.generate_sfx_from_video(frame)
                
            # Generate BGM
            # Simple logic: generate BGM for every frame (or scene start)
            self.audio_generator.generate_bgm(frame)
                
        self._save_data()
        return script

    def generate_dialogue_line(
        self,
        script_id: str,
        frame_id: str,
        speed: float = 1.0,
        pitch: float = 1.0,
        volume: int = 50,
        instructions: Optional[str] = None,
    ) -> Script:
        """Generates audio for a specific frame with parameters.

        PR-3j: accepts `instructions` (chip emotion + free text). For
        custom voices (clone/design) we resolve the target_model/family
        override here so generation reuses the registered voice model.
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        dialogue_text = (
            (frame.dialogue_structured.line if frame.dialogue_structured else None)
            or frame.dialogue
        )
        if dialogue_text:
            speaker = None
            if frame.character_ids:
                speaker = next((c for c in script.characters if c.id == frame.character_ids[0]), None)
            speaker_name = frame.speaker or (
                frame.dialogue_structured.speaker if frame.dialogue_structured else None
            )
            if not speaker and speaker_name:
                key = speaker_name.strip().lower()
                speaker = next(
                    (c for c in script.characters if c.name.strip().lower() == key
                     or key in c.name.strip().lower()
                     or c.name.strip().lower() in key),
                    None,
                )

            if speaker:
                model_override = None
                family_override = None
                if speaker.voice_id:
                    custom = self.find_custom_voice(speaker.voice_id)
                    if custom:
                        model_override = custom.target_model
                        family_override = custom.family
                self.audio_generator.generate_dialogue(
                    frame, speaker, speed, pitch, volume,
                    instructions=instructions,
                    model_override=model_override,
                    family_override=family_override,
                )

        self._save_data()
        return script

    def bind_voice(self, script_id: str, char_id: str, voice_id: str, voice_name: str) -> Script:
        """Binds a voice to a character."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        char = next((c for c in script.characters if c.id == char_id), None)
        if not char:
            raise ValueError("Character not found")
            
        char.voice_id = voice_id
        char.voice_name = voice_name
        self._save_data()
        return script

    def _select_variant_in_asset(self, image_asset: Any, variant_id: str) -> Any:
        """Helper to select a variant in an ImageAsset. Returns the selected variant if found."""
        from .models import AssetUnit
        if image_asset is None:
            return None
        variants = image_asset.image_variants if isinstance(image_asset, AssetUnit) else image_asset.variants
        for variant in variants:
            if variant.id == variant_id:
                if isinstance(image_asset, AssetUnit):
                    image_asset.selected_image_id = variant_id
                else:
                    image_asset.selected_id = variant_id
                return variant
        return None

    def _delete_variant_in_asset(self, image_asset: Any, variant_id: str) -> bool:
        """Delete an image variant from either ImageAsset or AssetUnit."""
        from .models import AssetUnit
        if image_asset is None:
            return False
        variants_attr = "image_variants" if isinstance(image_asset, AssetUnit) else "variants"
        selected_attr = "selected_image_id" if isinstance(image_asset, AssetUnit) else "selected_id"
        variants = getattr(image_asset, variants_attr, [])
        if not variants:
            return False

        remaining = [variant for variant in variants if variant.id != variant_id]
        if len(remaining) < len(variants):
            setattr(image_asset, variants_attr, remaining)
            if getattr(image_asset, selected_attr, None) == variant_id:
                setattr(image_asset, selected_attr, remaining[-1].id if remaining else None)
            return True
        return False

    @staticmethod
    def _selected_image_variant(image_asset: Any) -> Any:
        """Return the selected image variant for ImageAsset or AssetUnit."""
        from .models import AssetUnit
        if image_asset is None:
            return None
        variants = image_asset.image_variants if isinstance(image_asset, AssetUnit) else image_asset.variants
        selected_id = image_asset.selected_image_id if isinstance(image_asset, AssetUnit) else image_asset.selected_id
        return next((variant for variant in variants if variant.id == selected_id), None)

    @staticmethod
    def _asset_image_containers(target_asset: Any, asset_type: str) -> List[Any]:
        """Return every image-variant container owned by a semantic asset."""
        if asset_type == "character":
            return [
                getattr(target_asset, "reference_sheet", None),
                getattr(target_asset, "full_body_asset", None),
                getattr(target_asset, "three_view_asset", None),
                getattr(target_asset, "headshot_asset", None),
            ]
        return [getattr(target_asset, "image_asset", None)]

    def update_asset_variant_metadata(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        variant_id: str,
        reference_view_role: Optional[str] = None,
        reference_distance: Optional[str] = None,
    ) -> Script:
        """Label a child reference view while preserving its semantic asset identity."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if target_asset is None:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        for container in self._asset_image_containers(target_asset, asset_type):
            if container is None:
                continue
            from .models import AssetUnit
            variants = container.image_variants if isinstance(container, AssetUnit) else container.variants
            variant = next((item for item in variants if item.id == variant_id), None)
            if variant is None:
                continue
            variant.reference_view_role = reference_view_role or None
            variant.reference_distance = reference_distance or None
            self._save_after_asset_mutation(source)
            return script
        raise ValueError(f"Variant {variant_id} not found")

    def set_asset_cover_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str) -> Dict[str, Any]:
        """Persist a library cover independently from generation-container selections."""
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Unsupported asset type: {asset_type}")
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
        if target_asset is None:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        variant = next(
            (item for item in self._asset_image_variants(target_asset, asset_type) if item.id == variant_id),
            None,
        )
        if variant is None:
            raise ValueError(f"Variant {variant_id} does not belong to asset {asset_id}")

        target_asset.cover_variant_id = variant_id
        self._save_after_asset_mutation(source)
        return {
            "asset_type": asset_type,
            "asset_id": asset_id,
            "cover_variant_id": variant_id,
            "variant": {
                "id": variant.id,
                "url": variant.url,
                "created_at": variant.created_at,
            },
        }

    def select_asset_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str = None) -> Script:
        """Selects a specific variant for an asset."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        source = "script"
        if asset_type in ("character", "scene", "prop"):
            target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
            if target_asset is None:
                raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        if asset_type == "character":
            if target_asset:
                # If generation_type is specified, only select from that specific asset
                if generation_type == "full_body":
                    variant = self._select_variant_in_asset(target_asset.full_body_asset, variant_id)
                    if variant:
                        target_asset.full_body_image_url = variant.url
                        target_asset.image_url = variant.url  # Legacy sync
                elif generation_type == "three_view":
                    variant = self._select_variant_in_asset(target_asset.three_view_asset, variant_id)
                    if variant:
                        target_asset.three_view_image_url = variant.url
                elif generation_type == "headshot":
                    variant = self._select_variant_in_asset(target_asset.headshot_asset, variant_id)
                    if variant:
                        target_asset.headshot_image_url = variant.url
                        target_asset.avatar_url = variant.url  # Sync avatar
                elif generation_type == "reference_sheet":
                    # R2V v2: reference_sheet is the canonical asset unit for
                    # the CastWorkbench flow. Selecting a variant here updates
                    # selected_image_id + legacy image_url so the rest of the
                    # app (storyboard reference, etc.) sees the pick.
                    variant = self._select_variant_in_asset(getattr(target_asset, "reference_sheet", None), variant_id)
                    if variant:
                        if target_asset.reference_sheet:
                            target_asset.reference_sheet.selected_image_id = variant.id
                        target_asset.image_url = variant.url
                else:
                    # Legacy fallback: search all assets (for backward compatibility)
                    variant = self._select_variant_in_asset(target_asset.full_body_asset, variant_id)
                    if variant:
                        target_asset.full_body_image_url = variant.url
                        target_asset.image_url = variant.url

                    if not variant:
                        variant = self._select_variant_in_asset(target_asset.three_view_asset, variant_id)
                        if variant:
                            target_asset.three_view_image_url = variant.url

                    if not variant:
                        variant = self._select_variant_in_asset(target_asset.headshot_asset, variant_id)
                        if variant:
                            target_asset.headshot_image_url = variant.url
                            target_asset.avatar_url = variant.url
                        
        elif asset_type == "scene":
            if target_asset:
                variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                if variant:
                    target_asset.image_url = variant.url

        elif asset_type == "prop":
            if target_asset:
                variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                if variant:
                    target_asset.image_url = variant.url

        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                # Check rendered_image_asset
                variant = self._select_variant_in_asset(target_asset.rendered_image_asset, variant_id)
                if variant:
                    target_asset.rendered_image_url = variant.url
                    target_asset.image_url = variant.url # Main image is rendered one
                
                # Also check image_asset (sketch)?
                if not variant:
                    variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                    # If sketch, maybe don't update main image_url if rendered exists?
                    # For now, let's assume we only select rendered variants for frames usually.

        self._save_after_asset_mutation(source)
        return script

    def delete_asset_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str) -> Script:
        """Deletes a specific variant from an asset."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        source = "script"
        deleted = False
        target_asset = None
        if asset_type in ("character", "scene", "prop"):
            target_asset, source = self._find_asset_with_source(script, asset_id, asset_type)
            if target_asset is None:
                raise ValueError(f"Asset {asset_id} of type {asset_type} not found")

        if asset_type == "character":
            for field, legacy_url_field in (
                ("reference_sheet", "image_url"),
                ("full_body_asset", "image_url"),
                ("three_view_asset", "three_view_image_url"),
                ("headshot_asset", "headshot_image_url"),
            ):
                image_asset = getattr(target_asset, field, None)
                if self._delete_variant_in_asset(image_asset, variant_id):
                    selected = self._selected_image_variant(image_asset)
                    setattr(target_asset, legacy_url_field, selected.url if selected else None)
                    if field == "headshot_asset":
                        target_asset.avatar_url = selected.url if selected else None
                    deleted = True
                    break

        elif asset_type in ("scene", "prop"):
            deleted = self._delete_variant_in_asset(target_asset.image_asset, variant_id)
            if deleted:
                selected = self._selected_image_variant(target_asset.image_asset)
                target_asset.image_url = selected.url if selected else None

        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                if self._delete_variant_in_asset(target_asset.rendered_image_asset, variant_id):
                    deleted = True
                    if target_asset.rendered_image_asset.selected_id:
                        selected = next((v for v in target_asset.rendered_image_asset.variants if v.id == target_asset.rendered_image_asset.selected_id), None)
                        target_asset.rendered_image_url = selected.url if selected else None
                        target_asset.image_url = selected.url if selected else None
                    else:
                        target_asset.rendered_image_url = None
                        # Don't clear image_url if it might fall back to sketch? 
                        # For now, clear it if rendered is cleared.
                        target_asset.image_url = None

        if not deleted:
            raise ValueError(f"Variant {variant_id} not found")

        if (
            asset_type in ("character", "scene", "prop")
            and target_asset is not None
            and getattr(target_asset, "cover_variant_id", None) == variant_id
        ):
            target_asset.cover_variant_id = None

        cleaned_frame_selection = False
        for frame in script.frames:
            selection = frame.workbench_reference_variant_ids
            if not selection:
                continue
            next_ids = [item for item in selection.get(asset_id, []) if item != variant_id]
            if next_ids == selection.get(asset_id, []):
                continue
            if next_ids:
                selection[asset_id] = next_ids
            else:
                selection.pop(asset_id, None)
            cleaned_frame_selection = True

        self._save_after_asset_mutation(source)
        if source != "script" and cleaned_frame_selection:
            self._save_data()
        return script

    def update_model_settings(self, script_id: str, t2i_model: str = None, i2i_model: str = None, i2v_model: str = None, r2v_model: str = None, character_aspect_ratio: str = None, scene_aspect_ratio: str = None, prop_aspect_ratio: str = None, storyboard_aspect_ratio: str = None, image_model: str = None) -> Script:
        """Updates the model settings for a script."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        if t2i_model:
            script.model_settings.t2i_model = t2i_model
        if i2i_model:
            script.model_settings.i2i_model = i2i_model
        if i2v_model:
            script.model_settings.i2v_model = i2v_model
        if r2v_model:
            script.model_settings.r2v_model = r2v_model
        if image_model:
            script.model_settings.image_model = image_model
        if character_aspect_ratio:
            script.model_settings.character_aspect_ratio = character_aspect_ratio
        if scene_aspect_ratio:
            script.model_settings.scene_aspect_ratio = scene_aspect_ratio
        if prop_aspect_ratio:
            script.model_settings.prop_aspect_ratio = prop_aspect_ratio
        if storyboard_aspect_ratio:
            script.model_settings.storyboard_aspect_ratio = storyboard_aspect_ratio

        self._save_data()
        return script

    def _set_variant_favorite(self, image_asset: Any, variant_id: str, is_favorited: bool) -> bool:
        """Helper to set favorite status of a variant. Returns True if found."""
        if not image_asset:
            return False
        variants = getattr(image_asset, "image_variants", None)
        if variants is None:
            variants = getattr(image_asset, "variants", None)
        if not variants:
            return False
        for v in variants:
            if v.id == variant_id:
                v.is_favorited = is_favorited
                return True
        return False

    def toggle_variant_favorite(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, is_favorited: bool, generation_type: str = None) -> Script:
        """Toggles the favorite status of a variant."""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        found = False
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            if target_asset:
                if generation_type == "full_body":
                    found = self._set_variant_favorite(target_asset.full_body_asset, variant_id, is_favorited)
                elif generation_type == "reference_sheet":
                    found = self._set_variant_favorite(target_asset.reference_sheet, variant_id, is_favorited)
                elif generation_type == "three_view":
                    found = self._set_variant_favorite(target_asset.three_view_asset, variant_id, is_favorited)
                elif generation_type == "headshot":
                    found = self._set_variant_favorite(target_asset.headshot_asset, variant_id, is_favorited)
                else:
                    # Try all character assets
                    found = self._set_variant_favorite(target_asset.full_body_asset, variant_id, is_favorited) or \
                            self._set_variant_favorite(target_asset.three_view_asset, variant_id, is_favorited) or \
                            self._set_variant_favorite(target_asset.headshot_asset, variant_id, is_favorited)
        
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.rendered_image_asset, variant_id, is_favorited) or \
                        self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        if not found:
            raise ValueError(f"Variant {variant_id} not found")

        self._save_data()
        return script

    # ============================================================
    # Series Storage & CRUD
    # ============================================================

    @staticmethod
    def _assembly_resource_kind(kind: str) -> str:
        if kind not in ("project", "series"):
            raise AssemblyPlanValidationError(
                "assembly scope must be 'project' or 'series'"
            )
        return kind

    def _validate_assembly_plan_references(
        self,
        scope: str,
        resource_id: str,
        plan: AssemblyEditPlan,
    ) -> None:
        """Validate stable source IDs against the current owner-scoped store.

        Pydantic validates the shape and timeline geometry.  This second
        boundary is intentionally here, next to persistence, because only the
        pipeline can prove that an episode/frame/task belongs to the resource
        being edited.  We do not resolve or persist signed URLs.
        """
        self._assembly_resource_kind(scope)
        if plan.scope != scope:
            raise AssemblyPlanValidationError(
                f"plan scope {plan.scope!r} does not match {scope!r} resource"
            )

        if scope == "project":
            resource = self.get_script(resource_id)
            if not resource:
                raise AssemblyPlanValidationError("Project not found")
            projects = {resource.id: resource}
        else:
            resource = self.get_series(resource_id)
            if not resource:
                raise AssemblyPlanValidationError("Series not found")
            projects = {}
            for episode_id in resource.episode_ids:
                episode = self.get_script(episode_id, resource.owner_profile_id)
                if episode:
                    projects[episode.id] = episode

        for lane in plan.lanes:
            # A marker lane is retained for editor compatibility, but markers
            # themselves live in plan.markers and never need media ownership.
            for clip in lane.clips:
                project_id = clip.source_project_id or clip.source_episode_id
                if project_id is not None and project_id not in projects:
                    raise AssemblyPlanValidationError(
                        f"clip {clip.id} references project outside {scope}: {project_id}"
                    )

                if clip.source_episode_id is not None:
                    if clip.source_episode_id not in projects:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} references episode outside series: "
                            f"{clip.source_episode_id}"
                        )
                    if scope == "project" and clip.source_episode_id != resource_id:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} references a different project episode"
                        )

                if clip.source_project_id is not None and scope == "project":
                    if clip.source_project_id != resource_id:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} references a different project"
                        )

                # Editorial video clips must have an unambiguous project and a
                # durable frame or task identity.  Audio clips may be external
                # or carry only a source_ref, so they remain less restrictive.
                if lane.kind == "video":
                    if project_id is None:
                        raise AssemblyPlanValidationError(
                            f"video clip {clip.id} requires source_project_id"
                        )
                    if not clip.source_frame_id and not clip.source_task_id:
                        raise AssemblyPlanValidationError(
                            f"video clip {clip.id} requires source_frame_id or source_task_id"
                        )

                source_project = projects.get(project_id) if project_id else None
                frame = None
                task = None
                if clip.source_frame_id:
                    if source_project is None:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} has a frame without a valid source project"
                        )
                    frame = next(
                        (item for item in source_project.frames
                         if item.id == clip.source_frame_id),
                        None,
                    )
                    if frame is None:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} references unknown frame "
                            f"{clip.source_frame_id}"
                        )

                if clip.source_task_id:
                    if source_project is None:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} has a task without a valid source project"
                        )
                    task = next(
                        (item for item in source_project.video_tasks
                         if item.id == clip.source_task_id),
                        None,
                    )
                    if task is None:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} references unknown video task "
                            f"{clip.source_task_id}"
                        )
                    task_project_id = getattr(task, "project_id", None)
                    if task_project_id and task_project_id != source_project.id:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} video task belongs to another project"
                        )
                    task_frame_id = getattr(task, "frame_id", None)
                    if clip.source_frame_id and task_frame_id and task_frame_id != clip.source_frame_id:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} task/frame references do not match"
                        )

                if frame is not None and clip.source_episode_id:
                    # The frame lookup above is deliberately episode-local;
                    # this check makes the relation explicit for series plans.
                    if source_project.id != clip.source_episode_id:
                        raise AssemblyPlanValidationError(
                            f"clip {clip.id} frame is not owned by source episode"
                        )

        for marker in plan.markers:
            if marker.source_episode_id is None:
                continue
            if marker.source_episode_id not in projects:
                raise AssemblyPlanValidationError(
                    f"marker {marker.id} references episode outside {scope}: "
                    f"{marker.source_episode_id}"
                )
            if scope == "project" and marker.source_episode_id != resource_id:
                raise AssemblyPlanValidationError(
                    f"marker {marker.id} references a different project"
                )

    def get_assembly_plan(
        self,
        scope: str,
        resource_id: str,
    ) -> Optional[AssemblyEditPlan]:
        """Return an owner-scoped plan, or ``None`` for legacy resources."""
        self._assembly_resource_kind(scope)
        resource = (
            self.get_script(resource_id)
            if scope == "project"
            else self.get_series(resource_id)
        )
        if not resource:
            return None
        plan = getattr(resource, "assembly_plan", None)
        if plan is not None and plan.scope != scope:
            # Old/corrupt records should fail closed instead of being silently
            # interpreted as a plan for the other resource kind.
            raise AssemblyPlanValidationError(
                f"stored plan scope {plan.scope!r} does not match {scope!r}"
            )
        return plan

    def _resolve_assembly_video_source(
        self,
        clip: Any,
        source_project: Script,
    ) -> str:
        """Resolve one clip to a local, owner-scoped Motion output."""
        task = None
        frame = None
        if clip.source_frame_id:
            frame = next(
                (item for item in source_project.frames if item.id == clip.source_frame_id),
                None,
            )

        if clip.source_task_id:
            task = next(
                (item for item in source_project.video_tasks if item.id == clip.source_task_id),
                None,
            )
        elif frame and frame.selected_video_id:
            task = next(
                (item for item in source_project.video_tasks
                 if item.id == frame.selected_video_id),
                None,
            )

        if task is not None:
            if task.status != "completed":
                raise AssemblyPlanValidationError(
                    f"clip {clip.id} video task is not completed"
                )
            if task.owner_profile_id and task.owner_profile_id != source_project.owner_profile_id:
                raise AssemblyPlanValidationError(
                    f"clip {clip.id} video task belongs to another owner"
                )
            source_ref = task.video_url
        else:
            source_ref = frame.video_url if frame is not None else None

        if not source_ref:
            raise AssemblyPlanValidationError(
                f"clip {clip.id} has no rendered Motion output"
            )
        if source_ref.startswith(("http://", "https://")):
            raise AssemblyPlanValidationError(
                f"clip {clip.id} must use a local managed output"
            )

        try:
            if source_project.owner_profile_id:
                relative = resolve_studio_reference(
                    source_ref,
                    source_project.owner_profile_id,
                )
                source_path = _safe_resolve_path("output", relative)
            else:
                source_path = _safe_resolve_path("output", source_ref)
        except (OSError, ValueError) as exc:
            raise AssemblyPlanValidationError(
                f"clip {clip.id} source is outside local managed output"
            ) from exc

        if not os.path.isfile(source_path):
            raise AssemblyPlanValidationError(
                f"clip {clip.id} source media is missing"
            )
        return source_path

    def render_assembly_plan(
        self,
        scope: str,
        resource_id: str,
        owner_profile_id: Optional[str] = None,
    ) -> Any:
        """Compile a saved Assembly video timeline into one local MP4.

        This v1 compiler is deliberately explicit and video-only. Saving an
        edit plan never calls this method, and this method never submits a
        provider generation task.
        """
        self._assembly_resource_kind(scope)
        _validate_safe_id(resource_id, f"{scope}_id")
        resource = (
            self.get_script(resource_id, owner_profile_id)
            if scope == "project"
            else self.get_series(resource_id, owner_profile_id)
        )
        if not resource:
            raise AssemblyPlanValidationError(
                "Project not found" if scope == "project" else "Series not found"
            )
        plan = getattr(resource, "assembly_plan", None)
        if plan is None:
            raise AssemblyPlanValidationError("Assembly plan not found")

        # Revalidate at execution time: a referenced task or episode may have
        # changed since the plan was saved.
        self._validate_assembly_plan_references(scope, resource_id, plan)
        plan_revision = plan.revision

        unsupported = [
            lane.kind
            for lane in plan.lanes
            if lane.kind in ("dialogue", "bgm", "sfx")
            and any(clip.enabled for clip in lane.clips)
        ]
        if unsupported:
            kinds = ", ".join(sorted(set(unsupported)))
            raise AssemblyPlanValidationError(
                f"Assembly audio lanes are not supported by render v1: {kinds}"
            )

        clips = sorted(
            [
                clip
                for lane in plan.lanes
                if lane.kind == "video"
                for clip in lane.clips
                if clip.enabled
            ],
            key=lambda item: (item.timeline_start_ms, item.timeline_end_ms, item.id),
        )
        if not clips:
            raise AssemblyPlanValidationError("Assembly plan has no enabled video clips")

        cursor = 0
        for clip in clips:
            if clip.timeline_start_ms != cursor:
                if cursor == 0:
                    raise AssemblyPlanValidationError(
                        "Assembly video timeline must begin at 0"
                    )
                raise AssemblyPlanValidationError(
                    f"Assembly video timeline has a gap or overlap before clip {clip.id}"
                )
            cursor = clip.timeline_end_ms
        if cursor != plan.target_duration_ms:
            raise AssemblyPlanValidationError(
                "Assembly video timeline must end at target_duration_ms"
            )

        if scope == "project":
            projects = {resource.id: resource}
        else:
            projects = {
                episode_id: self.get_script(episode_id, resource.owner_profile_id)
                for episode_id in resource.episode_ids
            }

        source_paths: List[str] = []
        filter_steps: List[str] = []
        for index, clip in enumerate(clips):
            project_id = clip.source_project_id or clip.source_episode_id
            source_project = projects.get(project_id)
            if source_project is None:
                raise AssemblyPlanValidationError(
                    f"clip {clip.id} source project is unavailable"
                )
            source_paths.append(
                self._resolve_assembly_video_source(clip, source_project)
            )

            timeline_duration = (clip.timeline_end_ms - clip.timeline_start_ms) / 1000
            source_start = clip.source_start_ms / 1000
            source_end_ms = (
                clip.source_end_ms
                if clip.source_end_ms is not None
                else clip.source_start_ms + (clip.timeline_end_ms - clip.timeline_start_ms)
            )
            source_end = source_end_ms / 1000
            source_duration = source_end - source_start
            if source_duration <= 0:
                raise AssemblyPlanValidationError(
                    f"clip {clip.id} has a non-positive source range"
                )
            speed_factor = timeline_duration / source_duration
            filter_steps.append(
                f"[{index}:v]"
                f"trim=start={source_start:.6f}:end={source_end:.6f},"
                f"setpts=(PTS-STARTPTS)*{speed_factor:.9f},"
                "scale=1280:720:force_original_aspect_ratio=decrease,"
                "pad=1280:720:(ow-iw)/2:(oh-ih)/2,"
                "setsar=1,fps=24,format=yuv420p"
                f"[v{index}]"
            )

        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError(
                "FFmpeg is required for Assembly rendering. "
                + get_ffmpeg_install_instructions()
            )

        filter_steps.append(
            "".join(f"[v{index}]" for index in range(len(clips)))
            + f"concat=n={len(clips)}:v=1:a=0[outv]"
        )
        output_dir = self._owner_output_dir(resource, "video")
        os.makedirs(output_dir, exist_ok=True)
        output_path = _safe_resolve_path(
            output_dir,
            f"assembly_{scope}_{resource_id}_{int(time.time())}.mp4",
        )
        command = [ffmpeg_path, "-y"]
        for source_path in source_paths:
            command.extend(["-i", source_path])
        command.extend([
            "-filter_complex",
            ";".join(filter_steps),
            "-map",
            "[outv]",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "23",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
            output_path,
        ])

        try:
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Assembly FFmpeg render timed out") from exc
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
            logger.error("[ASSEMBLY] FFmpeg failed: %s", stderr)
            raise RuntimeError(
                self._extract_ffmpeg_error_message(stderr, source_paths)
            ) from exc

        if not os.path.isfile(output_path):
            raise RuntimeError("Assembly render completed without an output file")

        with self._save_lock:
            current = (
                self.get_script(resource_id, owner_profile_id)
                if scope == "project"
                else self.get_series(resource_id, owner_profile_id)
            )
            current_plan = getattr(current, "assembly_plan", None) if current else None
            if current_plan is None or current_plan.revision != plan_revision:
                try:
                    os.remove(output_path)
                except OSError:
                    pass
                raise AssemblyPlanConflictError(
                    "assembly plan changed while rendering",
                    current_revision=(current_plan.revision if current_plan else None),
                )
            current.merged_video_url = os.path.relpath(output_path, "output")
            current.updated_at = time.time()
            if scope == "project":
                self._save_data()
            else:
                self._save_series_data_unlocked()
        return current

    def save_assembly_plan(
        self,
        scope: str,
        resource_id: str,
        plan: AssemblyEditPlan,
        expected_revision: Optional[int] = None,
    ) -> AssemblyEditPlan:
        """Persist a validated plan with optimistic revision checking.

        New plans start at revision 1.  Existing plans require the caller to
        send the current revision (either ``expected_revision`` or the plan's
        revision) and are returned with an incremented revision.
        """
        self._assembly_resource_kind(scope)
        with self._save_lock:
            resource = (
                self.get_script(resource_id)
                if scope == "project"
                else self.get_series(resource_id)
            )
            if not resource:
                raise AssemblyPlanValidationError(
                    "Project not found" if scope == "project" else "Series not found"
                )

            current = getattr(resource, "assembly_plan", None)
            if current is None:
                if expected_revision not in (None, 1):
                    raise AssemblyPlanConflictError(
                        "assembly plan does not exist; expected_revision must be 1",
                        current_revision=None,
                    )
                if plan.revision != 1:
                    raise AssemblyPlanConflictError(
                        "new assembly plan must start at revision 1",
                        current_revision=None,
                    )
                saved = plan
            else:
                requested_revision = (
                    expected_revision
                    if expected_revision is not None
                    else plan.revision
                )
                if requested_revision != current.revision:
                    raise AssemblyPlanConflictError(
                        "stale assembly plan revision",
                        current_revision=current.revision,
                    )
                saved = plan.model_copy(
                    update={"revision": current.revision + 1}
                )

            # Check the references after the optimistic-concurrency boundary.
            # A stale client receives 409 even if another editor changed or
            # removed one of its now-old source references.
            self._validate_assembly_plan_references(scope, resource_id, plan)

            resource.assembly_plan = saved
            resource.updated_at = time.time()
            if scope == "project":
                self._save_data()
            else:
                self._save_series_data_unlocked()
            return saved

    def _load_series_data(self) -> Dict[str, Series]:
        if not os.path.exists(self.series_data_file):
            return {}
        try:
            with open(self.series_data_file, 'r') as f:
                data = json.load(f)
                return {k: Series(**v) for k, v in data.items()}
        except Exception as e:
            logger.error(f"Failed to load series data: {e}")
            return {}

    def _save_series_data_unlocked(self):
        """Save series data without acquiring the lock (caller must hold self._save_lock)."""
        try:
            os.makedirs(os.path.dirname(self.series_data_file) or ".", exist_ok=True)
            with open(self.series_data_file, 'w') as f:
                json.dump({k: v.model_dump() for k, v in self.series_store.items()}, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save series data: {e}")

    def _save_series_data(self):
        """Save series data with thread lock."""
        with self._save_lock:
            self._save_series_data_unlocked()

    # ============================================================
    # Global Asset Library Storage (project-independent shared pool)
    # ============================================================

    def _load_library_data(self) -> GlobalAssetLibrary:
        if not os.path.exists(self.library_data_file):
            return GlobalAssetLibrary()
        try:
            with open(self.library_data_file, 'r') as f:
                data = json.load(f)
                return GlobalAssetLibrary(**data)
        except Exception as e:
            logger.error(f"Failed to load library data: {e}")
            return GlobalAssetLibrary()

    def _save_library_data_unlocked(self):
        """Save global library data without acquiring the lock (caller must hold self._save_lock)."""
        try:
            os.makedirs(os.path.dirname(self.library_data_file) or ".", exist_ok=True)
            with open(self.library_data_file, 'w') as f:
                json.dump(self.library_store.model_dump(), f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save library data: {e}")

    def _save_library_data(self):
        """Save global library data with thread lock."""
        with self._save_lock:
            self._save_library_data_unlocked()

    # ------------------------------------------------------------------
    # Global Asset Library — CRUD + feed channels (iFrame Core shared pool)
    # ------------------------------------------------------------------
    # These methods are the single source of truth for mutating the
    # project-independent library. Both the /library/assets endpoints and
    # the Playground "录入资产库" flow call them, so the wiring stays
    # consistent. The library is curated/opt-in (anti-bloat): nothing is
    # auto-ingested here.

    def _library_raw_list_for_type(self, asset_type: str) -> List:
        """Return the live list backing the given asset type in the global
        library (so callers can append/iterate). Raises on unknown type."""
        if asset_type == "character":
            return self.library_store.characters
        elif asset_type == "scene":
            return self.library_store.scenes
        elif asset_type == "prop":
            return self.library_store.props
        raise ValueError(f"Invalid asset type: {asset_type}")

    def _library_list_for_type(
        self,
        asset_type: str,
        owner_profile_id: Optional[str] = None,
    ) -> List:
        raw = self._library_raw_list_for_type(asset_type)
        requested_owner = self._requested_owner_profile_id(owner_profile_id)
        if not requested_owner:
            return raw
        return [asset for asset in raw if owned_by(asset, requested_owner)]

    def _find_library_asset(self, asset_type: str, asset_id: str):
        """Locate a global library asset by (type, id). Raises ValueError
        when the type is invalid or the id is absent."""
        target_list = self._library_list_for_type(asset_type)
        asset = next((a for a in target_list if a.id == asset_id), None)
        if asset is None:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found in library")
        return asset

    def list_library_assets(self) -> GlobalAssetLibrary:
        """Return the global shared asset pool container (characters /
        scenes / props). Mirrors get_series for the library scope."""
        owner_profile_id = self._requested_owner_profile_id()
        if not owner_profile_id:
            return self.library_store
        return GlobalAssetLibrary(
            characters=self._library_list_for_type("character", owner_profile_id),
            scenes=self._library_list_for_type("scene", owner_profile_id),
            props=self._library_list_for_type("prop", owner_profile_id),
        )

    def create_library_asset(self, asset_type: str, payload: Dict[str, Any]):
        """Create a new global library asset of `asset_type`
        ("character" | "scene" | "prop") from a plain payload dict, persist
        it, and return the created asset object.

        Mirrors the series quick-create endpoints
        (create_series_character/scene/prop) but targets the
        project-independent global pool. Tolerates a partial payload (used
        by the Playground录入 flow, which calls this directly rather than
        through a request model). Recognized payload keys: name,
        description, image_url, image_origin, persona (characters), voice_id
        (characters)."""
        from .models import Character, Scene, Prop, AssetUnit, ImageAsset, ImageVariant
        with self._save_lock:
            payload = dict(payload or {})
            owner_user_id = self._requested_owner_user_id()
            owner_profile_id = self._requested_owner_profile_id()
            name = payload.get("name") or "未命名"
            description = payload.get("description") or ""
            image_url = payload.get("image_url")
            image_origin = payload.get("image_origin")
            if image_origin not in (None, "upload", "workbench"):
                raise ValueError("Invalid image origin")
            initial_variant = None
            if image_url:
                initial_variant = ImageVariant(
                    id=f"img_{uuid.uuid4().hex[:12]}",
                    url=image_url,
                    is_uploaded_source=image_origin == "upload",
                    upload_type="image" if image_origin == "upload" else None,
                    source_origin=image_origin,
                    source_generation_id=payload.get("source_generation_id") if image_origin == "workbench" else None,
                    source_output_id=payload.get("source_output_id") if image_origin == "workbench" else None,
                )
            if asset_type == "character":
                ref_sheet = AssetUnit()
                if initial_variant:
                    ref_sheet.image_variants.append(initial_variant)
                    ref_sheet.selected_image_id = initial_variant.id
                asset = Character(
                    id=f"char_{uuid.uuid4().hex[:12]}",
                    owner_user_id=owner_user_id,
                    owner_profile_id=owner_profile_id,
                    name=name,
                    description=description,
                    persona=payload.get("persona") or "",
                    voice_id=payload.get("voice_id"),
                    reference_sheet=ref_sheet,
                )
            elif asset_type == "scene":
                image_asset = ImageAsset()
                if initial_variant:
                    image_asset.variants.append(initial_variant)
                    image_asset.selected_id = initial_variant.id
                asset = Scene(
                    id=f"scene_{uuid.uuid4().hex[:12]}",
                    owner_user_id=owner_user_id,
                    owner_profile_id=owner_profile_id,
                    name=name,
                    description=description,
                    image_url=image_url,
                    image_asset=image_asset,
                )
            elif asset_type == "prop":
                image_asset = ImageAsset()
                if initial_variant:
                    image_asset.variants.append(initial_variant)
                    image_asset.selected_id = initial_variant.id
                asset = Prop(
                    id=f"prop_{uuid.uuid4().hex[:12]}",
                    owner_user_id=owner_user_id,
                    owner_profile_id=owner_profile_id,
                    name=name,
                    description=description,
                    image_url=image_url,
                    image_asset=image_asset,
                )
            else:
                raise ValueError(f"Invalid asset type: {asset_type}")
            self._library_raw_list_for_type(asset_type).append(asset)
            self._save_library_data_unlocked()
            return asset

    def update_library_asset(self, asset_type: str, asset_id: str, patch: Dict[str, Any]):
        """Patch attributes of a global library asset and persist. Mirrors
        update_series_asset_attributes — only sets keys that exist on the
        asset, and never touches id/status (use create/delete to manage
        those)."""
        with self._save_lock:
            asset = self._find_library_asset(asset_type, asset_id)
            for key, value in (patch or {}).items():
                if hasattr(asset, key) and key not in (
                    "id",
                    "status",
                    "owner_user_id",
                    "owner_profile_id",
                ):
                    setattr(asset, key, value)
            self._save_library_data_unlocked()
            return asset

    def _scan_library_asset_references(self, asset_type: str, asset_id: str) -> List[Dict[str, Any]]:
        """Find every storyboard frame (across all projects and series) that
        references the given asset id through the type-appropriate field:
        scene -> frame.scene_id, character -> frame.character_ids,
        prop -> frame.prop_ids. Returns a list of referrer descriptors
        (empty when nothing references it). Used by delete_library_asset for
        design Q2 reference integrity.

        Note: Series currently hold no frames of their own (their frames live
        in episode Scripts, which are in self.scripts), so the series loop is
        a defensive no-op today via getattr — kept so the scan stays correct
        if Series ever gains a frames list."""
        references: List[Dict[str, Any]] = []

        def _frame_hits(frame) -> bool:
            if asset_type == "scene":
                return getattr(frame, "scene_id", None) == asset_id
            if asset_type == "character":
                return asset_id in (getattr(frame, "character_ids", None) or [])
            if asset_type == "prop":
                return asset_id in (getattr(frame, "prop_ids", None) or [])
            return False

        def _scan(owner_kind: str, owner_id: str, owner, frames) -> None:
            for frame in frames or []:
                if _frame_hits(frame):
                    references.append({
                        "owner_kind": owner_kind,
                        "owner_id": owner_id,
                        "owner_title": getattr(owner, "title", None),
                        "frame_id": getattr(frame, "id", None),
                    })

        owner_profile_id = self._requested_owner_profile_id()
        for sid, script in (getattr(self, "scripts", {}) or {}).items():
            if owner_profile_id and not owned_by(script, owner_profile_id):
                continue
            _scan("project", sid, script, getattr(script, "frames", None))
        for sid, series in (getattr(self, "series_store", {}) or {}).items():
            if owner_profile_id and not owned_by(series, owner_profile_id):
                continue
            _scan("series", sid, series, getattr(series, "frames", None))
        return references

    def delete_library_asset(self, asset_type: str, asset_id: str, force: bool = False) -> None:
        """Hard-delete a global library asset.

        Design Q2 (reference integrity): unless ``force`` is True, scan all
        project/series storyboard frames first; if any still reference this
        asset (scene_id / character_ids / prop_ids) the delete is refused via
        ``LibraryAssetInUseError`` (API maps to HTTP 409 and lists referrers).
        With ``force=True`` the asset is removed anyway, leaving those frame
        references dangling (the asset resolver simply drops the unknown id).

        Raises ValueError when the asset (or asset type) is absent — this is
        checked BEFORE the reference scan so a missing id still maps to 404."""
        with self._save_lock:
            visible_assets = self._library_list_for_type(asset_type)
            target_asset = next((a for a in visible_assets if a.id == asset_id), None)
            if target_asset is None:
                raise ValueError(f"Asset {asset_id} of type {asset_type} not found in library")
            if not force:
                refs = self._scan_library_asset_references(asset_type, asset_id)
                if refs:
                    raise LibraryAssetInUseError(asset_type, asset_id, refs)
            target_list = self._library_raw_list_for_type(asset_type)
            kept = [a for a in target_list if a is not target_asset]
            if asset_type == "character":
                self.library_store.characters = kept
            elif asset_type == "scene":
                self.library_store.scenes = kept
            else:  # prop
                self.library_store.props = kept
            self._save_library_data_unlocked()

    def promote_asset_to_library(self, source_kind: str, source_id: str, asset_type: str, asset_id: str):
        """Deep-copy an asset from a Project (episode) or Series into the
        global library with a fresh id, persist, and return the new asset.

        Reuses the import_assets_from_series deepcopy + new-uuid pattern.
        The source asset is left intact (D1 活引用: promotion is additive;
        fork-on-use of the original is a documented follow-up, design Q3).
        `source_kind` ∈ {"project", "series"}."""
        import copy
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset type: {asset_type}")
        with self._save_lock:
            if source_kind == "series":
                container = self.get_series(source_id)
                if not container:
                    raise ValueError("Source series not found")
            elif source_kind == "project":
                container = self.get_script(source_id)
                if not container:
                    raise ValueError("Source project not found")
            else:
                raise ValueError(f"Invalid source kind: {source_kind}")

            if asset_type == "character":
                src_list = container.characters
            elif asset_type == "scene":
                src_list = container.scenes
            else:  # prop
                src_list = container.props
            source_asset = next((a for a in src_list if a.id == asset_id), None)
            if source_asset is None:
                raise ValueError(
                    f"Asset {asset_id} of type {asset_type} not found in {source_kind} {source_id}"
                )

            new_asset = copy.deepcopy(source_asset)
            new_asset.id = str(uuid.uuid4())
            new_asset.owner_user_id = self._requested_owner_user_id()
            new_asset.owner_profile_id = self._requested_owner_profile_id()
            self._library_raw_list_for_type(asset_type).append(new_asset)
            self._save_library_data_unlocked()
            return new_asset

    def fork_library_asset_to_project(self, script_id: str, asset_type: str, library_asset_id: str):
        """Deep-copy a *global library* asset into a project's local asset list
        with a fresh id, persist the project, and return the new (now
        project-owned) asset.

        This is the inverse direction of promote_asset_to_library and the
        "按需 fork" of design Q3: under D1 活引用 semantics a project references
        shared library assets live; forking materializes an independent,
        editable local copy so subsequent edits no longer touch the shared
        original. The source library asset is left intact (additive).

        Raises ValueError when the project, asset type, or library asset is
        absent. ``asset_type`` ∈ {"character", "scene", "prop"}."""
        import copy
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset type: {asset_type}")
        with self._save_lock:
            script = self.get_script(script_id)
            if not script:
                raise ValueError(f"Project not found: {script_id}")
            # _find_library_asset raises ValueError when the id/type is absent.
            source_asset = self._find_library_asset(asset_type, library_asset_id)
            new_asset = copy.deepcopy(source_asset)
            prefix = {"character": "char", "scene": "scene", "prop": "prop"}[asset_type]
            new_asset.id = f"{prefix}_{uuid.uuid4().hex[:12]}"
            if asset_type == "character":
                script.characters.append(new_asset)
            elif asset_type == "scene":
                script.scenes.append(new_asset)
            else:  # prop
                script.props.append(new_asset)
            script.updated_at = time.time()
            self._save_data()
            return new_asset

    def create_series(
        self,
        title: str,
        description: str = "",
        workflow_mode: str = "i2v_legacy",
        content_mode: str = "scripted",
        default_generation_mode: str = "r2v",
        owner_user_id: Optional[str] = None,
        owner_profile_id: Optional[str] = None,
    ) -> Series:
        """Create a new Series."""
        with self._save_lock:
            series = Series(
                id=str(uuid.uuid4()),
                owner_user_id=owner_user_id,
                owner_profile_id=owner_profile_id,
                title=title,
                description=description,
                workflow_mode=workflow_mode,
                content_mode=content_mode,
                default_generation_mode=default_generation_mode,
                created_at=time.time(),
                updated_at=time.time(),
            )
            self.series_store[series.id] = series
            self._save_series_data_unlocked()
            return series

    def update_series(self, series_id: str, updates: Dict[str, Any]) -> Series:
        """Update Series fields (title, description, etc.)."""
        with self._save_lock:
            series = self.get_series(series_id)
            if not series:
                raise ValueError("Series not found")
            for key, value in updates.items():
                if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                    if key == "art_direction" and isinstance(value, dict):
                        value = ArtDirection(**value)
                    setattr(series, key, value)
            series.updated_at = time.time()
            self.series_store[series_id] = series
            self._save_series_data_unlocked()
            return series

    def delete_series(self, series_id: str) -> None:
        """Delete a Series and disassociate its episodes."""
        with self._save_lock:
            series = self.get_series(series_id)
            if not series:
                raise ValueError("Series not found")
            # Disassociate episodes
            for ep_id in series.episode_ids:
                script = self.get_script(ep_id)
                if script:
                    script.series_id = None
                    script.episode_number = None
            self._save_data()
            del self.series_store[series_id]
            self._save_series_data_unlocked()

    def add_episode_to_series(
        self,
        series_id: str,
        script_id: str,
        episode_number: Optional[int] = None,
        owner_profile_id: Optional[str] = None,
    ) -> Series:
        """Add an existing Script/Project as an Episode to a Series."""
        with self._save_lock:
            requested_owner = self._requested_owner_profile_id(owner_profile_id)
            series = self.get_series(series_id, requested_owner)
            if not series:
                raise ValueError("Series not found")
            script = self.get_script(script_id, requested_owner)
            if not script:
                raise ValueError("Script not found")
            # If script already belongs to another series, remove it from the old one
            if script.series_id and script.series_id != series_id:
                old_series = self.get_series(script.series_id, requested_owner)
                if old_series and script_id in old_series.episode_ids:
                    old_series.episode_ids.remove(script_id)
            if script_id not in series.episode_ids:
                series.episode_ids.append(script_id)
            script.series_id = series_id
            script.episode_number = episode_number or len(series.episode_ids)
            series.updated_at = time.time()
            self._save_data()
            self._save_series_data_unlocked()
            return series

    def remove_episode_from_series(self, series_id: str, script_id: str) -> Series:
        """Remove an Episode from a Series (does not delete the project)."""
        with self._save_lock:
            series = self.get_series(series_id)
            if not series:
                raise ValueError("Series not found")
            if script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
            script = self.get_script(script_id)
            if script:
                script.series_id = None
                script.episode_number = None
            series.updated_at = time.time()
            self._save_data()
            self._save_series_data_unlocked()
            return series

    # ─────────────────────────────────────────────────────────────
    # PR-3h/i · Custom voice (clone + design) management
    # Per Q16.1: series-level pool. Episodes / characters in the series
    # share access via VoicePickerModal's 我的复刻 / 我的设计 tabs.
    # ─────────────────────────────────────────────────────────────

    def create_voice_clone(
        self,
        series_id: str,
        audio_url: str,
        label: str,
        target_model: str = "cosyvoice-v3.5-plus",
    ) -> 'CustomVoice':
        """Clone a voice from a reference audio URL via dashscope customization.

        Calls /services/audio/tts/customization with model='voice-enrollment'
        action='create_voice'. Persists the returned voice_id under
        series.custom_voices[]. Returns the CustomVoice entry.

        Per doc: audio must be ≤10MB, MP3/WAV/M4A, ≥16kHz, 10-20s recommended.
        Frontend should pre-validate before calling.
        """
        import requests
        from .models import CustomVoice  # local import to avoid circular

        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError(f"Series not found: {series_id}")

            api_key = os.getenv("DASHSCOPE_API_KEY")
            if not api_key:
                raise RuntimeError("DASHSCOPE_API_KEY not configured")

            # Dashscope customization endpoint (Beijing region; intl uses
            # dashscope-intl URL — TODO when iFrame supports intl deployment)
            url = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
            payload = {
                "model": "voice-enrollment",
                "input": {
                    "action": "create_voice",
                    "target_model": target_model,
                    "prefix": label[:20],  # API has prefix length limit
                    "url": audio_url,
                },
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

            logger.info(f"[voice/clone] creating voice for series={series_id} label='{label}' target={target_model}")
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            if resp.status_code != 200:
                logger.error(f"[voice/clone] dashscope error {resp.status_code}: {resp.text[:500]}")
                raise RuntimeError(f"Voice clone failed: HTTP {resp.status_code} — {resp.text[:200]}")

            data = resp.json()
            # Per doc shape: output.voice (CosyVoice) or output.voice_id (Qwen-TTS)
            voice_id = (
                data.get("output", {}).get("voice")
                or data.get("output", {}).get("voice_id")
                or data.get("voice")
            )
            if not voice_id:
                logger.error(f"[voice/clone] no voice_id in response: {data}")
                raise RuntimeError(f"Voice clone succeeded but voice_id missing in response: {data}")

            custom = CustomVoice(
                id=str(voice_id),
                label=label,
                origin="clone",
                target_model=target_model,
                family="cosyvoice",  # PR-3h hardcodes CosyVoice clone target
                source_audio_url=audio_url,
            )
            if series.custom_voices is None:
                series.custom_voices = []
            series.custom_voices.append(custom)
            series.updated_at = time.time()
            self._save_series_data_unlocked()
            logger.info(f"[voice/clone] success voice_id={voice_id} stored on series={series_id}")
            return custom

    def list_custom_voices(self, series_id: str) -> List['CustomVoice']:
        """Return all custom voices in a series (clones + designs).
        Empty list if series has none or doesn't exist."""
        series = self.get_series(series_id)
        if not series:
            return []
        return list(series.custom_voices or [])

    def delete_custom_voice(self, series_id: str, voice_id: str) -> bool:
        """Remove a custom voice entry. Returns True if removed, False if
        not found. Note: does NOT call dashscope to delete the underlying
        voice (the platform allows re-use for 24h; cleanup is best-effort)."""
        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series or not series.custom_voices:
                return False
            before = len(series.custom_voices)
            series.custom_voices = [v for v in series.custom_voices if v.id != voice_id]
            removed = before != len(series.custom_voices)
            if removed:
                series.updated_at = time.time()
                self._save_series_data_unlocked()
            return removed

    def find_custom_voice(self, voice_id: str) -> Optional['CustomVoice']:
        """Search all series for a custom voice by voice_id. Used by
        /voice/preview to resolve target_model for cloned/designed voices
        (which aren't in the static TTS_VOICE_REGISTRY)."""
        for series in self.series_store.values():
            for cv in (series.custom_voices or []):
                if cv.id == voice_id:
                    return cv
        return None

    # ─────────────────────────────────────────────────────────────
    # PR-3i · Voice design (iterate: prompt → preview → accept)
    # Unlike clone (audio-driven, 1 shot), design is text-driven and
    # users naturally iterate. Each preview mints a new voice on
    # dashscope; we only persist the voice the user explicitly accepts.
    # ─────────────────────────────────────────────────────────────

    def voice_design_preview(
        self,
        voice_prompt: str,
        preview_text: str,
        target_model: str = "cosyvoice-v3.5-plus",
    ) -> Dict[str, Any]:
        """Mint a new design voice via dashscope (preview returned inline).

        Per dashscope contract: create_voice with voice_prompt MUST be paired
        with preview_text in the same call; the API returns both the voice_id
        and a preview audio URL. We download the URL into our cache dir so
        the frontend can play it through the same /files static mount used
        by /voice/preview.

        Does NOT persist; user iterates by re-calling with tweaked params.
        """
        import requests
        import hashlib

        api_key = os.getenv("DASHSCOPE_API_KEY")
        if not api_key:
            raise RuntimeError("DASHSCOPE_API_KEY not configured")

        url = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
        payload = {
            "model": "voice-enrollment",
            "input": {
                "action": "create_voice",
                "target_model": target_model,
                "prefix": "design",
                "voice_prompt": voice_prompt[:500],
                "preview_text": (preview_text or "你好，这是一段音色测试。")[:200],
            },
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        logger.info(f"[voice/design] preview voice_prompt='{voice_prompt[:60]}…' target={target_model}")
        # dashscope voice design has variable latency (10-60s); the customization
        # service occasionally returns its own timeout. Retry once on 5xx/timeout.
        resp = None
        last_err = None
        for attempt in range(2):
            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=120)
                if resp.status_code == 200:
                    break
                last_err = f"HTTP {resp.status_code} — {resp.text[:200]}"
                if resp.status_code < 500 and "Timeout" not in (resp.text or ""):
                    break  # client error, don't retry
                logger.warning(f"[voice/design] attempt {attempt+1} failed: {last_err}; retrying")
            except requests.RequestException as e:
                last_err = str(e)
                logger.warning(f"[voice/design] attempt {attempt+1} network error: {e}; retrying")
        if resp is None or resp.status_code != 200:
            logger.error(f"[voice/design] all attempts failed: {last_err}")
            raise RuntimeError(f"Voice design failed: {last_err}")

        data = resp.json()
        output = data.get("output", {}) or {}
        voice_id = output.get("voice") or output.get("voice_id") or data.get("voice")
        remote_preview = output.get("preview_audio") or output.get("preview_audio_url") or output.get("audio_url")
        if not voice_id:
            logger.error(f"[voice/design] no voice_id in response: {data}")
            raise RuntimeError(f"Voice design API returned no voice_id: {data}")

        voice_id_str = str(voice_id)

        cache_dir = "output/cache/voice_design_preview"
        os.makedirs(cache_dir, exist_ok=True)
        cache_key = hashlib.md5(f"{voice_id_str}|{preview_text}".encode("utf-8")).hexdigest()
        cache_path = os.path.join(cache_dir, f"{cache_key}.mp3")

        if remote_preview:
            # Download the dashscope-served preview into our cache.
            try:
                audio_resp = requests.get(remote_preview, timeout=60)
                audio_resp.raise_for_status()
                with open(cache_path, "wb") as f:
                    f.write(audio_resp.content)
            except Exception as e:
                logger.warning(f"[voice/design] preview download failed, falling back to local TTS: {e}")
                remote_preview = None

        if not remote_preview:
            if not self.audio_generator.tts:
                raise RuntimeError("TTS unavailable; cannot synthesize preview")
            self.audio_generator.tts.synthesize(
                text=preview_text,
                output_path=cache_path,
                voice=voice_id_str,
                model_override=target_model,
                family_override="cosyvoice",
            )

        preview_url = f"cache/voice_design_preview/{cache_key}.mp3"
        return {"voice_id": voice_id_str, "preview_url": preview_url, "target_model": target_model}

    def voice_design_save(
        self,
        series_id: str,
        voice_id: str,
        voice_prompt: str,
        label: str,
        target_model: str = "cosyvoice-v3.5-plus",
    ) -> 'CustomVoice':
        """Persist a previewed design voice into series.custom_voices[]."""
        from .models import CustomVoice

        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError(f"Series not found: {series_id}")

            existing = next(
                (cv for cv in (series.custom_voices or []) if cv.id == voice_id),
                None,
            )
            if existing:
                logger.info(f"[voice/design] save: voice_id={voice_id} already exists; returning existing")
                return existing

            custom = CustomVoice(
                id=voice_id,
                label=label,
                origin="design",
                target_model=target_model,
                family="cosyvoice",
                voice_prompt=voice_prompt[:500],
            )
            if series.custom_voices is None:
                series.custom_voices = []
            series.custom_voices.append(custom)
            series.updated_at = time.time()
            self._save_series_data_unlocked()
            logger.info(f"[voice/design] saved voice_id={voice_id} to series={series_id}")
            return custom

    def translate_character_to_voice_prompt(self, description: str) -> str:
        """LLM helper: convert a character description into a CosyVoice
        voice_prompt suitable for /services/audio/tts/customization.

        The prompt should describe vocal qualities (timbre, pace, age, mood)
        in concise Chinese. CosyVoice voice_prompt cap is 500 chars; we
        target ~120-200 to leave headroom for tone hints.
        """
        from .llm_adapter import LLMAdapter

        adapter = LLMAdapter()
        if not adapter.is_configured:
            raise RuntimeError("LLM adapter not configured (missing DASHSCOPE_API_KEY)")

        system_prompt = (
            "你是一个语音设计师，擅长将角色设定转化为简洁的中文音色描述。"
            "输出要求："
            "1. 只描述音色、语速、年龄、情绪，不要描写外貌或剧情。"
            "2. 用 100-200 字中文，单段无标题，不带引号或多余说明。"
            "3. 重点：性别·年龄·音色质感·语速·气质氛围。"
        )
        user_prompt = f"角色设定：\n{description.strip()[:1000]}\n\n请输出音色描述。"

        text = adapter.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return (text or "").strip()[:500]

    def get_series_episodes(self, series_id: str) -> List[Script]:
        """Get all Episodes belonging to a Series, in order."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")

        episodes = []
        for ep_id in series.episode_ids:
            script = self.get_script(ep_id)
            if script:
                episodes.append(script)
        return episodes

    def resolve_episode_assets(self, episode: Script, series: Optional[Series] = None) -> Dict[str, List]:
        """Merge Episode-local assets with Series shared assets and the
        project-independent global asset library. Priority by ID:
        Episode > Series > Global (local always wins). The global library
        is the lowest layer and applies to every project, with or without
        a parent series. When the global library is empty this behaves
        identically to the previous two-layer (Episode/Series) merge."""
        if not series:
            # Auto-lookup series if episode has series_id
            if episode.series_id:
                series = self.get_series(episode.series_id, episode.owner_profile_id)
        if not series:
            # No parent series — episode-local assets sit on top of the
            # global library (lowest layer). With an empty library this
            # yields the episode's own assets (back-compat).
            ep_char_ids = {c.id for c in episode.characters}
            ep_scene_ids = {s.id for s in episode.scenes}
            ep_prop_ids = {p.id for p in episode.props}
            return {
                "characters": list(episode.characters) + [c for c in self._library_list_for_type("character", episode.owner_profile_id) if c.id not in ep_char_ids],
                "scenes": list(episode.scenes) + [s for s in self._library_list_for_type("scene", episode.owner_profile_id) if s.id not in ep_scene_ids],
                "props": list(episode.props) + [p for p in self._library_list_for_type("prop", episode.owner_profile_id) if p.id not in ep_prop_ids],
            }
        # Build lookup by ID for episode-local assets
        ep_char_ids = {c.id for c in episode.characters}
        ep_scene_ids = {s.id for s in episode.scenes}
        ep_prop_ids = {p.id for p in episode.props}

        merged_characters = list(episode.characters) + [c for c in series.characters if c.id not in ep_char_ids]
        merged_scenes = list(episode.scenes) + [s for s in series.scenes if s.id not in ep_scene_ids]
        merged_props = list(episode.props) + [p for p in series.props if p.id not in ep_prop_ids]

        # Fold the global library underneath as the lowest layer — only
        # ids absent from both the Episode and Series layers. No-op when
        # the library is empty (back-compat).
        merged_char_ids = {c.id for c in merged_characters}
        merged_scene_ids = {s.id for s in merged_scenes}
        merged_prop_ids = {p.id for p in merged_props}

        merged_characters += [c for c in self._library_list_for_type("character", episode.owner_profile_id) if c.id not in merged_char_ids]
        merged_scenes += [s for s in self._library_list_for_type("scene", episode.owner_profile_id) if s.id not in merged_scene_ids]
        merged_props += [p for p in self._library_list_for_type("prop", episode.owner_profile_id) if p.id not in merged_prop_ids]

        return {
            "characters": merged_characters,
            "scenes": merged_scenes,
            "props": merged_props,
        }

    # ============================================================
    # File Import & Episode Splitting
    # ============================================================

    def import_file_and_split(self, text: str, suggested_episodes: int = 3) -> List[Dict]:
        """Split text into episodes using LLM. Returns episode preview data."""
        return self.script_processor.split_into_episodes(text, suggested_episodes)

    def create_series_from_import(
        self,
        title: str,
        text: str,
        episodes_data: List[Dict],
        description: str = "",
        owner_user_id: Optional[str] = None,
        owner_profile_id: Optional[str] = None,
    ) -> Dict:
        """Create a Series with Episodes from import data.
        episodes_data: list of dicts with episode_number, title, start_marker, end_marker."""
        # Create the Series (already acquires lock internally)
        series = self.create_series(
            title,
            description,
            owner_user_id=owner_user_id,
            owner_profile_id=owner_profile_id,
        )

        # Split text into episode chunks based on markers
        episode_texts = self._split_text_by_markers(text, episodes_data)

        with self._save_lock:
            # Create Episode (Script) for each chunk
            created_episodes = []
            for idx, ep_data in enumerate(episodes_data):
                ep_text = episode_texts[idx] if idx < len(episode_texts) else ""
                ep_title = ep_data.get("title", f"第{idx+1}集")
                episode_number = ep_data.get("episode_number", idx + 1)

                # Create draft script (no LLM analysis yet — user can trigger later)
                script = self.script_processor.create_draft_script(ep_title, ep_text)
                script.owner_user_id = owner_user_id
                script.owner_profile_id = owner_profile_id
                self.stamp_owned_children(script)
                script.series_id = series.id
                script.episode_number = episode_number
                self.scripts[script.id] = script

                series.episode_ids.append(script.id)
                created_episodes.append({
                    "id": script.id,
                    "title": ep_title,
                    "episode_number": episode_number,
                    "text_length": len(ep_text),
                })

            self._save_data()
            self._save_series_data_unlocked()

        return {
            "series": series.model_dump(),
            "episodes": created_episodes,
        }

    def _split_text_by_markers(self, text: str, episodes_data: List[Dict]) -> List[str]:
        """Split text into chunks using start/end markers from LLM.
        Searches sequentially to avoid overlapping chunks."""
        chunks = []
        search_from = 0  # Track position to avoid overlap

        for ep in episodes_data:
            start_marker = ep.get("start_marker", "")
            end_marker = ep.get("end_marker", "")

            start_idx = search_from
            end_idx = len(text)

            if start_marker:
                found = text.find(start_marker, search_from)
                if found >= 0:
                    start_idx = found

            if end_marker:
                found = text.find(end_marker, start_idx)
                if found >= 0:
                    end_idx = found + len(end_marker)

            chunks.append(text[start_idx:end_idx])
            search_from = end_idx  # Next episode starts after this one

        # Fallback: if markers produced empty/overlapping chunks, do equal split
        if not chunks or all(len(c.strip()) == 0 for c in chunks):
            chunk_size = max(1, len(text) // len(episodes_data))
            chunks = []
            for i in range(len(episodes_data)):
                start = i * chunk_size
                end = start + chunk_size if i < len(episodes_data) - 1 else len(text)
                chunks.append(text[start:end])

        return chunks

    # ============================================================
    # Series Asset Operations
    # ============================================================

    def _find_series_asset(self, series_id: str, asset_id: str, asset_type: str):
        """Find an asset in a Series. Returns (series, asset) tuple."""
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset type: {asset_type}")
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in series.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in series.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in series.props if p.id == asset_id), None)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found in series")
        return series, target_asset

    def toggle_series_asset_lock(self, series_id: str, asset_id: str, asset_type: str) -> Series:
        """Toggle the locked status of a Series asset."""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            target_asset.locked = not target_asset.locked
            self._save_series_data_unlocked()
            return series

    def toggle_series_asset_starred(self, series_id: str, asset_id: str, asset_type: str) -> Series:
        """Toggle the starred (library shortlist) status of a Series asset."""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            target_asset.starred = not target_asset.starred
            self._save_series_data_unlocked()
            return series

    def update_series_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str) -> Series:
        """Updates the image URL of a Series asset."""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            target_asset.image_url = image_url
            if asset_type == "character":
                target_asset.avatar_url = image_url
            self._save_series_data_unlocked()
            return series

    def update_series_asset_attributes(self, series_id: str, asset_id: str, asset_type: str, attributes: Dict[str, Any]) -> Series:
        """Updates arbitrary attributes of a Series asset."""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            for key, value in attributes.items():
                if hasattr(target_asset, key) and key not in ("id", "status", "locked"):
                    setattr(target_asset, key, value)
            series.updated_at = time.time()
            self._save_series_data_unlocked()
            return series

    def generate_series_asset(self, series_id: str, asset_id: str, asset_type: str,
                              style_preset: str = None, reference_image_url: str = None,
                              style_prompt: str = None, generation_type: str = "all",
                              prompt: str = None, apply_style: bool = True,
                              negative_prompt: str = None, batch_size: int = 1,
                              model_name: str = None, reference: Any = None,
                              references: Any = None,
                              image_generation_mode: str = "text") -> tuple:
        """Generate a Series asset. Creates an async task like project asset generation.
        Returns (series, task_id)."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")

        if references and (reference is not None or reference_image_url):
            raise InvalidAssetReference("multiple structured references cannot be combined with a singular legacy reference")
        self._validate_asset_generation_mode(
            image_generation_mode,
            bool(reference is not None or reference_image_url or references),
        )

        normalized_reference = None
        if reference is not None:
            _resolved_reference, normalized_reference = self._resolve_asset_library_reference(
                series,
                reference,
            )
            # Keep only stable asset/variant IDs in the task snapshot when a
            # structured reference is selected. Legacy URL-only callers still
            # use ``reference_image_url`` below.
            reference_image_url = None

        normalized_references = self._normalize_asset_references(references or [])
        effective_reference_model = model_name or series.model_settings.t2i_model
        reference_limit = self._asset_reference_limit(effective_reference_model)
        if len(normalized_references) > reference_limit:
            raise InvalidAssetReference(
                f"model '{effective_reference_model}' supports at most {reference_limit} referenced images"
            )
        for structured_reference in normalized_references:
            self._resolve_asset_library_reference(series, structured_reference)

        t2i_model = model_name or series.model_settings.t2i_model

        from .assets import ASPECT_RATIO_TO_SIZE
        if asset_type == "character":
            aspect_ratio = series.model_settings.character_aspect_ratio
            default_size = "576*1024"
        elif asset_type == "scene":
            aspect_ratio = series.model_settings.scene_aspect_ratio
            default_size = "1024*576"
        elif asset_type == "prop":
            aspect_ratio = series.model_settings.prop_aspect_ratio
            default_size = "1024*1024"
        else:
            aspect_ratio = "9:16"
            default_size = "576*1024"
        effective_size = ASPECT_RATIO_TO_SIZE.get(aspect_ratio, default_size)

        effective_positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""
        resolved_art_dir = series.art_direction
        if isinstance(resolved_art_dir, dict):
            resolved_art_dir = ArtDirection(**resolved_art_dir)
        if apply_style:
            if resolved_art_dir and resolved_art_dir.style_config:
                effective_positive_prompt = resolved_art_dir.style_config.get('positive_prompt', '')
                global_neg = resolved_art_dir.style_config.get('negative_prompt', '')
                if global_neg:
                    effective_negative_prompt = f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
            elif style_prompt:
                effective_positive_prompt = style_prompt
            elif style_preset:
                effective_positive_prompt = f"{style_preset} style"

        task_id = str(uuid.uuid4())
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            if target_asset.status == GenerationStatus.PROCESSING:
                raise AssetGenerationInProgress("Asset generation is already processing")
            target_asset.status = GenerationStatus.PROCESSING
            target_asset.generation_error = None
            self.asset_generation_tasks[task_id] = {
                "status": "pending",
                "progress": 0,
                "error": None,
                "script_id": series_id,  # reuse field name for task lookup
                "asset_id": asset_id,
                "asset_type": asset_type,
                "created_at": time.time(),
                "owner_user_id": series.owner_user_id,
                "owner_profile_id": series.owner_profile_id,
                "is_series": True,
                "params": {
                    "style_preset": style_preset,
                    "reference_image_url": reference_image_url,
                    "reference": normalized_reference,
                    "references": normalized_references,
                    "image_generation_mode": image_generation_mode,
                    "effective_positive_prompt": effective_positive_prompt,
                    "effective_negative_prompt": effective_negative_prompt,
                    "generation_type": generation_type,
                    "prompt": prompt,
                    "apply_style": apply_style,
                    "batch_size": batch_size,
                    "t2i_model": t2i_model,
                    "effective_size": effective_size,
                }
            }
            self._save_series_data()
        return series, task_id

    def import_assets_from_series(self, target_series_id: str, source_series_id: str, asset_ids: List[str]) -> Tuple[Series, List[str], List[str]]:
        """Deep-copy selected assets from source Series to target Series.
        Returns (target_series, imported_ids, skipped_ids)."""
        with self._save_lock:
            target = self.get_series(target_series_id)
            if not target:
                raise ValueError("Target series not found")
            source = self.get_series(source_series_id)
            if not source:
                raise ValueError("Source series not found")

            # Build lookup of all source assets
            source_assets = {}
            for c in source.characters:
                source_assets[c.id] = ("character", c)
            for s in source.scenes:
                source_assets[s.id] = ("scene", s)
            for p in source.props:
                source_assets[p.id] = ("prop", p)

            imported_ids = []
            skipped_ids = []
            for aid in asset_ids:
                if aid not in source_assets:
                    skipped_ids.append(aid)
                    continue
                asset_type, asset = source_assets[aid]
                # Deep copy with new ID
                import copy
                new_asset = copy.deepcopy(asset)
                new_asset.id = str(uuid.uuid4())
                if asset_type == "character":
                    target.characters.append(new_asset)
                elif asset_type == "scene":
                    target.scenes.append(new_asset)
                elif asset_type == "prop":
                    target.props.append(new_asset)
                imported_ids.append(aid)

            target.updated_at = time.time()
            self._save_series_data_unlocked()
            return target, imported_ids, skipped_ids

    def get_effective_prompt(self, prompt_type: str, episode: Script, series: Optional[Series] = None) -> str:
        """Three-level fallback: Episode -> Series -> system default."""
        valid_prompt_types = ("storyboard_polish", "video_polish", "r2v_polish", "storyboard_extraction")
        if prompt_type not in valid_prompt_types:
            raise ValueError(f"Invalid prompt_type: {prompt_type}. Must be one of {valid_prompt_types}")
        from .llm import DEFAULT_STORYBOARD_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT, DEFAULT_R2V_POLISH_PROMPT, DEFAULT_STORYBOARD_EXTRACTION_PROMPT
        defaults = {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
            "storyboard_extraction": DEFAULT_STORYBOARD_EXTRACTION_PROMPT,
        }
        episode_value = getattr(episode.prompt_config, prompt_type, "")
        if episode_value.strip():
            return episode_value
        if series:
            series_value = getattr(series.prompt_config, prompt_type, "")
            if series_value.strip():
                return series_value
        return defaults.get(prompt_type, "")
