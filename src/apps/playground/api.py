"""Playground API routes — generation, history, and template management."""

import os
import hashlib
import hmac
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from .models import (
    CreateSessionRequest,
    CreateTemplateRequest,
    GenerateRequest,
    PlaygroundTemplate,
    SaveToLibraryRequest,
    UpdateTemplateRequest,
    UpdateSessionRequest,
)
from .service import PlaygroundService
from .storage import PlaygroundStorage
from ..identity import UserContext, _resolve_request_context, require_user_context
from ..user_config import get_user_config_store
from ...utils import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["playground"])

_storage_lock = threading.RLock()
_storages: dict[str, PlaygroundStorage] = {}


def _storage_for(identity: UserContext) -> PlaygroundStorage:
    with _storage_lock:
        storage = _storages.get(identity.owner_profile_id)
        if storage is None:
            storage = PlaygroundStorage(
                owner_user_id=identity.user_id,
                owner_profile_id=identity.owner_profile_id,
            )
            _storages[identity.owner_profile_id] = storage
        return storage


def _service_for(identity: UserContext) -> PlaygroundService:
    storage = _storage_for(identity)
    return PlaygroundService(
        storage,
        provider_config_loader=lambda: get_user_config_store().get_runtime_uniart(identity),
    )


def _media_signature(profile_id: str, generation_id: str, output_id: str, thumbnail: int, expires: int) -> str:
    key = os.getenv("LUMENX_MEDIA_SIGNING_KEY") or os.getenv("LUMENX_CONFIG_MASTER_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="LUMENX_MEDIA_SIGNING_KEY is not configured")
    message = f"{profile_id}:{generation_id}:{output_id}:{thumbnail}:{expires}".encode("utf-8")
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _media_url(identity: UserContext, generation_id: str, output_id: str, thumbnail: int = 0) -> str:
    expires = int(time.time()) + 3600
    signature = _media_signature(identity.owner_profile_id, generation_id, output_id, thumbnail, expires)
    return (
        f"/playground/media/{generation_id}/{output_id}"
        f"?thumbnail={thumbnail}&expires={expires}&signature={signature}"
    )


def _public_generation(generation, identity: UserContext):
    payload = generation.model_dump()
    for output in payload.get("outputs", []):
        output["media_path"] = _media_url(identity, generation.id, output["id"])
        if output.get("thumbnail_path"):
            output["thumbnail_path"] = _media_url(identity, generation.id, output["id"], 1)
    return payload

# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def generate(
    request: GenerateRequest,
    background_tasks: BackgroundTasks,
    identity: UserContext = Depends(require_user_context),
):
    """Create a generation record and kick off processing in the background."""
    service = _service_for(identity)
    gen = service.create_generation(request)
    background_tasks.add_task(service.process_generation, gen.id)
    return _public_generation(gen, identity)


router.add_api_route("/generate", generate, methods=["POST"])

# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


def list_history(
    limit: int = 50,
    offset: int = 0,
    session_id: Optional[str] = None,
    identity: UserContext = Depends(require_user_context),
):
    """Return paginated generation history, newest first."""
    return [
        _public_generation(item, identity)
        for item in _storage_for(identity).list_history(limit=limit, offset=offset, session_id=session_id)
    ]


