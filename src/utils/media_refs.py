import os
from pathlib import Path
from typing import Optional

from .managed_media_root import ManagedMediaRoot


LOCAL_MEDIA_PREFIXES = (
    "assets/",
    "storyboard/",
    "video/",
    "audio/",
    "export/",
    "uploads/",
    "output/",
    "outputs/",
)

MEDIA_REF_LOCAL_PATH = "local_path"
MEDIA_REF_OBJECT_KEY = "object_key"
MEDIA_REF_REMOTE_URL = "remote_url"
MEDIA_REF_BLOB_URL = "blob_url"
MEDIA_REF_DATA_URI = "data_uri"
MEDIA_REF_UNKNOWN = "unknown"


def _project_root(project_root: Optional[str] = None) -> Path:
    if project_root:
        return Path(project_root).resolve()
    # src/utils/media_refs.py -> repo root
    return Path(__file__).resolve().parents[2]


def _output_root(project_root: Optional[str] = None) -> Path:
    return _project_root(project_root) / "output"


def _normalized_oss_base_path(oss_base_path: Optional[str] = None) -> str:
    value = oss_base_path if oss_base_path is not None else os.getenv("OSS_BASE_PATH", "lumenx")
    return str(value).strip().strip("'\"/ ")


def classify_media_ref(
    value: str,
    *,
    oss_base_path: Optional[str] = None,
    project_root: Optional[str] = None,
    output_root: Optional[str] = None,
) -> str:
    """Classify media reference string used in project state."""
    if not isinstance(value, str):
        return MEDIA_REF_UNKNOWN

    raw = value.strip()
    if not raw:
        return MEDIA_REF_UNKNOWN

    if raw.startswith("data:"):
        return MEDIA_REF_DATA_URI

    if raw.startswith("blob:"):
        return MEDIA_REF_BLOB_URL

    if raw.startswith(("http://", "https://")):
        return MEDIA_REF_REMOTE_URL

    store = ManagedMediaRoot(output_root if output_root is not None else _output_root(project_root))
    relative = raw.lstrip("/")
    if os.path.isabs(raw) or relative.startswith(LOCAL_MEDIA_PREFIXES):
        try:
            store.resolve(raw)
        except (ValueError, OSError, RuntimeError):
            return MEDIA_REF_UNKNOWN
        return MEDIA_REF_LOCAL_PATH

    base_path = _normalized_oss_base_path(oss_base_path)
    if base_path and relative.startswith(f"{base_path}/"):
        return MEDIA_REF_OBJECT_KEY

    return MEDIA_REF_UNKNOWN


def resolve_local_media_path(
    value: str, *, project_root: Optional[str] = None, output_root: Optional[str] = None,
) -> Optional[str]:
    """Resolve recognized local references under the explicit or default media root."""
    if classify_media_ref(value, project_root=project_root, output_root=output_root) != MEDIA_REF_LOCAL_PATH:
        return None
    store = ManagedMediaRoot(output_root if output_root is not None else _output_root(project_root))
    try:
        return str(store.resolve(value))
    except (ValueError, OSError, RuntimeError):
        return None


def is_remote_media_ref(value: str) -> bool:
    return classify_media_ref(value) in {MEDIA_REF_REMOTE_URL, MEDIA_REF_BLOB_URL}


def is_stable_project_media_ref(value: str) -> bool:
    return classify_media_ref(value) in {
        MEDIA_REF_LOCAL_PATH,
        MEDIA_REF_OBJECT_KEY,
        MEDIA_REF_REMOTE_URL,
    }