def get_generation(generation_id: str, identity: UserContext = Depends(require_user_context)):
    """Return full details for a single generation."""
    gen = _storage_for(identity).get_generation(generation_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return _public_generation(gen, identity)


def get_generation_status(generation_id: str, identity: UserContext = Depends(require_user_context)):
    """Return lightweight status payload for polling."""
    gen = _storage_for(identity).get_generation(generation_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {
        "id": gen.id,
        "status": gen.status,
        "outputs": _public_generation(gen, identity)["outputs"],
        "error": gen.error,
    }


def delete_generation(generation_id: str, identity: UserContext = Depends(require_user_context)):
    """Delete a generation record and its outputs."""
    if not _storage_for(identity).delete_generation(generation_id):
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"ok": True}


def save_to_library(
    generation_id: str,
    output_id: str,
    request: Optional[SaveToLibraryRequest] = None,
    identity: UserContext = Depends(require_user_context),
):
    """Save a specific generation output to the project library."""
    category = request.category if request else "general"
    if not _service_for(identity).save_to_library(generation_id, output_id, category):
        raise HTTPException(status_code=404, detail="Generation or output not found")
    return {"ok": True}


router.add_api_route("/history", list_history, methods=["GET"])
router.add_api_route("/history/{generation_id}", get_generation, methods=["GET"])
router.add_api_route(
    "/history/{generation_id}/status", get_generation_status, methods=["GET"]
)


def get_generation_media(
    generation_id: str,
    output_id: str,
    thumbnail: int = 0,
    expires: int = 0,
    signature: str = "",
    authorization: str | None = Header(default=None),
):
    if authorization:
        identity, _ = _resolve_request_context(authorization, None)
    else:
        if expires < int(time.time()):
            raise HTTPException(status_code=401, detail="Media URL expired")
        identity = None
        for candidate in list(_storages.values()):
            expected = _media_signature(candidate.owner_profile_id, generation_id, output_id, thumbnail, expires)
            if hmac.compare_digest(expected, signature):
                identity = UserContext(
                    user_id=candidate.owner_user_id,
                    owner_profile_id=candidate.owner_profile_id,
                    display_name="",
                    access_token="",
                )
                break
        if identity is None:
            raise HTTPException(status_code=401, detail="Invalid media signature")
    generation = _storage_for(identity).get_generation(generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Media not found")
    output = next((item for item in generation.outputs if item.id == output_id), None)
    if not output:
        raise HTTPException(status_code=404, detail="Media not found")
    path = output.thumbnail_path if thumbnail and output.thumbnail_path else output.media_path
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path)


router.add_api_route(
    "/media/{generation_id}/{output_id}",
    get_generation_media,
    methods=["GET"],
)

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def list_sessions(identity: UserContext = Depends(require_user_context)):
    return _storage_for(identity).list_sessions()


def create_session(
    request: Optional[CreateSessionRequest] = None,
    identity: UserContext = Depends(require_user_context),
):
    return _storage_for(identity).create_session(request.title if request and request.title else "新建创作")


def get_session(session_id: str, identity: UserContext = Depends(require_user_context)):
    storage = _storage_for(identity)
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def update_session(
    session_id: str,
    request: UpdateSessionRequest,
    identity: UserContext = Depends(require_user_context),
):
    storage = _storage_for(identity)
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if request.title is not None:
        session.title = request.title.strip() or session.title
    if request.draft is not None:
        session.draft = request.draft
    session.updated_at = datetime.now(timezone.utc).isoformat()
    return storage.update_session(session)


router.add_api_route("/sessions", list_sessions, methods=["GET"])
router.add_api_route("/sessions", create_session, methods=["POST"])
router.add_api_route("/sessions/{session_id}", get_session, methods=["GET"])
router.add_api_route("/sessions/{session_id}", update_session, methods=["PATCH"])
router.add_api_route(
    "/history/{generation_id}", delete_generation, methods=["DELETE"]
)
router.add_api_route(
    "/history/{generation_id}/outputs/{output_id}/save-to-library",
    save_to_library,
    methods=["POST"],
)

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def list_templates(identity: UserContext = Depends(require_user_context)):
    """Return all saved prompt templates."""
    return _storage_for(identity).list_templates()


def create_template(
    request: CreateTemplateRequest,
    identity: UserContext = Depends(require_user_context),
):
    """Create a new prompt template."""
    now = datetime.now(timezone.utc).isoformat()
    template = PlaygroundTemplate(
        id=str(uuid.uuid4()),
        name=request.name,
        category=request.category or "general",
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        default_mode=request.default_mode,
        default_model_id=request.default_model_id,
        default_parameters=request.default_parameters or {},
        created_at=now,
        updated_at=now,
        owner_user_id=identity.user_id,
        owner_profile_id=identity.owner_profile_id,
    )
    _storage_for(identity).add_template(template)
    return template


def update_template(
    template_id: str,
    request: UpdateTemplateRequest,
    identity: UserContext = Depends(require_user_context),
):
    """Update an existing prompt template (partial update)."""
    storage = _storage_for(identity)
    template = storage.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    update_data = request.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(template, key, value)
    template.updated_at = datetime.now(timezone.utc).isoformat()
    storage.update_template(template)
    return template


def delete_template(template_id: str, identity: UserContext = Depends(require_user_context)):
    """Delete a prompt template."""
    if not _storage_for(identity).delete_template(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


router.add_api_route("/templates", list_templates, methods=["GET"])
router.add_api_route("/templates", create_template, methods=["POST"])
router.add_api_route("/templates/{template_id}", update_template, methods=["PUT"])
router.add_api_route("/templates/{template_id}", delete_template, methods=["DELETE"])

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

async def upload_media(
    file: UploadFile = File(...),
    identity: UserContext = Depends(require_user_context),
):
    """Upload a media file for use as playground input (reference image, first frame, etc.)."""
    upload_dir = os.path.join(_storage_for(identity).output_dir, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "file")[1] or ".bin"
    filename = f"{uuid.uuid4()}{ext}"
    dest = os.path.join(upload_dir, filename)
    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)
    # Return an owner-scoped browser reference, never the server filesystem
    # path. The corresponding endpoint verifies the current owner before
    # serving the file.
    return {"path": f"/playground/input-media/{filename}"}


def get_input_media(
    filename: str,
    identity: UserContext = Depends(require_user_context),
):
    if not filename or os.path.basename(filename) != filename:
        raise HTTPException(status_code=404, detail="Media not found")
    path = os.path.join(_storage_for(identity).output_dir, "uploads", filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path)


router.add_api_route("/upload", upload_media, methods=["POST"])
router.add_api_route("/input-media/{filename}", get_input_media, methods=["GET"])
