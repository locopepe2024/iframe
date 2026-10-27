from src.apps import director_skills
# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT — handler async/sync convention (audited 2026-05-21):
#
# DEFAULT every new endpoint to `def`, NOT `async def`.
#
# FastAPI's contract:
#   - `async def` handlers run on the asyncio event loop. If the body does any
#     blocking I/O (sync HTTP call, json.dump, requests.post, openai sync
#     client, ffmpeg via subprocess.run, etc.) it FREEZES every other request
#     until the blocking call returns — including unrelated GETs the modal
#     uses to load config. Symptom: "modal stuck on 加载配置中...".
#   - `def` handlers get auto-dispatched to anyio's threadpool, so blocking
#     I/O doesn't touch the event loop. Concurrent requests stay responsive.
#
# Use `async def` ONLY when the body has `await` (streaming uploads, real
# asyncio primitives, awaiting `call_next` in middleware, asyncio.to_thread).
#
# The 7 legitimate async endpoints (verified to use await): middleware
# add_cache_control_header, create_project, reparse_project,
# import_file_preview, import_file_confirm, upload_t2i_frame,
# analyze_script_for_styles. All others are `def` for a reason.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Request, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from typing import Optional, Dict, List, Any, Tuple, Literal, Union
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import concurrent.futures
import hashlib
import hmac
import json
import os
import shutil
import uuid
import logging
import re
import traceback
from urllib.parse import unquote, urlparse
from urllib.request import Request as UrlRequest, urlopen
from .pipeline import (
    ComicGenPipeline,
    AssetGenerationInProgress,
    AssetReviewChanged,
    LibraryAssetInUseError,
    InvalidAssetReference,
    InvalidAssetName,
    AssemblyPlanValidationError,
    AssemblyPlanConflictError,
    StaleStoryboardDraftError,
    DIRECTOR_PLAN_STABLE_LINEAGE_KEYS,
    _director_style_hash,
)
from .structured_evidence import (
    query_asset_mentions,
    query_director_facts,
    query_script_fact_ledger,
    source_version,
)
from .models import (
    ArtDirection,
    ArtifactLineage,
    DirectorProfile,
    DirectorProfileRevision,
    DirectorShootingPlan,
    DirectorShootingPlanRevision,
    ScriptSourceRevision,
    ScriptFactLedgerEntry,
    ScriptFactLedgerRevisionSummary,
    PromptConfig,
    ProviderBackend,
    ProviderRoutingConfig,
    Script,
    Series,
    StoryboardFrame,
    ExtraRosterEntry,
    ExtraShotInstance,
    StoryboardReferencePackage,
    ShotVisualPreset,
    VideoTask,
    VideoReferenceIdentity,
    AssemblyEditPlan,
    AssetLibraryReference,
    image_variant_storage_key,
    normalize_director_profile_draft,
)
from .llm import ScriptProcessor, DEFAULT_STORYBOARD_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT, DEFAULT_R2V_POLISH_PROMPT, DEFAULT_ENTITY_EXTRACTION_PROMPT, DEFAULT_STYLE_ANALYSIS_PROMPT, DEFAULT_STORYBOARD_EXTRACTION_PROMPT, director_preset_identity
from ...utils.oss_utils import OSSImageUploader, is_object_key, managed_object_key_from_url, sign_oss_urls_in_data
from ...utils.uniart_catalog import fetch_uniart_catalog, normalize_uniart_catalog
from ...utils import setup_logging, get_user_data_dir
from ...utils.storage_config import media_root, storage_backend
from ..platform_reference_catalog import (
    CHARACTER_CATEGORIES,
    CHARACTER_TAG_SUGGESTIONS,
    MANIFEST_PATH as PLATFORM_REFERENCE_MANIFEST,
    list_resources as list_platform_reference_resources,
    list_review_candidates as list_platform_reference_review_candidates,
    list_publisher_grants,
    publisher_is_authorized,
    promote_resource as promote_platform_reference_resource,
    reviewer_is_authorized,
    set_publisher_grant,
    submit_generation_candidate,
)
from ..workbench_templates import list_workbench_templates
from fastapi.responses import FileResponse, JSONResponse, Response
from pathlib import Path
from dotenv import load_dotenv, set_key

app = FastAPI(title="iFrame Studio API", version="0.1.5")
logger = logging.getLogger(__name__)


def _director_plan_lineage_changed(plan: DirectorShootingPlan, lineage: Optional[Dict[str, Any]]) -> bool:
    """Return whether stable story/Director inputs changed since plan creation.

    `effective_style_hash` is intentionally excluded: style is downstream
    visual context and changing it must not invalidate an existing plan.
    """
    return lineage is None or any(
        getattr(plan, key) != lineage.get(key)
        for key in DIRECTOR_PLAN_STABLE_LINEAGE_KEYS
    )

# Setup logging to user directory
setup_logging()

# Use absolute path for .env file (api.py is in src/apps/comic_gen/)
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
env_path = os.path.join(_project_root, ".env")
if os.path.exists(env_path):
    load_dotenv(env_path, override=True)

# Mount playground router AFTER .env is loaded (adapters read API keys from env)
from ..identity import (
    API_KEY_IDENTITY_HEADER,
    BROWSER_PROFILE_COOKIE,
    UserContext,
    _resolve_request_context,
    _set_browser_profile_cookie,
    router as identity_router,
    require_user_context,
)
from ..studio_access import (
    current_studio_user,
    require_studio_user,
    resolve_studio_reference,
    reset_studio_user,
    sign_studio_media_paths,
    set_studio_user,
    studio_owner_dir,
    studio_media_dir,
    studio_owner_key,
    studio_uniart_config,
    verify_studio_media,
    verify_studio_media_preview,
    verify_provider_media,
    verify_studio_resource_path,
)
from ..user_config import router as user_config_router
from ..playground.api import _storage_for as playground_storage_for, router as playground_router
from ...utils.media_thumbnails import create_media_thumbnail
from ...utils.asset_previews import create_asset_preview
from ...utils.cos_previews import create_cos_media_preview
from ...utils.cos_storage import is_cos_configured
from ..agent_api import router as agent_router
from ..knowledge.api import router as knowledge_router
from ..recreation.api import router as recreation_router
from ..director_depth import router as director_depth_router
from ..director_design import router as director_design_router
app.include_router(identity_router)
app.include_router(user_config_router)
app.include_router(playground_router, prefix="/playground")
app.include_router(agent_router)
app.include_router(knowledge_router)
app.include_router(recreation_router)
app.include_router(director_depth_router)
app.include_router(director_design_router)


@app.get("/platform-reference-library")
def get_platform_reference_library(
    kind: Optional[str] = None,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    query: str = "",
    semantic_domain: Optional[str] = None,
    entry_type: Optional[str] = None,
    user: UserContext = Depends(require_user_context),
):
    """Read active deployment-scoped resources; mutations are not exposed here."""
    try:
        return private_no_store_signed_response(list_platform_reference_resources(
            kind=kind, category=category, tag=tag, query=query,
            semantic_domain=semantic_domain, entry_type=entry_type,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/platform-reference-library/categories")
def get_platform_reference_categories(user: UserContext = Depends(require_user_context)):
    return {
        "categories": [{"id": key, "label": value} for key, value in CHARACTER_CATEGORIES.items()],
        "suggested_tags": list(CHARACTER_TAG_SUGGESTIONS),
    }


@app.get("/platform-reference-library/publisher")
def get_platform_publisher(user: UserContext = Depends(require_user_context)):
    return {"profile_id": user.owner_profile_id, "authorized": publisher_is_authorized(user.owner_profile_id)}


class PlatformPublisherGrantRequest(BaseModel):
    profile_id: str
    enabled: bool


@app.get("/platform-reference-library/publisher-grants")
def get_platform_publisher_grants(user: UserContext = Depends(require_user_context)):
    if not reviewer_is_authorized(user.owner_profile_id):
        raise HTTPException(status_code=403, detail="平台发布者授权权限不足")
    return {"profile_ids": list_publisher_grants()}


@app.post("/platform-reference-library/publisher-grants")
def update_platform_publisher_grant(request: PlatformPublisherGrantRequest, user: UserContext = Depends(require_user_context)):
    if not reviewer_is_authorized(user.owner_profile_id):
        raise HTTPException(status_code=403, detail="平台发布者授权权限不足")
    try:
        return {"profile_ids": set_publisher_grant(request.profile_id, request.enabled)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


class PlatformCandidateRequest(BaseModel):
    source_generation_id: str
    source_output_id: Optional[str] = None
    kind: Literal["image", "video", "prompt_preset"]
    category_path: str
    tags: list[str] = Field(default_factory=list, max_length=12)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=20000)
    rights_confirmed: bool
    dictionary_entry_type: Optional[Literal["term", "pattern", "case"]] = None
    dictionary_members: Optional[list[dict[str, Any]]] = None


@app.post("/platform-reference-library/candidates")
def submit_platform_candidate(request: PlatformCandidateRequest, user: UserContext = Depends(require_user_context)):
    if not publisher_is_authorized(user.owner_profile_id):
        raise HTTPException(status_code=403, detail="平台候选提交权限不足")
    storage = playground_storage_for(user)
    generation = storage.get_generation(request.source_generation_id)
    if generation is None or generation.status != "completed" or generation.owner_profile_id != user.owner_profile_id:
        raise HTTPException(status_code=404, detail="创作台已完成结果不存在")
    output = next((item for item in generation.outputs if item.id == request.source_output_id), None) if request.source_output_id else None
    if request.kind != "prompt_preset" and (output is None or output.media_type != request.kind):
        raise HTTPException(status_code=422, detail="所选图像或视频结果与提交类型不符")
    if request.kind == "prompt_preset" and request.source_output_id:
        raise HTTPException(status_code=422, detail="提示词候选不附加媒体")
    try:
        resource = submit_generation_candidate(
            creator_profile_id=user.owner_profile_id,
            generation_id=generation.id, output_id=output.id if output else None,
            kind=request.kind, category_path=request.category_path, tags=request.tags,
            title=request.title, description=request.description,
            prompt_used=generation.prompt, negative_prompt=generation.negative_prompt, model_id=generation.model_id,
            parameters=generation.parameters,
            media_source=Path(output.media_path) if output else None,
            media_owner_root=Path(storage.output_dir),
            rights_confirmed=request.rights_confirmed,
            dictionary_entry_type=request.dictionary_entry_type,
            dictionary_members=request.dictionary_members,
        )
        return private_no_store_signed_response(resource)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/platform-reference-library/{resource_id}/media")
def get_platform_reference_media(resource_id: str, preview: bool = False, user: UserContext = Depends(require_user_context)):
    from ..platform_reference_catalog import _read_manifest
    resource = next((item for item in _read_manifest().get("resources", []) if item["platform_resource_id"] == resource_id), None)
    if resource is None or (resource.get("status") != "active" and not (
        reviewer_is_authorized(user.owner_profile_id) or resource.get("provenance", {}).get("creator_profile_id") == user.owner_profile_id
    )):
        raise HTTPException(status_code=404, detail="平台媒体不存在")
    filename = resource.get("payload", {}).get("media_file")
    if not isinstance(filename, str) or Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="平台媒体不存在")
    media_dir = PLATFORM_REFERENCE_MANIFEST.parent / "media"
    source = (media_dir / filename).resolve()
    if not source.is_relative_to(media_dir.resolve()) or not source.is_file():
        raise HTTPException(status_code=404, detail="平台媒体不存在")
    if preview:
        try:
            source = Path(create_media_thumbnail(str(source), str(media_dir), 320))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    media_type = "image/webp" if preview else ("video/mp4" if source.suffix == ".mp4" else "image/jpeg" if source.suffix in {".jpg", ".jpeg"} else "image/png" if source.suffix == ".png" else "image/webp" if source.suffix == ".webp" else "video/quicktime" if source.suffix == ".mov" else "video/webm")
    return FileResponse(source, media_type=media_type, headers={"Cache-Control": "private, no-store"})


@app.get("/workbench-templates")
def get_workbench_templates(
    station: Optional[str] = None,
    kind: Optional[str] = None,
    query: str = "",
    user: UserContext = Depends(require_user_context),
):
    """Search text-only task templates; this endpoint never binds media or prompts."""
    try:
        return list_workbench_templates(station=station, kind=kind, query=query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class PlatformReferencePromotionRequest(BaseModel):
    expected_hash: Optional[str] = None


@app.get("/platform-reference-library/reviewer")
def get_platform_reference_reviewer(user: UserContext = Depends(require_user_context)):
    """Return only whether this API-key identity may review platform candidates."""
    return {"authorized": reviewer_is_authorized(user.owner_profile_id)}


@app.get("/platform-reference-library/review-queue")
def get_platform_reference_review_queue(
    kind: Optional[str] = None,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    query: str = "",
    user: UserContext = Depends(require_user_context),
):
    """Return candidate/review resources only to the deployment reviewer."""
    if not reviewer_is_authorized(user.owner_profile_id):
        raise HTTPException(status_code=403, detail="平台参考资源审核权限不足")
    try:
        return private_no_store_signed_response(
            list_platform_reference_review_candidates(kind=kind, category=category, tag=tag, query=query)
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/platform-reference-library/{resource_id}/promote")
def promote_platform_reference(
    resource_id: str,
    request: PlatformReferencePromotionRequest,
    user: UserContext = Depends(require_user_context),
):
    if not reviewer_is_authorized(user.owner_profile_id):
        raise HTTPException(status_code=403, detail="平台参考资源审核权限不足")
    try:
        return private_no_store_signed_response(promote_platform_reference_resource(
            resource_id,
            user.owner_profile_id,
            request.expected_hash,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

# Debug: Print OSS configuration at startup
logger.info(f"STARTUP: OSS_ENDPOINT={os.getenv('OSS_ENDPOINT')}, OSS_BUCKET_NAME={os.getenv('OSS_BUCKET_NAME')}, OSS_BASE_PATH={os.getenv('OSS_BASE_PATH')}")



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # Allow browsers to access Content-Disposition for downloads
)

# Middleware to add cache headers to static files
@app.middleware("http")
async def add_cache_control_header(request: Request, call_next):
    protected_media_prefixes = (
        "/files/users/",
        "/files/assets/",
        "/files/audio/",
        "/files/cache/",
        "/files/export/",
        "/files/outputs/",
        "/files/playground/",
        "/files/storyboard/",
        "/files/uploads/",
        "/files/video/",
        "/files/videos/",
        "/files/video_inputs/",
    )
    normalized_path = re.sub(r"/+", "/", request.url.path)
    if normalized_path.startswith(protected_media_prefixes):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    response = await call_next(request)
    if request.url.path.startswith("/files/"):
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response

# Create output directory if it doesn't exist
MEDIA_ROOT = media_root()
os.makedirs(MEDIA_ROOT, exist_ok=True)
os.makedirs(os.path.join(MEDIA_ROOT, "uploads"), exist_ok=True)
os.makedirs(os.path.join(MEDIA_ROOT, "video"), exist_ok=True)
os.makedirs(os.path.join(MEDIA_ROOT, "assets"), exist_ok=True)

# Mount static files with multiple aliases to handle plural/singular inconsistencies
# Legacy paths in projects.json often use 'outputs/videos' or 'outputs/assets'
app.mount("/files/outputs/videos", StaticFiles(directory=os.path.join(MEDIA_ROOT, "video")), name="files_outputs_videos")
app.mount("/files/outputs/assets", StaticFiles(directory=os.path.join(MEDIA_ROOT, "assets")), name="files_outputs_assets")
app.mount("/files/outputs", StaticFiles(directory=MEDIA_ROOT), name="files_outputs")
app.mount("/files/videos", StaticFiles(directory=os.path.join(MEDIA_ROOT, "video")), name="files_videos")
app.mount("/files/assets", StaticFiles(directory=os.path.join(MEDIA_ROOT, "assets")), name="files_assets")
app.mount("/files", StaticFiles(directory=MEDIA_ROOT), name="files")

# Ensure playground output directories exist
os.makedirs(os.path.join(MEDIA_ROOT, "playground", "images"), exist_ok=True)
os.makedirs(os.path.join(MEDIA_ROOT, "playground", "videos"), exist_ok=True)
app.mount("/files/playground", StaticFiles(directory=os.path.join(MEDIA_ROOT, "playground")), name="files_playground")


# Initialize pipeline
pipeline = ComicGenPipeline(output_root=MEDIA_ROOT)


@app.middleware("http")
async def enforce_studio_owner_boundary(request: Request, call_next):
    """Authenticate Studio routes and reject cross-profile resource IDs."""
    path = request.url.path
    protected = (
        path == "/projects"
        or path.startswith("/projects/")
        or path == "/series"
        or path.startswith("/series/")
        or path.startswith("/recreation/")
        or path == "/library"
        or path.startswith("/library/")
        or path == "/asset-index"
        or path.startswith("/asset-index/")
        or path == "/upload"
        or path == "/config/models"
        or path == "/config/uniart/models"
        # Voice catalog and preview need the same owner-scoped UniArt
        # credentials as project audio generation.  Without this context,
        # /voices fails even for an authenticated browser session.
        or path == "/voices"
        or path.startswith("/voice/")
        or path == "/studio/media-delivery"
        or path.startswith("/studio/media-records/")
        or path.startswith("/studio/owned-media/")
        or path.startswith("/studio/owned-playground-media/")
        or path.startswith("/tasks/")
        # Prompt polishing resolves the model credentials and optional
        # episode/series prompt context from the current Studio owner.  Keep
        # these body-based endpoints inside the same request context even
        # though the project id is not part of the URL.
        or path in {"/video/polish_prompt", "/video/polish_r2v_prompt",
                    "/video/polish_prompt/preview", "/video/polish_r2v_prompt/preview"}
    )
    if not protected or request.method == "OPTIONS":
        return await call_next(request)

    identity_started = time.perf_counter()
    try:
        user, should_set_cookie = await asyncio.to_thread(
            _resolve_request_context,
            request.headers.get("Authorization"),
            request.cookies.get(BROWSER_PROFILE_COOKIE),
            request.headers.get(API_KEY_IDENTITY_HEADER),
        )
        request.state.lumenx_identity = user
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    try:
        verify_studio_resource_path(
            path,
            user.owner_profile_id,
            pipeline.scripts,
            pipeline.series_store,
        )
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    context_token = set_studio_user(user)
    try:
        handler_started = time.perf_counter()
        response = await call_next(request)
        if path.startswith("/projects/") and path.endswith("/assets/update_attributes"):
            identity_ms = (handler_started - identity_started) * 1000
            handler_ms = (time.perf_counter() - handler_started) * 1000
            timing = response.headers.get("Server-Timing")
            response.headers["Server-Timing"] = ", ".join(filter(None, [
                timing, f"identity;dur={identity_ms:.1f}", f"handler;dur={handler_ms:.1f}",
            ]))
            logger.info("Asset save request status=%d identity_ms=%.1f handler_ms=%.1f",
                        response.status_code, identity_ms, handler_ms)
        if should_set_cookie:
            _set_browser_profile_cookie(response, request, user)
        return response
    finally:
        reset_studio_user(context_token)

# Allow-list map for uploaded file extensions: keys come from the (untrusted)
# client filename, values are trusted literals safe to embed in server paths.
_UPLOAD_EXT_MAP = {
    ".png": ".png", ".jpg": ".jpg", ".jpeg": ".jpeg", ".webp": ".webp",
    ".gif": ".gif", ".bmp": ".bmp", ".svg": ".svg", ".ico": ".ico",
    ".mp4": ".mp4", ".mov": ".mov", ".webm": ".webm", ".avi": ".avi",
    ".mkv": ".mkv", ".mp3": ".mp3", ".wav": ".wav", ".m4a": ".m4a",
    ".aac": ".aac", ".ogg": ".ogg", ".flac": ".flac",
    ".txt": ".txt", ".md": ".md", ".pdf": ".pdf", ".json": ".json",
}


def _safe_upload_ext(filename: Optional[str]) -> str:
    """Return a trusted file extension literal for an uploaded filename.

    Unknown/missing extensions fall back to empty string so the stored file
    is still saved under its random UUID name.
    """
    ext = os.path.splitext(filename or "")[1].lower()
    return _UPLOAD_EXT_MAP.get(ext, "")


@app.get("/debug/config")
def debug_config():
    """Diagnostic endpoint to check OSS and path configuration."""
    uploader = OSSImageUploader()
    return {
        "oss_configured": uploader.is_configured,
        "oss_bucket_initialized": uploader.bucket is not None,
        "oss_base_path": os.getenv("OSS_BASE_PATH", "lumenx"),
        "storage_backend": storage_backend(),
        "media_root": MEDIA_ROOT,
        "output_dir_exists": os.path.exists(MEDIA_ROOT),
        "output_contents": os.listdir(MEDIA_ROOT) if os.path.exists(MEDIA_ROOT) else [],
        "cwd": os.getcwd(),
        "env_vars_present": {
            "OSS_ENDPOINT": bool(os.getenv("OSS_ENDPOINT")),
            "OSS_BUCKET_NAME": bool(os.getenv("OSS_BUCKET_NAME")),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": bool(os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")),
        }
    }

def signed_response(data):
    """Helper to sign OSS URLs in data before returning to frontend.
    
    Handles Pydantic models, lists of models, and dicts.
    Returns a JSONResponse with signed URLs.
    """
    if data is None:
        return JSONResponse(content=None)
    
    # Keep immutable history snapshots behind their dedicated revision APIs;
    # embedding them in every project response multiplies long-script payloads.
    if isinstance(data, Script):
        pipeline.migrate_legacy_storyboard_media(data)
        processed_data = _script_response_dump(data)
    elif isinstance(data, Series):
        processed_data = _series_response_dump(data)
    elif hasattr(data, "model_dump"):
        processed_data = data.model_dump()
    elif isinstance(data, list):
        processed_data = [
            _script_response_dump(item)
            if isinstance(item, Script)
            else _series_response_dump(item) if isinstance(item, Series)
            else item.model_dump() if hasattr(item, "model_dump") else item
            for item in data
        ]
    else:
        processed_data = data

    studio_user = current_studio_user()
    if studio_user:
        processed_data = sign_studio_media_paths(
            processed_data,
            studio_user.owner_profile_id,
            output_root=pipeline.output_root,
        )
    
    # Check if OSS is configured
    uploader = OSSImageUploader()
    if uploader.is_configured:
        # OSS mode: sign URLs in the data
        processed_data = sign_oss_urls_in_data(processed_data, uploader)
    
    # Return JSONResponse directly to avoid Pydantic re-validation stripping fields
    return JSONResponse(content=processed_data)


_ASSET_HISTORY_EXCLUDE = {
    collection: {"__all__": {"asset_revisions"}}
    for collection in ("characters", "scenes", "props")
}


def _series_response_dump(series: Series) -> Dict[str, Any]:
    # Immutable asset snapshots have dedicated revision endpoints. Do not
    # serialize/sign/transfer them for navigation or the live asset view.
    return series.model_dump(exclude=_ASSET_HISTORY_EXCLUDE)


def _script_response_dump(script: Script) -> Dict[str, Any]:
    payload = script.model_dump(exclude={
        "source_revisions",
        "director_profile_revisions",
        "director_profile_draft",
        "director_profile_draft_revision",
        "director_profile_draft_source_revision",
        "director_profile_draft_updated_at",
        "director_shooting_plan_revisions",
        "director_shooting_plan_draft",
        "director_shooting_plan_draft_revision",
        "director_shooting_plan_draft_updated_at",
        "fact_ledger",
        "fact_ledger_revisions",
        "fact_ledger_draft",
        "fact_ledger_draft_revision",
        "fact_ledger_draft_source_revision",
        "fact_ledger_draft_updated_at",
    })
    for collection in ("characters", "scenes", "props"):
        for asset in payload.get(collection, []):
            asset.pop("asset_revisions", None)
    return payload


def _project_cover_source(script: Script) -> Optional[str]:
    """Choose the first durable still used for a workspace project cover."""
    for frame in script.frames or []:
        for value in (getattr(frame, "rendered_image_url", None), getattr(frame, "image_url", None)):
            if value:
                return value
        for asset_name in ("rendered_image_asset", "image_asset"):
            asset = getattr(frame, asset_name, None)
            variants = getattr(asset, "variants", None) if asset else None
            if variants:
                selected_id = getattr(asset, "selected_id", None)
                selected = next((item for item in variants if item.id == selected_id), None) if selected_id else None
                value = getattr(selected or variants[0], "url", None)
                if value:
                    return value
    for scene in script.scenes or []:
        if getattr(scene, "image_url", None):
            return scene.image_url
        asset = getattr(scene, "image_asset", None)
        variants = getattr(asset, "variants", None) if asset else None
        if variants and getattr(variants[0], "url", None):
            return variants[0].url
    return None


def _project_cover_url(script: Script, owner_profile_id: str) -> Optional[str]:
    source = _project_cover_source(script)
    if not source:
        return None
    try:
        return _owned_media_cover_url(source, owner_profile_id, 320)
    except HTTPException:
        return None


def _asset_cover_url(asset: Any, asset_type: str, owner_profile_id: str) -> Optional[str]:
    variants = []
    if asset_type == "character":
        for name in ("reference_sheet", "full_body_asset", "three_view_asset", "headshot_asset"):
            unit = getattr(asset, name, None)
            variants.extend(getattr(unit, "image_variants", None) or getattr(unit, "variants", None) or [] if unit else [])
    else:
        unit = getattr(asset, "image_asset", None)
        variants = list(getattr(unit, "variants", None) or []) if unit else []
    cover_id = getattr(asset, "cover_variant_id", None)
    selected_id = getattr(getattr(asset, "image_asset", None), "selected_id", None)
    variant = next((item for item in variants if item.id == cover_id), None) if cover_id else None
    variant = variant or (next((item for item in variants if item.id == selected_id), None) if selected_id else None)
    raw = image_variant_storage_key(variant) if variant else None
    raw = raw or getattr(asset, "image_url", None) or getattr(asset, "full_body_image_url", None)
    if not raw:
        return None
    try:
        return _owned_media_cover_url(raw, owner_profile_id, 160)
    except HTTPException:
        return None


def _add_asset_cover_urls(payload: Dict[str, Any], owner_profile_id: str) -> None:
    for key, asset_type in (("characters", "character"), ("scenes", "scene"), ("props", "prop")):
        for asset in payload.get(key, []):
            variants = []
            if asset_type == "character":
                for name in ("reference_sheet", "full_body_asset", "three_view_asset", "headshot_asset"):
                    unit = asset.get(name) or {}
                    variants.extend(unit.get("image_variants", unit.get("variants", [])) or [])
            else:
                variants = (asset.get("image_asset") or {}).get("variants", []) or []
            cover_id = asset.get("cover_variant_id")
            selected_id = (asset.get("image_asset") or {}).get("selected_id")
            selected = next((item for item in variants if item.get("id") == cover_id), None) if cover_id else None
            selected = selected or (next((item for item in variants if item.get("id") == selected_id), None) if selected_id else None)
            raw = (selected or {}).get("storage_key") or (selected or {}).get("url")
            raw = raw or asset.get("image_url") or asset.get("full_body_image_url")
            if raw:
                try:
                    asset["cover_url"] = _owned_media_cover_url(raw, owner_profile_id, 160)
                except HTTPException:
                    asset["cover_url"] = None


def _add_storyboard_cover_urls(payload: Dict[str, Any], owner_profile_id: str) -> None:
    """Expose stable WebP covers for storyboard frames in series views."""
    for frame in payload.get("frames", []):
        source = frame.get("rendered_image_url") or frame.get("image_url")
        if not source:
            for key in ("rendered_image_asset", "image_asset"):
                variants = (frame.get(key) or {}).get("variants", [])
                selected_id = (frame.get(key) or {}).get("selected_id")
                selected = next((item for item in variants if item.get("id") == selected_id), None)
                source = (selected or (variants[0] if variants else {})).get("url")
                if source:
                    break
        if source:
            try:
                frame["cover_url"] = _owned_media_cover_url(source, owner_profile_id, 320)
            except HTTPException:
                frame["cover_url"] = None


def private_no_store_signed_response(data):
    """Return owner-scoped mutable data without allowing intermediary caching."""
    response = signed_response(data)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/provider/media/{owner_key}/{relative_path:path}")
def get_provider_media(owner_key: str, relative_path: str, expires: int = 0, signature: str = ""):
    if os.getenv("IFRAME_STORAGE_BACKEND") == "cos":
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    path = verify_provider_media(owner_key, relative_path, expires, signature, output_root=pipeline.output_root)
    return FileResponse(path, headers={"Cache-Control": "private, no-store"})


@app.get("/studio/media/{owner_key}/{relative_path:path}")
def get_studio_media(
    owner_key: str,
    relative_path: str,
    expires: int = 0,
    signature: str = "",
    preview: int = 0,
):
    if os.getenv("IFRAME_STORAGE_BACKEND") == "cos":
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    if preview:
        source_path = verify_studio_media_preview(owner_key, relative_path, preview, expires, signature, output_root=pipeline.output_root)
        owner_root = os.path.join(pipeline.output_root, "users", owner_key, "studio")
        try:
            path = create_media_thumbnail(source_path, owner_root, preview)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=415, detail="A supported image or video is required for preview") from exc
        headers = {"Cache-Control": "private, max-age=1800"}
    else:
        path = verify_studio_media(owner_key, relative_path, expires, signature, output_root=pipeline.output_root)
        headers = None
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path, headers=headers, media_type="image/webp" if preview else None)


@app.get("/studio/media-delivery")
def refresh_studio_media_delivery(
    reference: str,
    preview: int = 0,
    user: UserContext = Depends(require_studio_user),
):
    """Refresh an owned source or WebP cover without trusting URL expiry."""
    from ..studio_access import resolve_studio_reference, studio_media_url, studio_media_preview_url
    from ...utils.media_thumbnails import PREVIEW_MAX_EDGES

    if preview and preview not in PREVIEW_MAX_EDGES:
        raise HTTPException(status_code=422, detail="Unsupported media preview size")
    if os.getenv("IFRAME_STORAGE_BACKEND") == "cos":
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    try:
        stored = resolve_studio_reference(reference, user.owner_profile_id, output_root=pipeline.output_root)
    except (ValueError, FileNotFoundError, HTTPException) as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if stored.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="External media is not managed Studio media")
    url = (studio_media_preview_url(user.owner_profile_id, stored, preview)
           if preview else studio_media_url(user.owner_profile_id, stored, output_root=pipeline.output_root))
    return private_no_store_signed_response({"url": url, "media_type": "image/webp" if preview else None})


@app.get("/studio/owned-media/{owner_key}/{relative_path:path}")
def get_owned_studio_media(
    owner_key: str,
    relative_path: str,
    preview: int = 0,
    user: UserContext = Depends(require_studio_user),
):
    """Serve legacy owner-local asset paths that lack a signed display URL."""
    return _owned_local_media(owner_key, relative_path, preview, user, "studio")


@app.get("/studio/owned-playground-media/{owner_key}/{relative_path:path}")
def get_owned_playground_media(
    owner_key: str,
    relative_path: str,
    preview: int = 0,
    user: UserContext = Depends(require_studio_user),
):
    """Read imported Playground originals through the authenticated owner."""
    return _owned_local_media(owner_key, relative_path, preview, user, "playground")


def _owned_local_media(owner_key: str, relative_path: str, preview: int, user: UserContext, area: str):
    if owner_key != studio_owner_key(user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Media not found")
    if os.getenv("IFRAME_STORAGE_BACKEND") == "cos" and (
        area != "studio" or not relative_path.startswith(".cos-previews/")
    ):
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    owner_root = os.path.realpath(os.path.join(pipeline.output_root, "users", owner_key, area))
    path = os.path.realpath(os.path.join(owner_root, relative_path))
    if not path.startswith(owner_root + os.sep) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Media not found")
    if preview:
        try:
            path = create_media_thumbnail(path, owner_root, preview)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=415, detail="A supported image or video is required for preview") from exc
    media_type = "image/webp" if preview or path.lower().endswith(".webp") else None
    return FileResponse(path, media_type=media_type,
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def _studio_upload_target(user: UserContext, filename: str) -> Tuple[str, str]:
    upload_dir = studio_media_dir(user.owner_profile_id, "uploads", output_root=pipeline.output_root)
    os.makedirs(upload_dir, exist_ok=True)
    absolute_path = os.path.join(upload_dir, filename)
    stored_path = os.path.relpath(absolute_path, pipeline.output_root)
    return absolute_path, stored_path


# ============================================================
# Shared Request Models (used by both Project and Series endpoints)
# ============================================================

class GenerateAssetRequest(BaseModel):
    asset_id: str
    asset_type: str
    style_preset: str = "Cinematic"
    reference_image_url: Optional[str] = None
    reference: Optional[AssetLibraryReference] = None
    references: List[AssetLibraryReference] = Field(default_factory=list, max_length=9)
    image_generation_mode: Literal["text", "reference"] = "text"
    style_prompt: Optional[str] = None
    generation_type: str = "all"  # 'full_body', 'three_view', 'headshot', 'all', 'reference_sheet'
    prompt: Optional[str] = None
    apply_style: bool = True
    preserve_prompt: bool = False
    scene_tool: Optional[Dict[str, Any]] = None
    edit_mode: Optional[Literal["freeform", "scene_lighting", "scene_camera"]] = None
    negative_prompt: Optional[str] = None
    batch_size: int = 1
    model_name: Optional[str] = None
    aspect_ratio: Optional[str] = None
    expected_review_fingerprint: Optional[str] = None

class ToggleLockRequest(BaseModel):
    asset_id: str
    asset_type: str

class UpdateAssetImageRequest(BaseModel):
    asset_id: str
    asset_type: str
    image_url: str

class UpdateAssetAttributesRequest(BaseModel):
    asset_id: str
    asset_type: str
    attributes: Dict[str, Any]
    response_mode: Literal["project", "design"] = "project"


@app.get("/health")
def health_check():
    """Lightweight liveness probe used by the Diagnose UI on stuck
    tasks and by external uptime checks. Intentionally cheap: no DB
    hit, no provider call, just a 200 + a few facts the frontend can
    show next to the spinner ("backend reachable, log file at X")."""
    from ...utils import get_log_dir
    log_dir = get_log_dir()
    log_file = os.path.join(log_dir, "app.log")
    return {
        "ok": True,
        "time": time.time(),
        "log_file": log_file,
        "log_dir": log_dir,
        "studio_projects": len(getattr(pipeline, "scripts", {})),
    }


@app.get("/diagnose/log_tail")
def diagnose_log_tail(lines: int = 200):
    """Return the last N lines of the app log + an ERROR/Exception
    summary so the Diagnose UI on stuck tasks can show actual log
    content instead of just a path. Read-only, capped to 1000 lines so
    a runaway client can't hose the process."""
    from ...utils import get_log_dir
    capped = max(1, min(int(lines or 200), 1000))
    log_path = os.path.join(get_log_dir(), "app.log")
    if not os.path.exists(log_path):
        return {"path": log_path, "lines": [], "errors": [], "missing": True}
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            # Read all, then tail. App.log is bounded by the rotating
            # handler (≤ 5 MB active) so this is safe.
            all_lines = f.readlines()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read log: {exc}")
    tail = all_lines[-capped:] if len(all_lines) > capped else all_lines
    error_keywords = ("ERROR", "Exception", "Failed", "Unauthorized", "Traceback")
    errors = [
        ln.rstrip("\n")
        for ln in tail
        if any(k in ln for k in error_keywords)
    ][-30:]
    return {
        "path": log_path,
        "total_lines": len(all_lines),
        "returned_lines": len(tail),
        "lines": [ln.rstrip("\n") for ln in tail],
        "errors": errors,
        "missing": False,
    }


@app.get("/system/check")
def check_system():
    """Check system dependencies (ffmpeg, etc.) and configuration."""
    from ...utils.system_check import run_system_checks
    return run_system_checks()





@app.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    user: UserContext = Depends(require_studio_user),
):
    """Uploads a file and returns its URL (OSS if configured, else local)."""
    try:
        file_ext = _safe_upload_ext(file.filename)
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path, stored_path = _studio_upload_target(user, filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        uploader = OSSImageUploader()
        from ..studio_access import studio_owner_key
        oss_key = uploader.upload_file(
            file_path,
            sub_path=f"users/{studio_owner_key(user.owner_profile_id)}/studio/uploads",
            output_root=pipeline.output_root,
        )
        storage_key = oss_key or stored_path
        from ..media_registry import register_media
        media_id = register_media(
            user.owner_profile_id,
            storage_key,
            kind="temporary_input",
            display_name=os.path.basename(file.filename or filename),
        )
        if oss_key:
            return signed_response({"url": oss_key, "media_id": media_id, "storage_key": storage_key})

        # Fallback to local URL (relative path for frontend getAssetUrl)
        return signed_response({"url": stored_path, "media_id": media_id, "storage_key": storage_key})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UploadAssetRequest(BaseModel):
    upload_type: str  # "full_body" | "head_shot" | "three_views" | "image"
    description: Optional[str] = None  # User-modified description for reverse generation


@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/upload")
def upload_asset(
    script_id: str,
    asset_type: str,
    asset_id: str,
    upload_type: str,
    description: Optional[str] = None,
    file: UploadFile = File(...),
    user: UserContext = Depends(require_studio_user),
):
    """
    Uploads an image as a new variant for an asset.
    The uploaded image is marked as the 'upload source' for reverse generation.
    
    - asset_type: "character", "scene", or "prop"
    - upload_type: "full_body", "head_shot", "three_views", or "image" (for scene/prop)
    - description: Optional modified description for the asset
    """
    try:
        # 1. Save file locally first
        file_ext = _safe_upload_ext(file.filename)
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path, stored_path = _studio_upload_target(user, filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # 2. Upload to OSS
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(file_path, output_root=pipeline.output_root)
        if not oss_url:
            oss_url = stored_path
        
        # 3. Update asset with new variant
        updated_script = pipeline.add_uploaded_asset_variant(
            script_id=script_id,
            asset_type=asset_type,
            asset_id=asset_id,
            upload_type=upload_type,
            image_url=oss_url,
            description=description
        )
        
        if not updated_script:
            raise HTTPException(status_code=404, detail="Script or asset not found")
        
        return get_project(script_id)
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Error uploading asset: {e}")
        raise HTTPException(status_code=500, detail=str(e))


_EDITOR_IMAGE_MAX_BYTES = 25 * 1024 * 1024


@app.get("/projects/{script_id}/assets/{asset_type}/{asset_id}/variants/{variant_id}/content")
def get_asset_variant_content(
    script_id: str,
    asset_type: str,
    asset_id: str,
    variant_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Return an owner-visible image variant through the Studio origin.

    Canvas editors cannot reliably read private COS images directly because a
    displayable signed URL may still lack browser canvas CORS headers. Resolve
    the stable variant ids server-side so this endpoint never becomes an
    arbitrary URL proxy.
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        resolved, _ = pipeline._resolve_asset_library_reference(script, {
            "asset_type": asset_type,
            "asset_id": asset_id,
            "variant_id": variant_id,
        })
    except InvalidAssetReference as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    if os.path.isfile(resolved):
        if os.path.getsize(resolved) > _EDITOR_IMAGE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds 25 MiB")
        return FileResponse(resolved, headers=headers)

    uploader = OSSImageUploader()
    fetch_url = ""
    if is_object_key(resolved):
        fetch_url = uploader.sign_url_for_api(resolved)
    elif resolved.startswith(("https://", "http://")) and uploader.is_configured:
        parsed = urlparse(resolved)
        probe = urlparse(uploader.sign_url_for_api("__iframe_editor_probe__"))
        if parsed.hostname and parsed.hostname == probe.hostname:
            fetch_url = uploader.sign_url_for_api(unquote(parsed.path.lstrip("/")))
    if not fetch_url:
        raise HTTPException(status_code=422, detail="Variant image storage is not editable")

    try:
        request = UrlRequest(fetch_url, headers={"User-Agent": "iFrame-Studio/1.0"})
        with urlopen(request, timeout=30) as remote:
            content_type = (remote.headers.get_content_type() or "").lower()
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=422, detail="Variant content is not an image")
            data = remote.read(_EDITOR_IMAGE_MAX_BYTES + 1)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Unable to read asset variant %s for editor: %s", variant_id, exc)
        raise HTTPException(status_code=502, detail="Unable to load image for editing") from exc
    if len(data) > _EDITOR_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 25 MiB")
    return Response(data, media_type=content_type, headers=headers)


class CreateProjectRequest(BaseModel):
    title: str
    text: str
    workflow_mode: str = "r2v"  # "r2v" (default) or "i2v_legacy"
    # Optional series binding (T9). When set, the new project is created as
    # the next episode of this series (episode_number = current max + 1).
    # Omit for a standalone project — behavior unchanged.
    series_id: Optional[str] = None


@app.post("/projects", response_model=Script)
async def create_project(
    request: CreateProjectRequest,
    skip_analysis: bool = False,
    user: UserContext = Depends(require_studio_user),
):
    """Creates a new project from a novel text.

    When `series_id` is provided the project is bound as the next episode
    of that series; omitting it keeps the standalone-project behavior
    unchanged.
    """
    # Run in thread pool to avoid blocking event loop during LLM analysis (Python 3.8 compatible)
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,  # Use default executor
            partial(
                pipeline.create_project,
                request.title,
                request.text,
                skip_analysis,
                request.workflow_mode,
                request.series_id,
                user.user_id,
                user.owner_profile_id,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return signed_response(result)



class ReparseProjectRequest(BaseModel):
    text: str
    draft: Optional[Dict[str, List[Dict[str, Any]]]] = None


class ExtractionRefineRequest(BaseModel):
    text: str
    draft: Dict[str, List[Dict[str, Any]]]
    instructions: List[str] = Field(min_length=1, max_length=12)


class UpdateScriptTextRequest(BaseModel):
    text: str


@app.put("/projects/{script_id}/text", response_model=Script)
def update_script_text(script_id: str, request: UpdateScriptTextRequest):
    """Persist `original_text` without re-parsing entities.

    Used by ScriptProcessor's onBlur so typing survives reload/navigation
    without triggering an LLM round-trip. Heavy reparse stays bound to the
    explicit "提取实体" CTA.
    """
    try:
        return signed_response(pipeline.update_script_text(script_id, request.text))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _source_snapshots(script: Script) -> List[ScriptSourceRevision]:
    if script.source_revisions:
        return script.source_revisions
    return [ScriptSourceRevision(
        revision=script.source_revision,
        content_hash=source_version(script.original_text),
        text=script.original_text,
        created_at=script.created_at,
    )]


@app.get("/projects/{script_id}/source-revisions")
def list_source_revisions(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return [snapshot.model_dump(exclude={"text"}) for snapshot in _source_snapshots(script)]


@app.get("/projects/{script_id}/source-revisions/{revision}", response_model=ScriptSourceRevision)
def get_source_revision(
    script_id: str,
    revision: int,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    snapshot = next((item for item in _source_snapshots(script) if item.revision == revision), None)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Source revision not found")
    return snapshot


@app.put("/projects/{script_id}/reparse", response_model=Script)
async def reparse_project(script_id: str, request: ReparseProjectRequest):
    """Re-parses the text for an existing project, replacing all entities."""
    try:
        # Run the blocking LLM call in a thread pool to avoid blocking the event loop (Python 3.8 compatible)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,  # Use default executor
            partial(pipeline.reparse_project, script_id, request.text, request.draft)
        )
        return signed_response(result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# New clients use short requests so an interrupted browser cannot cancel extraction.
from .extraction_jobs import ExtractionJobs
from .llm import entity_extraction_prompt_revision
extraction_jobs = ExtractionJobs()


@app.on_event("startup")
def recover_interrupted_extraction_jobs():
    recovered = extraction_jobs.recover_interrupted()
    if recovered:
        logger.warning("Recovered %s interrupted extraction jobs", recovered)


def extraction_response(job, script_id):
    if job['status'] == 'completed':
        # Rehydrate the apply cache, including after a backend restart.
        result = Script(**job['result'])
        pipeline._extraction_cache[script_id] = (time.time(), result)
        job = {**job, 'result': {
            'characters': [c.dict() for c in result.characters],
            'crowd_groups': [c.dict() for c in result.crowd_group_candidates],
            'scenes': [s.dict() for s in result.scenes],
            'props': [p.dict() for p in result.props],
        }}
    return job


@app.post("/projects/{script_id}/extraction-jobs", status_code=202)
def start_extraction(script_id: str, request: ReparseProjectRequest,
                     user: UserContext = Depends(require_studio_user)):
    import hashlib
    script = pipeline.scripts.get(script_id)
    if not script:
        raise HTTPException(404, 'Script not found')
    llm = pipeline.script_processor.llm
    prompt = getattr(getattr(script, 'prompt_config', None), 'entity_extraction', '')
    fingerprint = hashlib.sha256(json.dumps([
        request.text, prompt, llm.provider, llm._get_default_model(), entity_extraction_prompt_revision(),
    ], ensure_ascii=False).encode()).hexdigest()
    job = extraction_jobs.start(user.owner_profile_id, script_id, fingerprint,
                                lambda: pipeline.script_processor.parse_novel(script.title, request.text, prompt).dict())
    return extraction_response(job, script_id)


@app.post("/projects/{script_id}/extraction-jobs/refine", status_code=202)
def start_extraction_refinement(
    script_id: str,
    request: ExtractionRefineRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Revise the pending extraction draft without mutating project Cast."""
    script = pipeline.scripts.get(script_id)
    if not script:
        raise HTTPException(404, "Script not found")
    instructions = [item.strip() for item in request.instructions if item.strip()]
    if not instructions or any(len(item) > 2000 for item in instructions):
        raise HTTPException(422, "Revision instructions must contain 1-12 non-empty items of at most 2000 characters")
    draft = {key: list(request.draft.get(key, [])) for key in ("characters", "crowd_groups", "scenes", "props")}
    llm = pipeline.script_processor.llm
    prompt = getattr(getattr(script, "prompt_config", None), "entity_extraction", "")
    fingerprint = hashlib.sha256(json.dumps([
        request.text,
        draft,
        instructions,
        prompt,
        llm.provider,
        llm._get_default_model(),
        entity_extraction_prompt_revision(),
    ], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    job = extraction_jobs.start(
        user.owner_profile_id,
        script_id,
        fingerprint,
        lambda: pipeline.script_processor.refine_entity_extraction(
            script.title,
            request.text,
            draft,
            instructions,
            prompt,
        ).dict(),
    )
    return extraction_response(job, script_id)


@app.get("/projects/{script_id}/extraction-jobs/{job_id}")
def extraction_status(script_id: str, job_id: str, user: UserContext = Depends(require_studio_user)):
    return extraction_response(extraction_jobs.get(user.owner_profile_id, script_id, job_id), script_id)


@app.post("/projects/{script_id}/extract_preview")
async def extract_preview(script_id: str, request: ReparseProjectRequest):
    """Dry-run entity extraction — returns entities without saving."""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(pipeline.extract_preview, script_id, request.text)
        )
        return {
            "characters": [c.dict() for c in result.characters],
            "crowd_groups": [c.dict() for c in result.crowd_group_candidates],
            "scenes": [s.dict() for s in result.scenes],
            "props": [p.dict() for p in result.props],
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/projects/", response_model=List[dict])
def list_projects(user: UserContext = Depends(require_studio_user)):
    """Lists all projects from backend storage."""
    scripts = pipeline.list_scripts(user.owner_profile_id)
    payload = []
    for script in scripts:
        item = _script_response_dump(script) | {"cover_url": _project_cover_url(script, user.owner_profile_id)}
        _add_asset_cover_urls(item, user.owner_profile_id)
        payload.append(item)
    return signed_response(payload)


@app.post("/projects/{script_id}/toggle_starred")
def toggle_project_starred(script_id: str):
    """Toggle the user-starred (featured shortlist) flag on a project."""
    try:
        script = pipeline.toggle_project_starred(script_id)
        return signed_response(script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Series CRUD
# ============================================================

class CreateSeriesRequest(BaseModel):
    title: str
    description: str = ""
    workflow_mode: str = "r2v"
    # R2V v2 Phase 6 — content mode (scripted | freeform), defaults
    # scripted (traditional script-first flow).
    content_mode: str = "scripted"
    # PR-3e (r2v-workflow-v3) — Visual control preference.
    # 'r2v' (节奏优先, default) | 'i2v' (画面优先).
    default_generation_mode: str = "r2v"


class UpdateSeriesRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    workflow_mode: Optional[str] = None
    content_mode: Optional[str] = None
    default_generation_mode: Optional[str] = None
    extra_roster: Optional[List[ExtraRosterEntry]] = None
    # R2V v2: series-level art_direction baseline (Phase 2). Inherits +
    # override flows at the episode level read this as the source of truth.
    art_direction: Optional[ArtDirection] = None


class AssemblyPlanEnvelope(BaseModel):
    """Optional envelope for clients that keep the base revision separately."""

    plan: AssemblyEditPlan
    expected_revision: Optional[int] = Field(None, ge=1)


@app.post("/series")
def create_series(
    request: CreateSeriesRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Create a new Series."""
    series = pipeline.create_series(
        request.title,
        request.description,
        request.workflow_mode,
        request.content_mode,
        request.default_generation_mode,
        user.user_id,
        user.owner_profile_id,
    )
    return signed_response(series)


@app.get("/series")
def list_series(user: UserContext = Depends(require_studio_user)):
    """List all Series."""
    series_list = pipeline.list_series(user.owner_profile_id)
    return signed_response(series_list)


@app.get("/series/{series_id}")
def get_series(series_id: str, user: UserContext = Depends(require_studio_user)):
    """Get Series details including assets and episode list."""
    series = pipeline.get_series(series_id, user.owner_profile_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    # Include episode summaries
    episodes = pipeline.get_series_episodes(series_id)
    result = _series_response_dump(series)
    _add_asset_cover_urls(result, user.owner_profile_id)
    result["episodes"] = [
        {
            "id": ep.id,
            "title": ep.title,
            "episode_number": ep.episode_number,
            "created_at": ep.created_at,
            "updated_at": ep.updated_at,
        }
        for ep in episodes
    ]
    return signed_response(result)


@app.get("/series/{series_id}/assembly-plan")
def get_series_assembly_plan(
    series_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Return the series Assembly plan, or null for the legacy flow."""
    try:
        if not pipeline.get_series(series_id, user.owner_profile_id):
            raise HTTPException(status_code=404, detail="Series not found")
        return signed_response(pipeline.get_assembly_plan("series", series_id))
    except AssemblyPlanValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/series/{series_id}/assembly-plan")
def put_series_assembly_plan(
    series_id: str,
    payload: Union[AssemblyEditPlan, AssemblyPlanEnvelope],
    user: UserContext = Depends(require_studio_user),
):
    """Persist a validated series Assembly plan without submitting Motion."""
    plan = payload.plan if isinstance(payload, AssemblyPlanEnvelope) else payload
    expected_revision = (
        payload.expected_revision
        if isinstance(payload, AssemblyPlanEnvelope)
        else plan.revision
    )
    try:
        saved = pipeline.save_assembly_plan(
            "series",
            series_id,
            plan,
            expected_revision=expected_revision,
        )
        return signed_response(saved)
    except AssemblyPlanConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
            },
        )
    except AssemblyPlanValidationError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/series/{series_id}/assembly-plan/render")
def render_series_assembly_plan(
    series_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Explicitly compile the saved series Assembly plan."""
    if not pipeline.get_series(series_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Series not found")
    try:
        rendered = pipeline.render_assembly_plan(
            "series",
            series_id,
            user.owner_profile_id,
        )
        return signed_response({"url": rendered.merged_video_url})
    except AssemblyPlanConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
            },
        )
    except AssemblyPlanValidationError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/series/{series_id}")
def update_series(series_id: str, request: UpdateSeriesRequest):
    """Update Series fields. Uses `exclude_unset=True` so explicitly-null
    values (e.g. `{"art_direction": null}` to clear baseline) are honored,
    while fields the client didn't send remain untouched."""
    try:
        updates = request.model_dump(exclude_unset=True)
        series = pipeline.update_series(series_id, updates)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class ExtraRosterProposalRequest(BaseModel):
    brief: str = Field(..., min_length=1, max_length=4000)
    count: int = Field(6, ge=1, le=20)


@app.post("/series/{series_id}/extra-roster/proposals")
def generate_extra_roster_proposals(series_id: str, request: ExtraRosterProposalRequest):
    try:
        return {"proposals": pipeline.generate_extra_roster_proposals(series_id, request.brief, request.count)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/series/{series_id}")
def delete_series(series_id: str):
    """Delete a Series and disassociate its episodes."""
    try:
        pipeline.delete_series(series_id)
        return {"status": "deleted"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class AddEpisodeRequest(BaseModel):
    script_id: str
    episode_number: Optional[int] = None


@app.post("/series/{series_id}/episodes")
def add_episode_to_series(series_id: str, request: AddEpisodeRequest):
    """Add an existing project as an episode to a Series."""
    try:
        series = pipeline.add_episode_to_series(series_id, request.script_id, request.episode_number)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/series/{series_id}/episodes/{script_id}")
def remove_episode_from_series(series_id: str, script_id: str):
    """Remove an episode from a Series (does not delete the project)."""
    try:
        series = pipeline.remove_episode_from_series(series_id, script_id)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/series/{series_id}/episodes")
def get_series_episodes(series_id: str, user: UserContext = Depends(require_studio_user)):
    """Get all episodes in a Series."""
    try:
        episodes = pipeline.get_series_episodes(series_id)
        payload = []
        for episode in episodes:
            item = _script_response_dump(episode) | {"cover_url": _project_cover_url(episode, user.owner_profile_id)}
            _add_asset_cover_urls(item, user.owner_profile_id)
            _add_storyboard_cover_urls(item, user.owner_profile_id)
            payload.append(item)
        return signed_response(payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/series/{series_id}/prompt_config")
def get_series_prompt_config(series_id: str):
    """Get Series prompt config with system defaults."""
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return {
        "prompt_config": series.prompt_config.model_dump(),
        "defaults": {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
            "storyboard_extraction": DEFAULT_STORYBOARD_EXTRACTION_PROMPT,
        },
    }


@app.put("/series/{series_id}/prompt_config")
def update_series_prompt_config(series_id: str, config: PromptConfig):
    """Update Series-level prompt config."""
    try:
        series = pipeline.update_series(series_id, {"prompt_config": config})
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================
# Series Model Settings
# ============================================================

class UpdateModelSettingsRequest(BaseModel):
    t2i_model: Optional[str] = None
    i2i_model: Optional[str] = None
    image_model: Optional[str] = None
    i2v_model: Optional[str] = None
    r2v_model: Optional[str] = None
    character_aspect_ratio: Optional[str] = None
    scene_aspect_ratio: Optional[str] = None
    prop_aspect_ratio: Optional[str] = None
    storyboard_aspect_ratio: Optional[str] = None

@app.get("/series/{series_id}/model_settings")
def get_series_model_settings(series_id: str):
    """Get Series model settings."""
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return series.model_settings.model_dump()


@app.put("/series/{series_id}/model_settings")
def update_series_model_settings(series_id: str, settings: UpdateModelSettingsRequest):
    """Update Series-level model settings."""
    updates = {k: v for k, v in settings.model_dump().items() if v is not None}
    if not updates:
        series = pipeline.get_series(series_id)
        if not series:
            raise HTTPException(status_code=404, detail="Series not found")
        return signed_response(series)
    try:
        current_series = pipeline.get_series(series_id)
        if not current_series:
            raise HTTPException(status_code=404, detail="Series not found")
        ms = current_series.model_settings.model_copy(update=updates)
        series = pipeline.update_series(series_id, {"model_settings": ms})
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================
# Series Asset Operations
# ============================================================

@app.get("/series/{series_id}/assets")
def get_series_assets(series_id: str, user: UserContext = Depends(require_studio_user)):
    """Get all shared assets from a Series."""
    series = pipeline.get_series(series_id, user.owner_profile_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    payload = {
        "characters": [c.model_dump() for c in series.characters],
        "scenes": [s.model_dump() for s in series.scenes],
        "props": [p.model_dump() for p in series.props],
    }
    _add_asset_cover_urls(payload, user.owner_profile_id)
    return signed_response(payload)


@app.delete("/series/{series_id}/assets/{asset_type}/{asset_id}")
def delete_series_asset(series_id: str, asset_type: Literal["character", "scene", "prop"], asset_id: str,
                        force: bool = False, user: UserContext = Depends(require_studio_user)):
    try:
        pipeline.delete_series_asset(series_id, asset_type, asset_id, user.owner_profile_id, force)
        return {"status": "deleted", "asset_type": asset_type, "id": asset_id}
    except LibraryAssetInUseError as exc:
        raise HTTPException(status_code=409, detail={
            "error": "series_asset_in_use",
            "message": "Asset is referenced by an episode. Force deletion removes current frame and asset bindings; confirmed shooting plan history retains its original IDs.",
            "references": exc.references,
        }) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _require_reviewed_asset_image_prompt(
    request: GenerateAssetRequest, *, require_fingerprint: bool = False,
) -> None:
    """Manual image routes must receive the prompt exactly as reviewed in the UI."""
    if not request.prompt or not request.prompt.strip():
        raise HTTPException(status_code=422, detail="Review a non-empty asset image prompt before generating")
    if not request.preserve_prompt or request.apply_style:
        raise HTTPException(status_code=422, detail="Submit the complete visible prompt; hidden style or template append is disabled")
    if request.asset_type == "character" and request.generation_type == "all":
        raise HTTPException(status_code=422, detail="Choose one reviewed character image type per submission")
    if request.reference_image_url:
        raise HTTPException(status_code=422, detail="Select a reference by stable asset and variant ID before generating")
    if request.asset_type == "character" and request.generation_type in ("three_view", "headshot"):
        if request.image_generation_mode != "reference" or request.reference is None or request.references:
            raise HTTPException(status_code=422, detail="Choose one explicit master image variant for this derived character view")
    if require_fingerprint and not request.expected_review_fingerprint:
        raise HTTPException(status_code=422, detail="Preview and confirm the asset image request before generating")


@app.post("/series/{series_id}/assets/generate/preview")
def preview_series_asset_image(series_id: str, request: GenerateAssetRequest):
    _require_reviewed_asset_image_prompt(request)
    try:
        return pipeline.preview_asset_image_submission(
            series_id, request.asset_id, request.asset_type, prompt=request.prompt,
            negative_prompt=request.negative_prompt or "", model_name=request.model_name,
            generation_type=request.generation_type, image_generation_mode=request.image_generation_mode,
            batch_size=request.batch_size, reference=request.reference,
            references=request.references, is_series=True,
        )
    except (InvalidAssetReference, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/projects/{script_id}/assets/generate/preview")
def preview_project_asset_image(script_id: str, request: GenerateAssetRequest):
    _require_reviewed_asset_image_prompt(request)
    try:
        return pipeline.preview_asset_image_submission(
            script_id, request.asset_id, request.asset_type, prompt=request.prompt,
            negative_prompt=request.negative_prompt or "", model_name=request.model_name,
            aspect_ratio=request.aspect_ratio, generation_type=request.generation_type,
            image_generation_mode=request.image_generation_mode, batch_size=request.batch_size,
            reference=request.reference, references=request.references,
            scene_tool=request.scene_tool,
            edit_mode=request.edit_mode,
        )
    except (InvalidAssetReference, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/series/{series_id}/assets/generate")
def generate_series_asset(series_id: str, request: GenerateAssetRequest, background_tasks: BackgroundTasks):
    """Generate a single asset for a Series (async)."""
    if request.scene_tool is not None:
        raise HTTPException(status_code=400, detail="scene_tool is only available for project scene assets")
    _require_reviewed_asset_image_prompt(request, require_fingerprint=True)
    try:
        series, task_id = pipeline.generate_series_asset(
            series_id,
            request.asset_id,
            request.asset_type,
            request.style_preset,
            request.reference_image_url,
            request.style_prompt,
            request.generation_type,
            request.prompt,
            request.apply_style,
            request.negative_prompt,
            request.batch_size,
            request.model_name,
            request.reference,
            request.references,
            request.image_generation_mode,
            request.preserve_prompt,
            request.expected_review_fingerprint,
        )
        background_tasks.add_task(pipeline.process_asset_generation_task, task_id)
        response_data = series.dict()
        response_data["_task_id"] = task_id
        return signed_response(response_data)
    except InvalidAssetReference as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AssetGenerationInProgress as e:
        raise HTTPException(status_code=409, detail=str(e))
    except AssetReviewChanged as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/series/{series_id}/assets/toggle_lock")
def toggle_series_asset_lock(series_id: str, request: ToggleLockRequest):
    """Toggle the locked status of a Series asset."""
    try:
        series = pipeline.toggle_series_asset_lock(series_id, request.asset_id, request.asset_type)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/series/{series_id}/assets/toggle_starred")
def toggle_series_asset_starred(series_id: str, request: ToggleLockRequest):
    """Toggle the starred (library shortlist) status of a Series asset."""
    try:
        series = pipeline.toggle_series_asset_starred(series_id, request.asset_id, request.asset_type)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/series/{series_id}/assets/update_image")
def update_series_asset_image(series_id: str, request: UpdateAssetImageRequest):
    """Update a Series asset's image URL."""
    try:
        series = pipeline.update_series_asset_image(series_id, request.asset_id, request.asset_type, request.image_url)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/series/{series_id}/assets/update_attributes")
def update_series_asset_attributes(series_id: str, request: UpdateAssetAttributesRequest):
    """Update arbitrary attributes of a Series asset."""
    try:
        series = pipeline.update_series_asset_attributes(
            series_id, request.asset_id, request.asset_type, request.attributes
        )
        return signed_response(series)
    except InvalidAssetName as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ImportAssetsRequest(BaseModel):
    source_series_id: str
    asset_ids: List[str]


class ForkFromLibraryRequest(BaseModel):
    asset_type: str          # "character" | "scene" | "prop"
    library_asset_id: str    # id of the source asset in the global library


# R2V v2 Phase 5 — quick-create CRUD for series-shared assets.
# Used by Cast step's "+ 新角色 / 新场景 / 新道具" modal. Optional
# `image_url` lets the user attach a pre-uploaded master sheet so the
# new asset isn't blank.
class CreateSeriesAssetRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    persona: Optional[str] = ""        # characters only — grouping label
    image_url: Optional[str] = None    # optional uploaded master sheet
    voice_id: Optional[str] = None     # characters only — TTS voice binding


def _new_id(prefix: str) -> str:
    import uuid
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@app.post("/series/{series_id}/characters")
def create_series_character(series_id: str, request: CreateSeriesAssetRequest):
    """Create a new Character at series scope."""
    from .models import Character, AssetUnit, ImageVariant
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    char_id = _new_id("char")
    ref_sheet = AssetUnit()
    if request.image_url:
        variant = ImageVariant(id=_new_id("img"), url=request.image_url)
        ref_sheet.image_variants.append(variant)
        ref_sheet.selected_image_id = variant.id
    char = Character(
        id=char_id,
        owner_user_id=series.owner_user_id,
        owner_profile_id=series.owner_profile_id,
        name=request.name,
        description=request.description or "",
        persona=request.persona or "",
        voice_id=request.voice_id,
        reference_sheet=ref_sheet,
    )
    series.characters.append(char)
    series.updated_at = time.time()
    pipeline.series_store[series_id] = series
    pipeline._save_series_data()
    return signed_response(char.model_dump())


@app.post("/series/{series_id}/scenes")
def create_series_scene(series_id: str, request: CreateSeriesAssetRequest):
    from .models import Scene
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    sid = _new_id("scene")
    scene = Scene(
        id=sid,
        owner_user_id=series.owner_user_id,
        owner_profile_id=series.owner_profile_id,
        name=request.name,
        description=request.description or "",
        image_url=request.image_url,
    )
    series.scenes.append(scene)
    series.updated_at = time.time()
    pipeline.series_store[series_id] = series
    pipeline._save_series_data()
    return signed_response(scene.model_dump())


@app.post("/series/{series_id}/props")
def create_series_prop(series_id: str, request: CreateSeriesAssetRequest):
    from .models import Prop
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    pid = _new_id("prop")
    prop = Prop(
        id=pid,
        owner_user_id=series.owner_user_id,
        owner_profile_id=series.owner_profile_id,
        name=request.name,
        description=request.description or "",
        image_url=request.image_url,
    )
    series.props.append(prop)
    series.updated_at = time.time()
    pipeline.series_store[series_id] = series
    pipeline._save_series_data()
    return signed_response(prop.model_dump())


@app.post("/series/{series_id}/assets/import")
def import_series_assets(series_id: str, request: ImportAssetsRequest):
    """Deep-copy assets from another Series into this one."""
    try:
        series, imported_ids, skipped_ids = pipeline.import_assets_from_series(series_id, request.source_series_id, request.asset_ids)
        return signed_response(series)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/series/{series_id}/assets/import-from-library")
def import_series_assets_from_library(series_id: str, request: ForkFromLibraryRequest):
    """Copy one global library asset into the series shared asset pool."""
    try:
        asset = pipeline.fork_library_asset_to_series(series_id, request.asset_type, request.library_asset_id)
        return signed_response(asset.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Global Asset Library (project-independent shared pool) — CRUD + promote
# ============================================================
# Mirrors the /series/{id}/assets endpoints, one level up: a curated,
# project-independent pool any project can reference. All mutations route
# through the ComicGenPipeline.*_library_asset methods so the Playground
# "录入资产库" flow stays consistent with these endpoints.

class CreateLibraryAssetRequest(BaseModel):
    asset_type: str                    # "character" | "scene" | "prop"
    name: str
    description: Optional[str] = ""
    persona: Optional[str] = ""        # characters only — grouping label
    image_url: Optional[str] = None    # optional pre-uploaded master image
    image_origin: Optional[Literal["upload", "workbench"]] = None
    source_generation_id: Optional[str] = None
    source_output_id: Optional[str] = None
    voice_id: Optional[str] = None     # characters only — TTS voice binding
    initial_variants: List[Dict[str, Any]] = Field(default_factory=list, max_length=8)


class UpdateLibraryAssetRequest(BaseModel):
    # Generic patch — only the fields the client actually sends are applied
    # (PATCH semantics; PUT here is lenient/partial).
    name: Optional[str] = None
    description: Optional[str] = None
    persona: Optional[str] = None
    image_url: Optional[str] = None
    voice_id: Optional[str] = None
    starred: Optional[bool] = None
    locked: Optional[bool] = None
    visual_weight: Optional[int] = None


class PromoteAssetRequest(BaseModel):
    source_kind: str   # "project" | "series"
    source_id: str
    asset_type: str    # "character" | "scene" | "prop"
    asset_id: str


def _library_asset_payload(request: CreateLibraryAssetRequest, user: UserContext) -> Dict[str, Any]:
    payload = request.model_dump(exclude={"asset_type"})
    if request.image_origin != "workbench":
        return payload
    if not request.source_generation_id or not request.source_output_id:
        raise ValueError("Workbench material provenance is required")
    generation = playground_storage_for(user).get_generation(request.source_generation_id)
    if generation is None:
        raise ValueError("Workbench generation not found")
    output = next((item for item in generation.outputs if item.id == request.source_output_id), None)
    if output is None or output.media_type != "image":
        raise ValueError("Workbench image output not found")
    payload["image_url"] = output.media_path
    payload["source_generation_id"] = generation.id
    payload["source_output_id"] = output.id
    return payload


@app.get("/library/assets")
def get_library_assets(user: UserContext = Depends(require_studio_user)):
    """List all assets in the global shared pool."""
    lib = pipeline.list_library_assets()
    payload = {
        "characters": [c.model_dump() for c in lib.characters],
        "scenes": [s.model_dump() for s in lib.scenes],
        "props": [p.model_dump() for p in lib.props],
    }
    # Keep the source image identity intact while exposing a current, signed
    # WebP cover for every asset card. Consumers must prefer cover_url for
    # list/grid rendering and reserve image_url for full-resolution use.
    _add_asset_cover_urls(payload, user.owner_profile_id)
    return signed_response(payload)


@app.post("/library/assets")
def create_library_asset(
    request: CreateLibraryAssetRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Create a new asset in the global shared pool."""
    try:
        payload = _library_asset_payload(request, user)
        asset = pipeline.create_library_asset(request.asset_type, payload)
        return signed_response(asset.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/library/assets/upload")
def upload_library_asset_image(
    file: UploadFile = File(...),
    user: UserContext = Depends(require_studio_user),
):
    """Upload an image to use as a global library asset's master image.

    Saves the file under the owner's managed output tree. The returned
    image_url is a durable local storage path even when an OSS mirror exists.
    The caller then passes this image_url to
    POST /library/assets (image_url=...) or PATCH /library/assets/{type}/{id}
    to attach it to a library asset. Mirrors the generic /upload endpoint but
    returns the {image_url} contract the library UI expects.
    """
    try:
        file_ext = _safe_upload_ext(file.filename)
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path, stored_path = _studio_upload_target(user, filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"image_url": stored_path}
    except Exception as e:
        logger.exception("upload_library_asset_image failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.api_route("/library/assets/{asset_type}/{asset_id}", methods=["PUT", "PATCH"])
def update_library_asset(asset_type: str, asset_id: str, request: UpdateLibraryAssetRequest):
    """Patch a global library asset (only the provided fields are applied)."""
    try:
        patch = request.model_dump(exclude_unset=True)
        asset = pipeline.update_library_asset(asset_type, asset_id, patch)
        return signed_response(asset.model_dump())
    except InvalidAssetName as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/library/assets/{asset_type}/{asset_id}")
def delete_library_asset(asset_type: str, asset_id: str, force: bool = False):
    """Delete an asset from the global shared pool.

    Reference-integrity (design Q2): if any storyboard frame in any project or
    series still references this asset (via scene_id / character_ids /
    prop_ids), the delete is refused with HTTP 409 and the referrers are
    listed — unless ``force=true`` is passed, which deletes anyway and leaves
    those references dangling (the asset resolver simply drops the unknown id).
    """
    try:
        pipeline.delete_library_asset(asset_type, asset_id, force=force)
        return {"status": "deleted", "asset_type": asset_type, "id": asset_id}
    except LibraryAssetInUseError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "library_asset_in_use",
                "message": str(e),
                "asset_type": e.asset_type,
                "asset_id": e.asset_id,
                "references": e.references,
                "hint": "Pass ?force=true to delete anyway.",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/library/assets/promote")
def promote_asset_to_library(request: PromoteAssetRequest):
    """Deep-copy an asset from a project or series into the global pool."""
    try:
        asset = pipeline.promote_asset_to_library(
            request.source_kind, request.source_id, request.asset_type, request.asset_id
        )
        return signed_response(asset.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/assets/fork_from_library")
def fork_asset_from_library(script_id: str, request: ForkFromLibraryRequest):
    """Fork (deep-copy) a global library asset into this project as an
    independent, editable local copy with a fresh id (design Q3, 按需 fork).

    Under live-reference (D1 活引用) semantics a project references shared
    library assets directly; this endpoint materializes a project-owned copy
    so subsequent edits no longer affect the shared original. Returns the new
    project-local asset.
    """
    try:
        asset = pipeline.fork_library_asset_to_project(
            script_id, request.asset_type, request.library_asset_id
        )
        return signed_response(asset.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# File Import & Episode Splitting
# ============================================================

def _import_text_path(owner_profile_id: str, import_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", import_id or ""):
        raise ValueError("Import preview not found")
    owner_key = hashlib.sha256(owner_profile_id.encode("utf-8")).hexdigest()
    root = Path(get_user_data_dir()) / "imports" / owner_key
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{import_id}.txt"


def _store_import_text(owner_profile_id: str, import_id: str, text: str) -> None:
    target = _import_text_path(owner_profile_id, import_id)
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(text.encode("utf-8"))
    os.replace(temporary, target)


def _load_import_text(owner_profile_id: str, import_id: str) -> Optional[str]:
    path = _import_text_path(owner_profile_id, import_id)
    if not path.is_file():
        return None
    return path.read_bytes().decode("utf-8")


def _delete_import_text(owner_profile_id: str, import_id: str) -> None:
    path = _import_text_path(owner_profile_id, import_id)
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _run_import_preview(owner_profile_id: str, filename: str, text: str,
                        suggested_episodes: int) -> Dict[str, Any]:
    episodes = pipeline.import_file_and_split(text, suggested_episodes)
    series_context, screenplay_text = ComicGenPipeline._split_import_series_context(text)
    import_id = uuid.uuid4().hex
    _store_import_text(owner_profile_id, import_id, text)
    return {
        "filename": os.path.basename(filename or "import.txt"),
        "text_length": len(text),
        "screenplay_text_length": len(screenplay_text),
        "series_context": series_context,
        "suggested_episodes": suggested_episodes,
        "episodes": episodes,
        "import_id": import_id,
    }

@app.post("/series/import/preview", status_code=202)
async def import_file_preview(
    file: UploadFile = File(...),
    suggested_episodes: int = 3,
    user: UserContext = Depends(require_studio_user),
):
    """Upload text once and start or resume a durable episode-split job."""
    if suggested_episodes < 1 or suggested_episodes > 100:
        raise HTTPException(status_code=400, detail="建议集数应在 1-100 之间")
    try:
        content_bytes = await file.read()
        if len(content_bytes) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="TXT 文件超过 2 MB。请拆分文件后分别导入；分集分析上下文上限为约 80,000 字符。")
        if content_bytes.startswith((b"\xff\xd8\xff", b"\x89PNG", b"RIFF")):
            raise HTTPException(status_code=400, detail="请上传 TXT、Markdown 或 Fountain 文本文件，不能上传图片或视频")
        try:
            text = content_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = content_bytes.decode("utf-16")
            except UnicodeDecodeError:
                text = content_bytes.decode("gb18030", errors="replace")
        if not text.strip():
            raise HTTPException(status_code=400, detail="文件内容为空")

        llm = pipeline.script_processor.llm
        filename = file.filename or "import.txt"
        fingerprint = hashlib.sha256(json.dumps([
            "source-newlines-v2",
            hashlib.sha256(text.encode("utf-8")).hexdigest(),
            suggested_episodes,
            llm.provider,
            llm._get_default_model(),
        ], ensure_ascii=False).encode()).hexdigest()
        return extraction_jobs.start(
            user.owner_profile_id,
            "series-import",
            "series-import:" + fingerprint,
            lambda: _run_import_preview(
                user.owner_profile_id, filename, text, suggested_episodes
            ),
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("File import preview failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/series/import/preview-jobs/{job_id}")
def import_file_preview_status(
    job_id: str,
    user: UserContext = Depends(require_studio_user),
):
    return extraction_jobs.get(user.owner_profile_id, "series-import", job_id)


class ConfirmImportRequest(BaseModel):
    title: str
    description: str = ""
    import_id: str = ""
    text: Optional[str] = None
    episodes: List[Dict[str, Any]]  # episode_number, title, start_marker, end_marker, ...


@app.post("/series/import/confirm")
async def import_file_confirm(
    request: ConfirmImportRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Confirm the episode split and create Series + Episodes."""
    try:
        if not 1 <= len(request.episodes) <= 100:
            raise ValueError("确认导入集数应在 1-100 之间")
        # Prefer persistent owner-scoped source, then legacy memory cache,
        # and finally direct text for compatibility with older clients.
        text = None
        if request.import_id:
            text = _load_import_text(user.owner_profile_id, request.import_id)
            cached = pipeline._import_cache.get(request.import_id)
            if cached:
                cached_owner, cached_text = cached
                if cached_owner != user.owner_profile_id:
                    raise ValueError("Import preview not found")
                text = text or cached_text
        if not text:
            text = request.text
        if not text:
            raise ValueError("No text available. Provide import_id or text.")
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                pipeline.create_series_from_import,
                request.title,
                text,
                request.episodes,
                request.description,
                user.user_id,
                user.owner_profile_id,
            )
        )
        if request.import_id:
            _delete_import_text(user.owner_profile_id, request.import_id)
            pipeline._import_cache.pop(request.import_id, None)
            extraction_jobs.forget_result(
                user.owner_profile_id, "series-import", "import_id", request.import_id
            )
        return signed_response(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Import confirm failed")
        raise HTTPException(status_code=500, detail=str(e))


class EnvConfig(ProviderRoutingConfig):
    DASHSCOPE_API_KEY: Optional[str] = None
    ALIBABA_CLOUD_ACCESS_KEY_ID: Optional[str] = None
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: Optional[str] = None
    OSS_BUCKET_NAME: Optional[str] = None
    OSS_ENDPOINT: Optional[str] = None
    OSS_BASE_PATH: Optional[str] = None
    OSS_ENABLE: bool = True
    IFRAME_MEDIA_ROOT: Optional[str] = None
    IFRAME_STORAGE_BACKEND: Optional[Literal["local", "cos"]] = None
    PROVIDER_MEDIA_PUBLIC_BASE_URL: Optional[str] = None
    PROVIDER_MEDIA_URL_TTL_SECONDS: Optional[int] = Field(default=None, ge=1)
    UNIART_VIDEO_COS_BUCKET: Optional[str] = None
    UNIART_VIDEO_COS_REGION: Optional[str] = None
    UNIART_VIDEO_COS_DOMAIN: Optional[str] = None
    KLING_ACCESS_KEY: Optional[str] = None
    KLING_SECRET_KEY: Optional[str] = None
    VIDU_API_KEY: Optional[str] = None
    MULEROUTER_API_KEY: Optional[str] = None
    endpoint_overrides: Dict[str, str] = Field(default_factory=dict)


def _normalize_provider_mode(value: Optional[str]) -> str:
    normalized = (value or "").strip().lower()
    if normalized in (ProviderBackend.DASHSCOPE.value, ProviderBackend.VENDOR.value):
        return normalized
    return ProviderBackend.DASHSCOPE.value


def get_user_config_path() -> str:
    """
    Returns the path to the user config file.
    - Development mode: Uses .env in project root
    - Packaged app mode: Uses ~/.iframe/config.json
    """
    from ...utils import get_user_data_dir
    
    # Check if running in packaged mode (e.g., via environment variable or frozen check)
    is_packaged = os.getenv("LUMEN_X_PACKAGED", "false").lower() == "true" or getattr(sys, 'frozen', False)
    
    if is_packaged:
        # Use user home directory for packaged app
        config_dir = get_user_data_dir()
        os.makedirs(config_dir, exist_ok=True)
        return os.path.join(config_dir, "config.json")
    else:
        # Use .env in project root for development
        # Get absolute path to project root (api.py is in src/apps/comic_gen/)
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        return os.path.join(project_root, ".env")



def load_user_config():
    """Loads user config from file and applies to environment."""
    config_path = get_user_config_path()
    
    if config_path.endswith(".json"):
        # JSON config for packaged app
        if os.path.exists(config_path):
            try:
                import json
                with open(config_path, "r") as f:
                    config = json.load(f)
                for key, value in config.items():
                    if value:
                        os.environ[key] = value
            except Exception as e:
                logger.warning(f"Failed to load config from {config_path}: {e}")
    # .env is already loaded at startup via dotenv


def save_user_config(config_dict: dict):
    """Saves user config to file."""
    config_path = get_user_config_path()

    if config_path.endswith(".json"):
        # JSON config for packaged app
        import json
        existing_config = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    existing_config = json.load(f)
            except:
                pass
        existing_config.update(config_dict)
        with open(config_path, "w") as f:
            json.dump(existing_config, f, indent=2)
    else:
        # .env for development
        for key, value in config_dict.items():
            if value is not None:
                set_key(config_path, key, value)


def remove_user_config_keys(keys: list):
    """Removes keys from the persisted config file."""
    if not keys:
        return
    config_path = get_user_config_path()

    if config_path.endswith(".json"):
        import json
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    existing_config = json.load(f)
                for key in keys:
                    existing_config.pop(key, None)
                with open(config_path, "w") as f:
                    json.dump(existing_config, f, indent=2)
            except Exception as e:
                logger.warning(f"Failed to remove keys from config: {e}")
    else:
        from dotenv import unset_key
        for key in keys:
            try:
                unset_key(config_path, key)
            except Exception as e:
                logger.warning(f"Failed to unset key {key} from .env: {e}")


# Load user config on startup
import sys
load_user_config()



@app.get("/config/info")
def get_config_info():
    """Returns information about the current config storage mode."""
    config_path = get_user_config_path()
    is_packaged = os.getenv("LUMEN_X_PACKAGED", "false").lower() == "true" or getattr(sys, 'frozen', False)
    return {
        "mode": "packaged" if is_packaged else "development",
        "config_path": config_path,
        "config_exists": os.path.exists(config_path)
    }


@app.post("/config/env")
def update_env_config(
    config: EnvConfig,
    identity: UserContext = Depends(require_user_context),
    x_lumenx_admin_token: Optional[str] = Header(default=None),
):
    """Updates environment configuration and saves to config file."""
    del identity
    expected_admin_token = os.getenv("LUMENX_ADMIN_CONFIG_TOKEN")
    if (
        os.getenv("LUMENX_ENABLE_ADMIN_ENV_CONFIG", "false").lower() != "true"
        or not expected_admin_token
        or not x_lumenx_admin_token
        or not hmac.compare_digest(x_lumenx_admin_token, expected_admin_token)
    ):
        raise HTTPException(status_code=403, detail="Server environment configuration is disabled")
    try:
        raw_config = config.dict(exclude_unset=True)

        # Extract endpoint_overrides and flatten into config_dict
        endpoint_overrides = raw_config.pop("endpoint_overrides", {})

        # Filter out None values and serialize enum values as plain strings.
        config_dict: Dict[str, str] = {}
        for key, value in raw_config.items():
            if value is None:
                continue
            if isinstance(value, bool):
                # Booleans (e.g. OSS_ENABLE) persist as "true"/"false" strings so
                # they round-trip through os.environ and the .env/config.json store.
                config_dict[key] = "true" if value else "false"
            elif isinstance(value, ProviderBackend):
                config_dict[key] = value.value
            else:
                config_dict[key] = str(value)

        # Secret masking guard: GET /config/env returns secrets masked with the
        # bullet sentinel. If the frontend re-submits an unchanged secret it will
        # still contain bullets — skip it so we don't overwrite the real stored
        # key with the mask. Only genuinely edited (bullet-free) values persist.
        for field in list(config_dict.keys()):
            if field in SECRET_FIELDS and _MASK_CHAR in str(config_dict[field]):
                config_dict.pop(field, None)

        if "IFRAME_MEDIA_ROOT" in config_dict:
            configured_root = str(config_dict["IFRAME_MEDIA_ROOT"]).strip()
            if not configured_root:
                raise ValueError("IFRAME_MEDIA_ROOT must not be empty")
        if "IFRAME_STORAGE_BACKEND" in config_dict:
            configured_backend = str(config_dict["IFRAME_STORAGE_BACKEND"]).strip().lower()
            if configured_backend not in {"local", "cos"}:
                raise ValueError("IFRAME_STORAGE_BACKEND must be one of: local, cos")

        # Process endpoint overrides: validate keys against known providers
        from ...utils.endpoints import PROVIDER_DEFAULTS
        allowed_keys = {f"{p}_BASE_URL" for p in PROVIDER_DEFAULTS}
        keys_to_remove = []
        for env_key, value in endpoint_overrides.items():
            if env_key not in allowed_keys:
                logger.warning(f"Ignoring unknown endpoint key: {env_key}")
                continue
            if value and value.strip():
                config_dict[env_key] = value.strip()
            else:
                # Clear override: remove from env and config file
                os.environ.pop(env_key, None)
                keys_to_remove.append(env_key)

        # Update current process env
        restart_keys = {
            "IFRAME_MEDIA_ROOT", "IFRAME_STORAGE_BACKEND",
            "PROVIDER_MEDIA_PUBLIC_BASE_URL", "PROVIDER_MEDIA_URL_TTL_SECONDS",
        }
        # Persist startup settings without splitting existing Pipeline/Playground
        # instances across roots or changing upload policy mid-generation.
        for key, value in config_dict.items():
            if key not in restart_keys:
                os.environ[key] = value

        # Save to file
        save_user_config(config_dict)
        remove_user_config_keys(keys_to_remove)

        # Reset OSS singleton to pick up new config (non-blocking)
        try:
            OSSImageUploader.reset_instance()
            logger.info("OSS instance reset successfully")
        except Exception as oss_e:
            # OSS reset failure should not block config saving
            logger.warning(f"OSS reset failed (non-critical): {oss_e}")

        config_path = get_user_config_path()
        return {
            "status": "success",
            "message": f"Configuration saved to {config_path}",
            "restart_required": bool(restart_keys.intersection(config_dict)),
        }
    except Exception as e:
        logger.exception("Failed to save environment configuration")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/projects/{script_id}")
def get_project(script_id: str, user: UserContext = Depends(require_studio_user)):
    """Retrieves a project by ID. When the project belongs to a
    Series, the response merges series-shared characters / scenes /
    props on top of the episode-local lists. Each item carries a
    `source` field ("episode" | "series" | "global") so the frontend can
    visually distinguish where the asset lives and route writes
    appropriately (per A2 design decision — shared writes default to
    the series side; local writes stay episode-side; the helper
    `_find_asset_with_source` in pipeline routes mutations correctly).

    Response model dropped from `Script` because the `source` field
    is a presentation-layer concern (never persisted, derived from
    container membership at read time)."""
    # FastAPI supplies ``user`` for HTTP requests. Several mutation handlers
    # reuse this response builder directly, so resolve the active workspace
    # user when called internally instead of treating Depends as a context.
    resolved_user = user if isinstance(user, UserContext) else current_studio_user()
    script = (
        pipeline.get_script(script_id, resolved_user.owner_profile_id)
        if resolved_user
        else pipeline.get_script(script_id)
    )
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    payload = _script_response_dump(script)
    local_crowd_groups = list(payload.get("crowd_group_candidates", []))
    payload["crowd_groups"] = local_crowd_groups
    local_director = script.art_direction.director_profile if script.art_direction else None
    effective_style = pipeline.effective_art_direction(script)
    payload["director_style_review_required"] = bool(
        local_director and script.director_style_hash
        and script.director_style_hash != _director_style_hash(
            effective_style.style_config if effective_style else {}
        )
    )
    series_profile = pipeline.effective_series_director_profile(script.series_id) if script.series_id else None
    payload["series_director_review_required"] = bool(
        local_director and script.director_series_revision is not None
        and script.director_series_revision != (series_profile.revision if series_profile else None)
    )

    # Episode-local entries always carry source="episode".
    for asset_list in (payload.get("characters", []),
                      payload.get("scenes", []),
                      payload.get("props", [])):
        for item in asset_list:
            item["source"] = "episode"

    # Merge series-shared assets on top (any id not already present
    # locally — episode-local overrides series). Without this step
    # the user "loses" characters when switching between episodes of
    # the same series, because the series shared pool isn't
    # reflected on each episode's response.
    if script.series_id:
        series = pipeline.get_series(script.series_id)
        if series:
            # Series generation settings are the effective defaults for an
            # episode. A saved episode may still carry the model chosen when
            # it was created, so expose the current series choice to clients.
            payload["model_settings"] = series.model_settings.model_dump()
            ep_char_ids = {c.id for c in script.characters}
            ep_scene_ids = {s.id for s in script.scenes}
            ep_prop_ids = {p.id for p in script.props}
            for ch in series.characters:
                if ch.id not in ep_char_ids:
                    d = ch.model_dump(exclude={"asset_revisions"})
                    d["source"] = "series"
                    payload["characters"].append(d)
            for sc in series.scenes:
                if sc.id not in ep_scene_ids:
                    d = sc.model_dump(exclude={"asset_revisions"})
                    d["source"] = "series"
                    payload["scenes"].append(d)
            for pr in series.props:
                if pr.id not in ep_prop_ids:
                    d = pr.model_dump(exclude={"asset_revisions"})
                    d["source"] = "series"
                    payload["props"].append(d)
            known_crowd_ids = {item.get("extra_id") for item in local_crowd_groups}
            payload["crowd_groups"].extend(
                item.model_dump() for item in series.extra_roster
                if item.extra_id not in known_crowd_ids
            )

    # Global assets are intentionally opt-in. They enter a series only through
    # the explicit /series/{id}/assets/import-from-library action; merely
    # reading an episode must not make every global asset appear in it.
    _add_asset_cover_urls(payload, resolved_user.owner_profile_id if resolved_user else script.owner_profile_id or "")
    return signed_response(payload)


@app.get("/projects/{script_id}/asset-index")
def get_project_asset_index(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
    scope: Literal["available", "project"] = "available",
):
    """Separate project membership from broader workbench candidates."""
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return private_no_store_signed_response(pipeline.get_asset_reference_index(script_id, scope=scope))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/asset-index")
def get_asset_library_index(user: UserContext = Depends(require_studio_user)):
    """Return the normalized cross-series/project/global asset view."""
    return private_no_store_signed_response(pipeline.get_asset_library_reference_index(user.owner_profile_id))


@app.get("/asset-index/preview")
def get_asset_library_preview(
    scope: Literal["global", "series", "project"],
    asset_type: Literal["character", "scene", "prop"],
    asset_id: str,
    variant_id: str,
    container_id: str = "",
    user: UserContext = Depends(require_studio_user),
):
    """Serve a small cover for a variant visible in this owner's library."""
    if scope == "global":
        assets = pipeline._library_list_for_type(asset_type, user.owner_profile_id) if not container_id else []
    elif scope == "series":
        series = pipeline.get_series(container_id, user.owner_profile_id)
        assets = getattr(series, f"{asset_type}s", []) if series else []
    else:
        script = pipeline.get_script(container_id, user.owner_profile_id)
        assets = getattr(script, f"{asset_type}s", []) if script else []
    asset = next((item for item in assets if item.id == asset_id), None)
    variant = next((item for item in pipeline._asset_image_variants(asset, asset_type) if item.id == variant_id), None) if asset else None
    if variant is None:
        raise HTTPException(status_code=404, detail="Asset variant not found")

    raw = image_variant_storage_key(variant)
    if not raw:
        raise HTTPException(status_code=404, detail="Asset image not found")
    uploader = OSSImageUploader()
    remote = False
    if is_object_key(raw):
        source = uploader.sign_url_for_api(raw)
        remote = True
    elif raw.startswith(("http://", "https://")):
        managed_key = managed_object_key_from_url(raw, uploader)
        if not managed_key:
            raise HTTPException(status_code=422, detail="External image preview is unavailable")
        source = uploader.sign_url_for_api(managed_key)
        remote = True
    else:
        try:
            source = pipeline._resolve_stored_reference_value(raw, user.owner_profile_id)
        except InvalidAssetReference as exc:
            raise HTTPException(status_code=404, detail="Asset image not found") from exc
        if is_object_key(source):
            source = uploader.sign_url_for_api(source)
            remote = True
    if not source:
        raise HTTPException(status_code=503, detail="Asset image storage is unavailable")
    try:
        preview = create_asset_preview(
            source,
            studio_owner_dir(user.owner_profile_id, output_root=pipeline.output_root),
            f"{scope}:{container_id}:{asset_type}:{asset_id}:{variant_id}:{variant.created_at}:{raw}",
            remote=remote,
        )
    except (OSError, ValueError) as exc:
        logger.warning("Asset preview failed for %s: %s", variant_id, exc)
        raise HTTPException(status_code=415, detail="Asset image preview is unavailable") from exc
    return FileResponse(preview, media_type="image/webp", headers={
        "Cache-Control": "private, max-age=1800", "X-Content-Type-Options": "nosniff",
    })


def _owned_media_delivery_url(stored: str, owner_profile_id: str) -> str:
    """Resolve only managed local or object storage into a current browser URL."""
    from ..studio_access import studio_media_url

    active_backend = os.getenv("IFRAME_STORAGE_BACKEND")
    if active_backend == "local" and (
        stored.startswith(("http://", "https://")) or is_object_key(stored)
    ):
        raise HTTPException(status_code=404, detail="Media is outside the active local storage")
    uploader = OSSImageUploader()
    if stored.startswith(("http://", "https://")):
        stored = managed_object_key_from_url(stored, uploader)
        if not stored:
            raise HTTPException(status_code=422, detail="External media is not managed")
    if is_object_key(stored):
        url = uploader.sign_url_for_display(stored)
        if not url:
            raise HTTPException(status_code=503, detail="Media storage unavailable")
        return url
    try:
        source = pipeline._resolve_stored_reference_value(stored, owner_profile_id)
    except InvalidAssetReference as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if active_backend == "cos":
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    relative = os.path.relpath(source, pipeline.output_root)
    url = studio_media_url(owner_profile_id, relative, output_root=pipeline.output_root)
    if url == relative:
        raise HTTPException(status_code=404, detail="Media not found")
    return url


def _owned_media_cover_url(stored: str, owner_profile_id: str, preview: int) -> str:
    from ..studio_access import studio_media_preview_url
    from ...utils.media_thumbnails import PREVIEW_MAX_EDGES

    if preview not in PREVIEW_MAX_EDGES:
        raise HTTPException(status_code=422, detail="Unsupported media preview size")
    active_backend = os.getenv("IFRAME_STORAGE_BACKEND")
    if active_backend == "local" and (
        stored.startswith(("http://", "https://")) or is_object_key(stored)
    ):
        raise HTTPException(status_code=404, detail="Media is outside the active local storage")
    uploader = OSSImageUploader()
    if stored.startswith(("http://", "https://")):
        stored = managed_object_key_from_url(stored, uploader)
        if not stored:
            raise HTTPException(status_code=422, detail="External media is not managed")
    if is_object_key(stored):
        if not is_cos_configured():
            raise HTTPException(status_code=422, detail="Cloud media cover is unavailable")
        owner_root = studio_owner_dir(owner_profile_id, output_root=pipeline.output_root)
        try:
            cover = create_cos_media_preview(uploader, stored, owner_root, preview)
        except ValueError as exc:
            raise HTTPException(status_code=415, detail="COS media preview is unavailable") from exc
        except Exception as exc:
            status = exc.get_status_code() if callable(getattr(exc, "get_status_code", None)) else None
            if status == 404:
                raise HTTPException(status_code=404, detail="COS media not found") from exc
            if status == 412:
                raise HTTPException(status_code=409, detail="COS media changed; retry preview") from exc
            logger.warning("COS media preview failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="COS media preview is unavailable") from exc
        relative = os.path.relpath(cover, owner_root).replace(os.sep, "/")
        return f"/studio/owned-media/{studio_owner_key(owner_profile_id)}/{relative}"
    try:
        source = pipeline._resolve_stored_reference_value(stored, owner_profile_id)
    except InvalidAssetReference as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    if active_backend == "cos":
        raise HTTPException(status_code=404, detail="Local media is outside the active COS storage")
    relative = os.path.relpath(source, pipeline.output_root)
    url = studio_media_preview_url(owner_profile_id, relative, preview)
    if url == relative:
        raise HTTPException(status_code=404, detail="Media not found")
    return url


@app.get("/asset-index/delivery")
def get_asset_library_delivery(
    scope: Literal["global", "series", "project"],
    asset_type: Literal["character", "scene", "prop"],
    asset_id: str,
    variant_id: str,
    container_id: str = "",
    user: UserContext = Depends(require_studio_user),
):
    """Resolve a current source URL from an owned asset variant identity."""
    if scope == "global":
        assets = pipeline._library_list_for_type(asset_type, user.owner_profile_id) if not container_id else []
    elif scope == "series":
        series = pipeline.get_series(container_id, user.owner_profile_id)
        assets = getattr(series, f"{asset_type}s", []) if series else []
    else:
        script = pipeline.get_script(container_id, user.owner_profile_id)
        assets = getattr(script, f"{asset_type}s", []) if script else []
    asset = next((item for item in assets if item.id == asset_id), None)
    variant = next((item for item in pipeline._asset_image_variants(asset, asset_type) if item.id == variant_id), None) if asset else None
    if variant is None:
        raise HTTPException(status_code=404, detail="Asset variant not found")
    raw = image_variant_storage_key(variant)
    if not raw:
        raise HTTPException(status_code=404, detail="Asset image not found")
    return JSONResponse({"url": _owned_media_delivery_url(raw, user.owner_profile_id)},
                        headers={"Cache-Control": "private, no-store"})


@app.get("/studio/media-records/{media_id}/delivery")
def get_registered_media_delivery(
    media_id: str,
    preview: int = 0,
    user: UserContext = Depends(require_studio_user),
):
    """Resolve a current source URL from an owner-scoped media registry ID."""
    from ..media_registry import get_media
    record = get_media(user.owner_profile_id, media_id, output_root=pipeline.output_root)
    if not record:
        raise HTTPException(status_code=404, detail="Media not found")
    if preview:
        return JSONResponse({"url": _owned_media_cover_url(record["storage_key"], user.owner_profile_id, preview), "media_type": "image/webp"},
                            headers={"Cache-Control": "private, no-store"})
    return JSONResponse({"url": _owned_media_delivery_url(record["storage_key"], user.owner_profile_id)},
                        headers={"Cache-Control": "private, no-store"})


@app.get("/projects/{script_id}/video_tasks/{task_id}/delivery")
def get_video_task_delivery(script_id: str, task_id: str, preview: int = 0, user: UserContext = Depends(require_studio_user)):
    """Refresh a shot take from its project and task identity, including old tasks without media IDs."""
    script = pipeline.get_script(script_id, user.owner_profile_id)
    task = next((item for item in script.video_tasks if item.id == task_id), None) if script else None
    if not task or task.status != "completed" or not task.video_url:
        raise HTTPException(status_code=404, detail="Video task not found")
    url = (_owned_media_cover_url(task.video_url, user.owner_profile_id, preview) if preview
           else _owned_media_delivery_url(task.video_url, user.owner_profile_id))
    return JSONResponse({"url": url, "media_type": "image/webp" if preview else None},
                        headers={"Cache-Control": "private, no-store"})


@app.get("/projects/{script_id}/merged-video/delivery")
def get_merged_video_delivery(script_id: str, preview: int = 0, user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script or not script.merged_video_url:
        raise HTTPException(status_code=404, detail="Merged video not found")
    url = (_owned_media_cover_url(script.merged_video_url, user.owner_profile_id, preview) if preview
           else _owned_media_delivery_url(script.merged_video_url, user.owner_profile_id))
    return JSONResponse({"url": url, "media_type": "image/webp" if preview else None},
                        headers={"Cache-Control": "private, no-store"})


@app.get("/projects/{script_id}/assembly-plan")
def get_project_assembly_plan(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Return the project Assembly plan, or null for the legacy flow."""
    try:
        if not pipeline.get_script(script_id, user.owner_profile_id):
            raise HTTPException(status_code=404, detail="Project not found")
        return signed_response(pipeline.get_assembly_plan("project", script_id))
    except AssemblyPlanValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/projects/{script_id}/assembly-plan")
def put_project_assembly_plan(
    script_id: str,
    payload: Union[AssemblyEditPlan, AssemblyPlanEnvelope],
    user: UserContext = Depends(require_studio_user),
):
    """Persist a validated project Assembly plan without submitting Motion."""
    plan = payload.plan if isinstance(payload, AssemblyPlanEnvelope) else payload
    expected_revision = (
        payload.expected_revision
        if isinstance(payload, AssemblyPlanEnvelope)
        else plan.revision
    )
    try:
        saved = pipeline.save_assembly_plan(
            "project",
            script_id,
            plan,
            expected_revision=expected_revision,
        )
        return signed_response(saved)
    except AssemblyPlanConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
            },
        )
    except AssemblyPlanValidationError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/projects/{script_id}/assembly-plan/render")
def render_project_assembly_plan(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Explicitly compile the saved project Assembly plan."""
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        rendered = pipeline.render_assembly_plan(
            "project",
            script_id,
            user.owner_profile_id,
        )
        return signed_response({"url": rendered.merged_video_url})
    except AssemblyPlanConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "current_revision": exc.current_revision,
            },
        )
    except AssemblyPlanValidationError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))



@app.delete("/projects/{script_id}")
def delete_project(script_id: str):
    """Deletes a project by ID. WARNING: This permanently removes the project from backend storage."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    
    try:
        # If project belongs to a Series, remove from episode_ids
        if script.series_id:
            series = pipeline.get_series(script.series_id)
            if series and script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
                pipeline._save_series_data()

        # Remove from pipeline scripts
        del pipeline.scripts[script_id]
        pipeline._save_data()
        return {"status": "deleted", "id": script_id, "title": script.title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────
# R2V v2 Phase 4 — Cross-episode asset reconcile
# ─────────────────────────────────────────────────────────────────────
def _name_match_confidence(local_name: str, series_name: str) -> int:
    """0-100 simple confidence score.
    Phase 4 v1: exact match = 100, substring match = 75, none = 0.
    Future: embedding-based semantic similarity on `description`."""
    a, b = (local_name or "").strip().lower(), (series_name or "").strip().lower()
    if not a or not b:
        return 0
    if a == b:
        return 100
    if a in b or b in a:
        return 75
    return 0


@app.get("/projects/{script_id}/reconcile/suggestions")
def reconcile_suggestions(script_id: str):
    """Compute match suggestions for the current episode's just-extracted
    entities vs the parent series's shared asset library.

    Returned shape:
    {
      "characters": [
        { local_id, local_name, suggested_series_id|null, suggested_series_name|null, confidence }
      ],
      "scenes": [...],
      "props": [...],
    }
    Frontend uses this to render the ReconcileModal after script parse.
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    if not script.series_id:
        # Standalone projects have no series library to reconcile against
        return {"characters": [], "crowd_groups": [], "scenes": [], "props": []}
    series = pipeline.get_series(script.series_id)
    if not series:
        return {"characters": [], "crowd_groups": [], "scenes": [], "props": []}

    def best_match(local_name: str, pool: list, key: str = "name", id_key: str = "id"):
        best_id, best_name, best_conf = None, None, 0
        for item in pool:
            sname = getattr(item, key, "") if hasattr(item, key) else item.get(key, "")
            conf = _name_match_confidence(local_name, sname)
            if conf > best_conf:
                best_id, best_name, best_conf = getattr(item, id_key) if hasattr(item, id_key) else item.get(id_key), sname, conf
        return best_id, best_name, best_conf

    def build(local_pool, series_pool, name_key="name", id_key="id", match_kind=False):
        result = []
        for local in local_pool:
            candidates = [item for item in series_pool if item.kind == local.kind] if match_kind else series_pool
            sid, sname, conf = best_match(getattr(local, name_key), candidates, name_key, id_key)
            result.append({
                "local_id": getattr(local, id_key),
                "local_name": getattr(local, name_key),
                "suggested_series_id": sid if conf > 0 else None,
                "suggested_series_name": sname if conf > 0 else None,
                "confidence": conf,
            })
        return result

    return {
        "characters": build(script.characters, series.characters),
        "crowd_groups": build(script.crowd_group_candidates, series.extra_roster, "label", "extra_id", True),
        "scenes": build(script.scenes, series.scenes),
        "props": build(script.props, series.props),
    }


class ReconcileAction(BaseModel):
    local_id: str
    action: str  # "merge_into_series" | "create_new_in_series" | "skip"
    target_series_id: Optional[str] = None


class ApplyReconcileRequest(BaseModel):
    characters: List[ReconcileAction] = Field(default_factory=list)
    crowd_groups: List[ReconcileAction] = Field(default_factory=list)
    scenes: List[ReconcileAction] = Field(default_factory=list)
    props: List[ReconcileAction] = Field(default_factory=list)


@app.post("/projects/{script_id}/reconcile/apply")
def reconcile_apply(script_id: str, request: ApplyReconcileRequest):
    """Apply user-confirmed reconcile decisions.
    - merge_into_series: drop the local episode entity, replace all
      frame references with target_series_id (the series-shared asset).
    - create_new_in_series: promote the local entity to series scope.
    - skip: no-op (keep local-only).
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    if not script.series_id:
        raise HTTPException(status_code=400, detail="Project not in a series")
    series = pipeline.get_series(script.series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    local_groups = {item.extra_id: item for item in script.crowd_group_candidates}
    series_groups = {item.extra_id: item for item in series.extra_roster}
    for act in request.crowd_groups:
        local = local_groups.get(act.local_id)
        if local is None:
            continue
        if act.action == "merge_into_series":
            target = series_groups.get(act.target_series_id)
            if target is None or target.kind != local.kind:
                raise HTTPException(status_code=400, detail="Crowd merge target is missing or has a different kind")
        elif act.action == "create_new_in_series" and local.extra_id in series_groups:
            raise HTTPException(status_code=400, detail="Crowd group ID already exists in series")
    new_group_ids = {act.local_id for act in request.crowd_groups
                     if act.action == "create_new_in_series" and act.local_id in local_groups}
    if len(series.extra_roster) + len(new_group_ids) > 100:
        raise HTTPException(status_code=400, detail="Series extra roster exceeds 100 entries")

    def apply_list(local_pool_attr: str, series_pool_attr: str, actions: list, frame_ref_attr: Optional[str] = None):
        local_pool = getattr(script, local_pool_attr)
        series_pool = getattr(series, series_pool_attr)
        for act in actions:
            local_item = next((x for x in local_pool if x.id == act.local_id), None)
            if not local_item:
                continue
            if act.action == "create_new_in_series":
                # Promote: copy to series pool, drop from local
                series_pool.append(local_item)
                local_pool.remove(local_item)
            elif act.action == "merge_into_series" and act.target_series_id:
                # Rewire frame references then drop local
                if frame_ref_attr:
                    for frame in script.frames:
                        if frame_ref_attr == "scene_id":
                            if frame.scene_id == local_item.id:
                                frame.scene_id = act.target_series_id
                        elif frame_ref_attr == "character_ids":
                            frame.character_ids = [
                                act.target_series_id if cid == local_item.id else cid
                                for cid in frame.character_ids
                            ]
                        elif frame_ref_attr == "prop_ids":
                            frame.prop_ids = [
                                act.target_series_id if pid == local_item.id else pid
                                for pid in frame.prop_ids
                            ]
                local_pool.remove(local_item)
            # skip: do nothing
        setattr(script, local_pool_attr, local_pool)
        setattr(series, series_pool_attr, series_pool)

    apply_list("characters", "characters", request.characters, "character_ids")
    apply_list("scenes", "scenes", request.scenes, "scene_id")
    apply_list("props", "props", request.props, "prop_ids")
    for act in request.crowd_groups:
        local = local_groups.get(act.local_id)
        if local is None or local not in script.crowd_group_candidates:
            continue
        if act.action == "create_new_in_series":
            series.extra_roster.append(local)
            script.crowd_group_candidates.remove(local)
        elif act.action == "merge_into_series":
            for frame in script.frames:
                for instance in frame.crowd_instances:
                    if instance.extra_id == local.extra_id:
                        instance.extra_id = act.target_series_id
                    if instance.template_id == local.extra_id:
                        instance.template_id = act.target_series_id
            script.crowd_group_candidates.remove(local)

    script.updated_at = time.time()
    series.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline.series_store[series.id] = series
    pipeline._save_data()
    pipeline._save_series_data()
    return signed_response(script)


# ─────────────────────────────────────────────────────────────────────
# R2V v2 Phase 3 — "Previously on..." (上回书说到)
# ─────────────────────────────────────────────────────────────────────
def _prev_text_revision(prev_text: str) -> str:
    """Cheap revision marker for cache invalidation.
    Hash + length is sufficient — collisions don't matter, we only
    detect "did the script change since cache was built"."""
    import hashlib
    h = hashlib.md5(prev_text.encode("utf-8")).hexdigest()[:12]
    return f"{len(prev_text)}-{h}"


@app.get("/projects/{script_id}/previous_episode")
def get_previous_episode_summary(script_id: str):
    """Return previous-episode raw snippet + AI summary cache state for
    the "Previously on..." right rail in the Script step.

    Response shape:
        {
          "has_previous": bool,
          "previous_episode_id": str | null,
          "previous_episode_title": str | null,
          "raw_snippet": str  (last ~600 chars of previous original_text),
          "ai_summary": str | null  (cached summary if fresh),
          "ai_summary_stale": bool  (true when prev text changed since cache),
        }
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    if not script.series_id:
        return {
            "has_previous": False,
            "previous_episode_id": None,
            "previous_episode_title": None,
            "raw_snippet": "",
            "ai_summary": None,
            "ai_summary_stale": False,
        }
    series = pipeline.get_series(script.series_id)
    if not series:
        return {
            "has_previous": False,
            "previous_episode_id": None,
            "previous_episode_title": None,
            "raw_snippet": "",
            "ai_summary": None,
            "ai_summary_stale": False,
        }
    # Find previous episode by ordered episode_ids — fall back to
    # episode_number ordering when episode_ids is malformed.
    try:
        idx = series.episode_ids.index(script_id)
    except ValueError:
        idx = -1
    if idx <= 0:
        # No previous episode (this IS the first or the id is missing)
        return {
            "has_previous": False,
            "previous_episode_id": None,
            "previous_episode_title": None,
            "raw_snippet": "",
            "ai_summary": None,
            "ai_summary_stale": False,
        }
    prev_id = series.episode_ids[idx - 1]
    prev = pipeline.get_script(prev_id)
    if not prev or not (prev.original_text or "").strip():
        return {
            "has_previous": False,
            "previous_episode_id": prev_id,
            "previous_episode_title": prev.title if prev else None,
            "raw_snippet": "",
            "ai_summary": None,
            "ai_summary_stale": False,
        }
    raw_snippet = (prev.original_text or "")[-800:]
    current_rev = _prev_text_revision(prev.original_text or "")
    is_stale = (
        script.last_episode_summary_cache is not None
        and script.last_episode_summary_revision != current_rev
    )
    # R2V v2 P2-a — last frames of previous episode for Storyboard
    # cross-step reference. We surface the *last 4 frames* with their
    # selected video / T2I image so authors composing this episode's
    # opening shots can see what the previous episode ended on.
    last_frames = []
    for f in (prev.frames or [])[-4:]:
        thumb_url = None
        # Prefer the selected video's poster/url, fall back to T2I image
        if getattr(f, "video_url", None):
            thumb_url = f.video_url
        elif getattr(f, "rendered_image_url", None):
            thumb_url = f.rendered_image_url
        elif getattr(f, "image_url", None):
            thumb_url = f.image_url
        elif getattr(f, "t2i_image_urls", None):
            urls = f.t2i_image_urls
            if urls:
                idx = getattr(f, "t2i_selected_index", 0) or 0
                idx = max(0, min(idx, len(urls) - 1))
                thumb_url = urls[idx]
        last_frames.append({
            "id": f.id,
            "action_description": (f.action_description or "")[:120],
            "thumbnail_url": thumb_url,
            "video_url": getattr(f, "video_url", None),
        })
    return {
        "has_previous": True,
        "previous_episode_id": prev_id,
        "previous_episode_title": prev.title,
        "raw_snippet": raw_snippet,
        "ai_summary": script.last_episode_summary_cache,
        "ai_summary_stale": is_stale,
        "last_frames": last_frames,
    }


@app.post("/projects/{script_id}/previous_episode/summary")
def generate_previous_episode_summary(script_id: str):
    """On-demand AI summary of the previous episode (qwen3.6-plus).
    Per Q7-followup design: this is *user-triggered*, not auto, to
    respect LLM quota and user intent. Result is cached on the current
    episode's Script record with a revision marker for invalidation.
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    if not script.series_id:
        raise HTTPException(status_code=400, detail="Episode not in a series")
    series = pipeline.get_series(script.series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    try:
        idx = series.episode_ids.index(script_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Episode not registered in series order")
    if idx <= 0:
        raise HTTPException(status_code=400, detail="No previous episode")
    prev = pipeline.get_script(series.episode_ids[idx - 1])
    if not prev or not (prev.original_text or "").strip():
        raise HTTPException(status_code=400, detail="Previous episode has no script")

    # Call LLM — keep prompt simple and bilingual-friendly
    from .llm_adapter import LLMAdapter
    prompt = (
        "请用 150-220 字概括下面这段剧本的核心情节、关键角色出场与结尾留下的悬念/钩子。"
        "不要列点，写成一段连贯的中文叙述，便于作者快速回顾上一集走到了哪里。\n\n"
        f"剧本：\n{prev.original_text}"
    )
    try:
        adapter = LLMAdapter()
        summary = adapter.chat(
            messages=[{"role": "user", "content": prompt}],
            model=None,  # use adapter default (qwen3.6-plus with fallback chain)
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    summary = (summary or "").strip()
    if not summary:
        raise HTTPException(status_code=502, detail="Empty summary from LLM")

    # Persist cache + revision marker on current script
    script.last_episode_summary_cache = summary
    script.last_episode_summary_revision = _prev_text_revision(prev.original_text or "")
    script.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline._save_data()
    return {
        "ai_summary": summary,
        "ai_summary_stale": False,
        "previous_episode_id": prev.id,
        "previous_episode_title": prev.title,
    }


@app.get("/series/{series_id}/characters/{character_id}/appearances")
def get_character_appearances(series_id: str, character_id: str):
    """R2V v2 P1-c — Cross-episode character appearance summary.
    Used by Script step's @mention helper popover. Returns chronological
    list of episodes where the character appears + per-episode frame
    count + aggregated 'last seen' info."""
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    char = next((c for c in series.characters if c.id == character_id), None)
    if not char:
        # Try as episode-local character — maybe id is from any episode
        for ep_id in series.episode_ids:
            ep = pipeline.get_script(ep_id)
            if ep:
                local = next((c for c in ep.characters if c.id == character_id), None)
                if local:
                    char = local
                    break
    if not char:
        raise HTTPException(status_code=404, detail="Character not found in series scope")
    appearances = []
    total_frames = 0
    for ep_id in series.episode_ids:
        ep = pipeline.get_script(ep_id)
        if not ep:
            continue
        count = sum(1 for f in ep.frames if character_id in (f.character_ids or []))
        if count > 0:
            appearances.append({
                "episode_id": ep_id,
                "episode_number": ep.episode_number,
                "episode_title": ep.title,
                "frame_count": count,
            })
            total_frames += count
    return {
        "character": {
            "id": char.id,
            "name": char.name,
            "persona": char.persona,
            "description": char.description,
        },
        "appearances": appearances,
        "total_frames": total_frames,
    }


# R2V v2 P2-b — "Next episode hook" prediction (forward-looking).
@app.get("/projects/{script_id}/next_hook")
def get_next_episode_hook(script_id: str):
    """Return cached hook prediction state for the Script step's
    'Hook for next' panel. Always returns the current revision marker
    so the frontend can decide if a refresh is warranted."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    current_text = script.original_text or ""
    current_rev = _prev_text_revision(current_text)
    is_stale = (
        script.next_hook_cache is not None
        and script.next_hook_revision != current_rev
    )
    return {
        "has_text": bool(current_text.strip()),
        "hook": script.next_hook_cache,
        "stale": is_stale,
    }


@app.post("/projects/{script_id}/next_hook")
def generate_next_episode_hook(script_id: str):
    """On-demand AI prediction of the next-episode opening hook based
    on THIS episode's ending. User-triggered (no auto-generate to
    respect LLM quota)."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    text = script.original_text or ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Episode has no script text yet")

    from .llm_adapter import LLMAdapter
    # Use last ~1500 chars as context (the ending matters most for hooks)
    ending = text[-1500:]
    prompt = (
        "下面是一集剧本的结尾。请你站在编剧的视角，预测下一集开头可能的 hook，"
        "用 120-180 字给出 2-3 个具体方向（包括场景、角色出场、悬念点）。"
        "不要列点编号，写成连贯的中文段落，便于作者参考。\n\n"
        f"本集结尾：\n{ending}"
    )
    try:
        adapter = LLMAdapter()
        hook = adapter.chat(
            messages=[{"role": "user", "content": prompt}],
            model=None,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    hook = (hook or "").strip()
    if not hook:
        raise HTTPException(status_code=502, detail="Empty hook from LLM")

    script.next_hook_cache = hook
    script.next_hook_revision = _prev_text_revision(text)
    script.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline._save_data()
    return {"hook": hook, "stale": False}


@app.put("/projects/{script_id}/next_hook")
def update_next_episode_hook(script_id: str, payload: dict):
    """Manually edit / clear the next-hook cache."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    hook = payload.get("hook")
    if hook is None:
        script.next_hook_cache = None
        script.next_hook_revision = None
    else:
        script.next_hook_cache = str(hook).strip()
        script.next_hook_revision = _prev_text_revision(script.original_text or "")
    script.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline._save_data()
    return {"hook": script.next_hook_cache, "stale": False}


@app.post("/projects/{script_id}/sync_descriptions", response_model=Script)
def sync_descriptions(script_id: str):
    """
    Syncs entity descriptions from Script module to Assets module.
    
    This endpoint forces a refresh of the project data, ensuring that any
    description changes made in the Script module are reflected in Assets.
    
    Note: This only syncs descriptions; generated images/videos are preserved.
    """
    try:
        pipeline.sync_descriptions_from_script_entities(script_id)
        # Project reads add series/global assets as a presentation layer. The
        # sync response must use that same merged view; returning the raw
        # episode Script would make the frontend replace shared assets with
        # empty local arrays.
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AddCharacterRequest(BaseModel):
    name: str
    description: str

@app.post("/projects/{script_id}/characters", response_model=Script)
def add_character(script_id: str, request: AddCharacterRequest):
    """Adds a new character."""
    try:
        updated_script = pipeline.add_character(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/projects/{script_id}/characters/{char_id}", response_model=Script)
def delete_character(script_id: str, char_id: str):
    """Deletes a character."""
    try:
        updated_script = pipeline.delete_character(script_id, char_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class AddSceneRequest(BaseModel):
    name: str
    description: str

@app.post("/projects/{script_id}/scenes", response_model=Script)
def add_scene(script_id: str, request: AddSceneRequest):
    """Adds a new scene."""
    try:
        updated_script = pipeline.add_scene(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/projects/{script_id}/scenes/{scene_id}", response_model=Script)
def delete_scene(script_id: str, scene_id: str):
    """Deletes a scene."""
    try:
        updated_script = pipeline.delete_scene(script_id, scene_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UpdateStyleRequest(BaseModel):
    style_preset: str
    style_prompt: Optional[str] = None


@app.patch("/projects/{script_id}/style", response_model=Script)
def update_project_style(script_id: str, request: UpdateStyleRequest):
    """Updates the global style settings for a project."""
    try:
        updated_script = pipeline.update_project_style(
            script_id,
            request.style_preset,
            request.style_prompt
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/generate_assets", response_model=Script)
def generate_assets(script_id: str, background_tasks: BackgroundTasks):
    """Legacy batch endpoint cannot review a separate prompt for each asset."""
    raise HTTPException(status_code=422, detail="Batch asset generation requires reviewed prompts for each asset; use an asset workbench")



class GenerateMotionRefRequest(BaseModel):
    """Request model for generating Motion Reference videos."""
    asset_id: str
    asset_type: str  # 'full_body' | 'head_shot' for characters; 'scene' | 'prop' for scenes and props
    prompt: Optional[str] = None
    audio_url: Optional[str] = None  # Driving audio for lip-sync
    duration: int = 5
    batch_size: int = 1


@app.post("/projects/{script_id}/assets/generate_motion_ref")
def generate_motion_ref(script_id: str, request: GenerateMotionRefRequest, background_tasks: BackgroundTasks):
    """Generates a Motion Reference video for an asset (Character Full Body/Headshot, Scene, or Prop)."""
    try:
        script, task_id = pipeline.create_motion_ref_task(
            script_id=script_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            prompt=request.prompt,
            audio_url=request.audio_url,
            duration=request.duration,
            batch_size=request.batch_size
        )
        
        # Add background processing
        background_tasks.add_task(pipeline.process_motion_ref_task, script_id, task_id)
        
        # Return script with task_id for frontend polling
        response_data = script.model_dump() if hasattr(script, 'model_dump') else script.dict()
        response_data["_task_id"] = task_id
        return signed_response(response_data)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === STORYBOARD DRAMATIZATION v2 ===

class AnalyzeToStoryboardRequest(BaseModel):
    """Request to analyze script text into storyboard frames."""
    text: str
    mode: Literal["auto", "plan", "script"] = "auto"
    skills: List[director_skills.SkillSelection] = Field(default_factory=list, max_length=12)


class StoryboardAnalysisRefineRequest(BaseModel):
    text: str
    draft: List[Dict[str, Any]] = Field(min_length=1, max_length=200)
    instructions: List[str] = Field(min_length=1, max_length=12)
    lineage: Optional[ArtifactLineage] = None


class StoryboardAnalysisApplyRequest(BaseModel):
    text: str
    draft: List[Dict[str, Any]] = Field(min_length=1, max_length=200)
    lineage: Optional[ArtifactLineage] = None


def _storyboard_analysis_fingerprint(script_id: str, text: str,
                                     draft=None, instructions=None,
                                     lineage: Optional[ArtifactLineage] = None) -> str:
    script, entities, prompt = pipeline.storyboard_analysis_context(
        script_id, include_plan=not (lineage and lineage.storyboard_mode == "script"),
    )
    resolve_director = getattr(pipeline, "effective_director_profile", None)
    director_profile = resolve_director(script) if resolve_director else None
    visual_style = pipeline.storyboard_visual_style(script)
    llm = pipeline.script_processor.llm
    resolver = getattr(pipeline, "get_effective_polish_model", None)
    selected_model = resolver(script) if callable(resolver) else ""
    return hashlib.sha256(json.dumps([
        text,
        entities,
        draft,
        instructions,
        prompt,
        director_profile.model_dump() if director_profile else None,
        lineage.model_dump() if lineage else None,
        visual_style,
        llm.provider,
        selected_model or llm._get_default_model(),
    ], ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@app.post("/projects/{script_id}/storyboard-analysis-jobs", status_code=202)
def start_storyboard_analysis(
    script_id: str,
    request: AnalyzeToStoryboardRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Create or resume a durable storyboard draft without replacing frames."""
    if not request.text.strip():
        raise HTTPException(422, "Script text is required")
    try:
        skill_snapshot = director_skills.freeze("storyboard", request.skills)
        lineage = pipeline.storyboard_workflow_lineage(script_id, request.text, request.mode, skill_snapshot)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    fingerprint = _storyboard_analysis_fingerprint(
        script_id, request.text, lineage=lineage,
    )
    selected_model = pipeline.get_effective_polish_model(pipeline.get_script(script_id))
    job_fingerprint = "storyboard:" + fingerprint
    from .llm import split_director_source
    total_batches = len(split_director_source(
        request.text, direct_max_chars=1800, target_chars=1600, max_chars=1800
    )) if lineage.storyboard_mode != "plan" and len(request.text) > 1800 else 0
    return extraction_jobs.start(
        user.owner_profile_id,
        script_id,
        job_fingerprint,
        lambda job_id: {
            "frames": pipeline.preview_storyboard_analysis(
                script_id, request.text,
                load_batches=lambda: extraction_jobs.load_batches(
                    user.owner_profile_id, script_id, job_fingerprint
                ),
                save_batch=lambda index, source_ref, frames: extraction_jobs.save_batch(
                    user.owner_profile_id, script_id, job_fingerprint, job_id,
                    index, source_ref, frames,
                ),
                expected_lineage=lineage,
                model=selected_model,
                skill_snapshot=skill_snapshot,
            ),
            "lineage": lineage.model_dump(),
        },
        pass_job_id=True,
        total_batches=total_batches,
    )


@app.post("/projects/{script_id}/storyboard-analysis-jobs/refine", status_code=202)
def start_storyboard_analysis_refinement(
    script_id: str,
    request: StoryboardAnalysisRefineRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Revise a storyboard draft without replacing persisted frames."""
    instructions = [item.strip() for item in request.instructions if item.strip()]
    if not instructions or any(len(item) > 2000 for item in instructions):
        raise HTTPException(422, "Revision instructions must contain 1-12 non-empty items of at most 2000 characters")
    if request.lineage and request.lineage.status == "pinned":
        try:
            pipeline.validate_storyboard_lineage(script_id, request.text, request.lineage)
        except StaleStoryboardDraftError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        lineage = request.lineage.model_copy(deep=True)
    else:
        lineage = ArtifactLineage(status="legacy_unpinned")
    try:
        snapshot = director_skills.freeze("storyboard", [
            {"id": item["id"], "revision": item["revision"]} for item in lineage.creative_skill_run
        ])
        pipeline.validate_storyboard_coverage(script_id, request.draft, lineage)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    fingerprint = _storyboard_analysis_fingerprint(
        script_id, request.text, request.draft, instructions, lineage,
    )
    selected_model = pipeline.get_effective_polish_model(pipeline.get_script(script_id))
    return extraction_jobs.start(
        user.owner_profile_id,
        script_id,
        "storyboard:" + fingerprint,
        lambda: {
            "frames": pipeline.refine_storyboard_analysis(
                script_id, request.text, request.draft, instructions,
                lineage=lineage,
                model=selected_model,
                skill_snapshot=snapshot,
            ),
            "lineage": lineage.model_dump(),
        },
    )


@app.get("/projects/{script_id}/storyboard-analysis-jobs/{job_id}")
def storyboard_analysis_status(
    script_id: str,
    job_id: str,
    user: UserContext = Depends(require_studio_user),
):
    return extraction_jobs.get(user.owner_profile_id, script_id, job_id)


@app.post("/projects/{script_id}/storyboard-analysis/apply", response_model=Script)
def apply_storyboard_analysis(
    script_id: str,
    request: StoryboardAnalysisApplyRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Replace frames with the exact storyboard draft reviewed by the user."""
    del user  # Ownership is enforced by the studio request boundary.
    try:
        return signed_response(
            pipeline.analyze_text_to_frames(
                script_id, request.text, request.draft, request.lineage,
            )
        )
    except StaleStoryboardDraftError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("Error applying storyboard analysis: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/projects/{script_id}/storyboard/analyze")
def analyze_to_storyboard(script_id: str, request: AnalyzeToStoryboardRequest):
    """
    Analyzes script text and generates storyboard frames using AI (Prompt B).
    Replaces existing frames with newly generated ones.
    """
    try:
        snapshot = director_skills.freeze("storyboard", request.skills)
        lineage = pipeline.storyboard_workflow_lineage(script_id, request.text, request.mode, snapshot)
        draft = pipeline.preview_storyboard_analysis(script_id, request.text, expected_lineage=lineage, skill_snapshot=snapshot)
        updated_script = pipeline.analyze_text_to_frames(script_id, request.text, draft, lineage)
        return signed_response(updated_script)
    except StaleStoryboardDraftError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error in analyze_to_storyboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class RefinePromptRequest(BaseModel):
    """Request to refine a frame's prompt using AI."""
    frame_id: str
    raw_prompt: str
    assets: list = []  # List of asset references
    feedback: str = Field("", max_length=2000)  # User feedback for iterative refinement
    reviewed_message: Optional[str] = None
    context_token: Optional[str] = None


@app.post("/projects/{script_id}/storyboard/refine-preview")
def preview_storyboard_polish(script_id: str, request: RefinePromptRequest,
                              user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return pipeline.preview_frame_polish_input(
            script_id, request.frame_id, request.raw_prompt, request.assets, request.feedback,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/projects/{script_id}/storyboard/refine_prompt")
def refine_storyboard_prompt(script_id: str, request: RefinePromptRequest,
                             user: UserContext = Depends(require_studio_user)):
    """
    Refines a raw prompt into bilingual (CN/EN) prompts using AI (Prompt C).
    Returns a persistent candidate. The frame prompt changes only when applied.

    SYNC handler — pipeline.refine_frame_prompt() does a blocking LLM call.
    Declared `def` (not `async def`) so FastAPI runs it on the threadpool
    and the event loop stays free for concurrent GETs.
    """
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    if not request.context_token or not request.reviewed_message:
        raise HTTPException(status_code=422, detail="Review and confirm the complete model input before polishing")
    try:
        result = pipeline.refine_frame_prompt(
            script_id,
            request.frame_id,
            request.raw_prompt,
            request.assets,
            request.feedback,
            reviewed_message=request.reviewed_message,
            context_token=request.context_token,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Error in refine_storyboard_prompt: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class ApplyFrameImagePolishRequest(BaseModel):
    candidate_id: str


@app.post("/projects/{script_id}/frames/{frame_id}/image-polish/apply", response_model=Script)
def apply_frame_image_polish(script_id: str, frame_id: str, request: ApplyFrameImagePolishRequest,
                             user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return signed_response(pipeline.apply_frame_image_polish_candidate(script_id, frame_id, request.candidate_id))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/projects/{script_id}/frames/{frame_id}/image-polish/discard", response_model=Script)
def discard_frame_image_polish(script_id: str, frame_id: str, request: ApplyFrameImagePolishRequest,
                               user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return signed_response(pipeline.discard_frame_image_polish_candidate(script_id, frame_id, request.candidate_id))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/projects/{script_id}/frames/{frame_id}/refine")
def refine_single_frame(script_id: str, frame_id: str,
                        user: UserContext = Depends(require_studio_user)):
    """Phase 2: Propose rich fields for creator review."""
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        frame = pipeline.refine_frame(script_id, frame_id)
        if not frame:
            raise HTTPException(status_code=500, detail="Refine returned no result")
        return frame.model_dump() if hasattr(frame, 'model_dump') else frame.dict()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error in refine_single_frame: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/frames/{frame_id}/initialize")
def initialize_single_frame(script_id: str, frame_id: str,
                            user: UserContext = Depends(require_studio_user)):
    """Initialize one shot by proposing only fields that are still empty."""
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        frame = pipeline.refine_frame(script_id, frame_id, initialization=True)
        if not frame:
            raise HTTPException(status_code=500, detail="Initialization returned no result")
        return frame.model_dump() if hasattr(frame, 'model_dump') else frame.dict()
    except ValueError as e:
        status_code = 502 if "initialization returned" in str(e).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(e))
    except Exception as e:
        logger.error(f"Error in initialize_single_frame: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class RichFrameCandidateApplyRequest(BaseModel):
    candidate_id: str
    selected_fields: List[str] = Field(min_length=1, max_length=10)


class RichFrameCandidateDiscardRequest(BaseModel):
    candidate_id: str


class MicroExpressionTimingRequest(BaseModel):
    frame_id: str
    emotion_intent: str = Field("", max_length=500)
    visibility: Literal["unknown", "close", "medium", "wide", "occluded"] = "unknown"
    reviewed_messages: Optional[Dict[str, str]] = None
    review_token: Optional[str] = None


def _micro_expression_review(script_id: str, request: MicroExpressionTimingRequest, user: UserContext) -> Dict[str, Any]:
    from .micro_expression import CHANNELS, PHASES
    from ..agent_skills import catalog as skill_catalog

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == request.frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    duration = frame.duration or 0
    if duration <= 0 or not frame.character_ids:
        raise HTTPException(status_code=422, detail="请先确定镜头时长和角色")
    character_by_id = {character.id: character for character in script.characters}
    aliases = {f"character{index + 1}": character_id for index, character_id in enumerate(frame.character_ids)}
    characters = []
    anchors = {}
    for alias, character_id in aliases.items():
        character = character_by_id.get(character_id)
        characters.append({"ref": alias, "name": character.name if character else f"角色 {len(characters) + 1}"})
        if character and character.asset_pack:
            anchors[alias] = {"revision": character.asset_pack.current_revision}
    payload = {
        "characters": characters,
        "duration_seconds": duration,
        "shot_size": frame.shot_size or "",
        "composition": frame.composition or "",
        "visibility": request.visibility,
        "character_anchors": anchors,
        "current_dialogue": frame.dialogue or "",
        "current_action": frame.action_description or "",
        "emotion_intent": request.emotion_intent.strip(),
        "allowed_phases": PHASES,
        "allowed_facial_channels": CHANNELS,
        "invariants": ["character_identity", "clothing", "scene", "lighting", "camera", "dialogue", "reference_media"],
    }
    skill = next(item for item in skill_catalog() if item["id"] == "micro-expression-timing")
    messages = {
        "system": skill["instructions"],
        "user": json.dumps(payload, ensure_ascii=False),
    }
    source = {"frame": frame.model_dump(exclude={"micro_expression_candidate", "updated_at"}, mode="json"),
              "payload": payload, "skill_revision": skill["revision"]}
    token = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    return {"messages": messages, "review_token": token, "input": payload}


@app.post("/projects/{script_id}/frames/{frame_id}/micro-expression/preview")
def preview_micro_expression(script_id: str, frame_id: str, request: MicroExpressionTimingRequest,
                             user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    try:
        return _micro_expression_review(script_id, request, user)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/projects/{script_id}/frames/{frame_id}/micro-expression/generate")
def generate_micro_expression(script_id: str, frame_id: str, request: MicroExpressionTimingRequest,
                              user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    review = _micro_expression_review(script_id, request, user)
    if request.review_token != review["review_token"] or request.reviewed_messages != review["messages"]:
        raise HTTPException(status_code=409, detail="请先审核并确认完整的微表情模型输入")
    try:
        content = pipeline.script_processor.llm.chat(
            messages=[{"role": "system", "content": review["messages"]["system"]},
                      {"role": "user", "content": review["messages"]["user"]}],
            response_format={"type": "json_object"},
            timeout_seconds=300, max_retries=1,
        )
        payload = json.loads(content or "")
        from .micro_expression import validate_micro_expression_payload
        candidates = validate_micro_expression_payload(payload, duration_seconds=review["input"]["duration_seconds"])
        aliases = {f"character{index + 1}": character_id for index, character_id in enumerate(
            next(item for item in pipeline.get_script(script_id, user.owner_profile_id).frames if item.id == frame_id).character_ids
        )}
        allowed = set(aliases)
        if len({item.character_id for item in candidates}) != len(candidates) or any(item.character_id not in allowed for item in candidates):
            raise ValueError("微表情结果包含未选角色或重复角色")
        if any(
            (request.visibility == "unknown" or item.character_id not in review["input"]["character_anchors"])
            and not item.uncertainties for item in candidates
        ):
            raise ValueError("缺少可见性或角色锚点时必须标记待确认项")
        if _micro_expression_review(script_id, request, user)["review_token"] != review["review_token"]:
            raise HTTPException(status_code=409, detail="镜头或锚点已变化，请重新预览")
        script = pipeline.get_script(script_id, user.owner_profile_id)
        frame = next(item for item in script.frames if item.id == frame_id)
        normalized = []
        for item in candidates:
            value = item.model_dump(mode="json")
            value["character_id"] = aliases[item.character_id]
            normalized.append(value)
        frame.micro_expression_candidate = {
            "id": str(uuid.uuid4()), "source_hash": review["review_token"],
            "items": normalized,
            "emotion_intent": request.emotion_intent.strip(),
            "visibility": request.visibility,
        }
        frame.updated_at = time.time()
        pipeline._save_data()
        return frame.micro_expression_candidate
    except HTTPException:
        raise
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Micro-expression result failed validation: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="微表情结果未通过结构校验，请重试") from exc


class MicroExpressionApplyRequest(BaseModel):
    candidate_id: str
    character_ids: List[str] = Field(min_length=1)


@app.post("/projects/{script_id}/frames/{frame_id}/micro-expression/apply", response_model=Script)
def apply_micro_expression(script_id: str, frame_id: str, request: MicroExpressionApplyRequest,
                           user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    candidate = frame.micro_expression_candidate or {}
    if candidate.get("id") != request.candidate_id:
        raise HTTPException(status_code=409, detail="微表情候选已过期")
    if frame.workbench_prompt_is_optimized:
        raise HTTPException(status_code=409, detail="完整优化稿需重新审核后才能应用微表情时序")
    refresh = MicroExpressionTimingRequest(frame_id=frame_id, emotion_intent=candidate.get("emotion_intent", ""),
                                           visibility=candidate.get("visibility", "unknown"))
    if candidate.get("source_hash") != _micro_expression_review(script_id, refresh, user)["review_token"]:
        raise HTTPException(status_code=409, detail="镜头或锚点已变化，请重新生成")
    selected = set(request.character_ids)
    items = candidate.get("items") or []
    if len(selected) != len(request.character_ids) or not selected.issubset({item["character_id"] for item in items}):
        raise HTTPException(status_code=422, detail="请选择有效角色")
    frame.micro_expression_timing = [item for item in frame.micro_expression_timing if item.get("character_id") not in selected]
    names = {character.id: character.name for character in script.characters}
    frame.micro_expression_timing.extend(
        {**item, "character_name": names.get(item["character_id"], "当前角色")}
        for item in items if item["character_id"] in selected
    )
    frame.micro_expression_candidate = None
    frame.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


class CameraMovementRequest(BaseModel):
    frame_id: str
    reviewed_messages: Optional[Dict[str, str]] = None
    review_token: Optional[str] = None


def _camera_movement_review(script_id: str, frame_id: str, user: UserContext) -> Dict[str, Any]:
    from ..agent_skills import catalog as skill_catalog

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    skill = next(item for item in skill_catalog() if item["id"] == "shot-camera-movement")
    projection = frame.reference_visual_projection
    selected = set(projection.selected_fields) & {"space", "camera"} if projection else set()
    payload = {
        "duration_seconds": frame.duration,
        "current_action": frame.action_description or "",
        "shot_size": frame.shot_size or "",
        "camera_angle": frame.camera_angle or "",
        "composition": frame.composition or "",
        "blocking": frame.blocking.model_dump(mode="json") if frame.blocking else None,
        "camera_movement_structured": frame.camera_movement_structured.model_dump(mode="json") if frame.camera_movement_structured else None,
        "continuity_constraints": {
            "scope": projection.scope,
            "visual_design": {key: projection.visual_design[key] for key in selected if key in projection.visual_design},
        } if selected else None,
    }
    messages = {"system": skill["instructions"], "user": json.dumps(payload, ensure_ascii=False)}
    source = {
        "frame": frame.model_dump(exclude={"camera_movement_candidate", "updated_at", "assembled_prompt"}, mode="json"),
        "skill_revision": skill["revision"],
    }
    token = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"messages": messages, "review_token": token, "input": payload}


@app.post("/projects/{script_id}/frames/{frame_id}/camera-movement/preview")
def preview_camera_movement(script_id: str, frame_id: str, request: CameraMovementRequest,
                            user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    return _camera_movement_review(script_id, frame_id, user)


@app.post("/projects/{script_id}/frames/{frame_id}/camera-movement/generate")
def generate_camera_movement(script_id: str, frame_id: str, request: CameraMovementRequest,
                             user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    review = _camera_movement_review(script_id, frame_id, user)
    if request.review_token != review["review_token"] or request.reviewed_messages != review["messages"]:
        raise HTTPException(status_code=409, detail="请先审核并确认完整的运镜模型输入")
    try:
        content = pipeline.script_processor.llm.chat(
            messages=[{"role": "system", "content": review["messages"]["system"]},
                      {"role": "user", "content": review["messages"]["user"]}],
            response_format={"type": "json_object"}, timeout_seconds=300, max_retries=1,
        )
        from .camera_movement import validate_movement_payload
        proposal = validate_movement_payload(json.loads(content or ""))
        if set(proposal.source_refs) - set(review["input"]):
            raise ValueError("运镜来源不在当前镜头输入中")
        if _camera_movement_review(script_id, frame_id, user)["review_token"] != review["review_token"]:
            raise HTTPException(status_code=409, detail="镜头已变化，请重新预览")
        script = pipeline.get_script(script_id, user.owner_profile_id)
        frame = next(item for item in script.frames if item.id == frame_id)
        frame.camera_movement_candidate = {
            "id": str(uuid.uuid4()), "source_hash": review["review_token"],
            **proposal.model_dump(mode="json"),
        }
        frame.updated_at = time.time()
        pipeline._save_data()
        return frame.camera_movement_candidate
    except HTTPException:
        raise
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Camera movement result failed validation: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="运镜候选未通过结构校验，请重试") from exc


class CameraMovementApplyRequest(BaseModel):
    candidate_id: str


class ShotFieldRequest(BaseModel):
    frame_id: str
    reviewed_messages: Optional[Dict[str, str]] = None
    review_token: Optional[str] = None


class ShotFieldApplyRequest(BaseModel):
    candidate_id: str
    selected_fields: List[str]


def _shot_field_review(script_id: str, frame_id: str, user: UserContext) -> Dict[str, Any]:
    from ..agent_skills import catalog as skill_catalog
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    rows = pipeline.storyboard_continuity_sheet(script_id)["rows"]
    row_index = next(index for index, item in enumerate(rows) if item["frame_id"] == frame_id)
    row = rows[row_index]
    following = rows[row_index + 1] if row_index + 1 < len(rows) else None
    relationship = "unresolved"
    if following and row["time_continuity_id"] and following["time_continuity_id"]:
        if row["time_continuity_id"] != following["time_continuity_id"]:
            relationship = "different_time"
        elif row["place_continuity_id"] and following["place_continuity_id"]:
            relationship = ("same_place_time" if row["place_continuity_id"] == following["place_continuity_id"]
                            else "same_time_different_place")
    movement = frame.camera_movement_structured
    current = {
        "duration": frame.duration, "shot_size": frame.shot_size,
        "camera_angle": frame.camera_angle,
        "camera_movement_structured": movement.model_dump(mode="json") if hasattr(movement, "model_dump") else movement,
        "transition_hint": frame.transition_hint,
        "style_prompt_override": frame.style_prompt_override or None,
        "lighting_override": frame.lighting_override or None,
    }
    visual_keys = ("style", "story_time", "daylight_phase", "weather", "shadow_direction",
                   "key_source", "ambient_lighting", "color_tone", "contrast", "practical_sources",
                   "direction", "quality", "color_temp", "lighting_override")
    effective_visual = {
        key: {"value": row["fields"][key]["value"],
              "source": row["fields"][key]["source_kind"],
              "revision": row["fields"][key]["source_revision"]}
        for key in visual_keys if key in row["fields"]
    }
    payload = {
        "current_action": frame.action_description or "",
        "fields": current,
        "effective_visual": effective_visual,
        "scene": row["scene_name"] or "",
        "next_shot": {"scene": following["scene_name"] or "", "relationship": relationship}
        if following else None,
        "continuity": {"status": row["continuity_status"],
                       "reference_fields": row["reference"]["selected_fields"] if row["reference"] else []},
    }
    skill = next(item for item in skill_catalog() if item["id"] == "shot-field-continuity")
    system = skill["instructions"]
    messages = {"system": system, "user": json.dumps(payload, ensure_ascii=False)}
    source = {
        "frame": frame.model_dump(exclude={"shot_field_candidate", "updated_at", "assembled_prompt"}, mode="json"),
        "row": row, "messages": messages, "skill_revision": skill["revision"],
    }
    token = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    return {"messages": messages, "review_token": token, "input": payload}


@app.post("/projects/{script_id}/frames/{frame_id}/shot-fields/preview")
def preview_shot_fields(script_id: str, frame_id: str, request: ShotFieldRequest,
                        user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    return _shot_field_review(script_id, frame_id, user)


@app.post("/projects/{script_id}/frames/{frame_id}/shot-fields/generate")
def generate_shot_fields(script_id: str, frame_id: str, request: ShotFieldRequest,
                         user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    review = _shot_field_review(script_id, frame_id, user)
    if request.review_token != review["review_token"] or request.reviewed_messages != review["messages"]:
        raise HTTPException(status_code=409, detail="请先审核并确认当前镜头字段输入")
    try:
        from .shot_field_optimization import validate_shot_field_payload
        content = pipeline.script_processor.llm.chat(
            messages=[{"role": "system", "content": review["messages"]["system"]},
                      {"role": "user", "content": review["messages"]["user"]}],
            response_format={"type": "json_object"}, timeout_seconds=300, max_retries=1,
        )
        proposal = validate_shot_field_payload(json.loads(content or ""))
        if "transition_hint" in proposal.fields and review["input"]["next_shot"] is None:
            raise ValueError("Last shot has no transition target")
        def supplied_path(ref: str) -> bool:
            value: Any = review["input"]
            for key in ref.split("."):
                if not isinstance(value, dict) or key not in value:
                    return False
                value = value[key]
            return value is not None and value != ""

        if any(not supplied_path(ref) for refs in proposal.source_refs.values() for ref in refs):
            raise ValueError("Shot field source is not in current input")
        if _shot_field_review(script_id, frame_id, user)["review_token"] != review["review_token"]:
            raise HTTPException(status_code=409, detail="镜头或场景已变化，请重新预览")
        if not proposal.fields:
            return {"id": "", **proposal.model_dump(mode="json")}
        frame = next(item for item in pipeline.get_script(script_id, user.owner_profile_id).frames if item.id == frame_id)
        frame.shot_field_candidate = {"id": str(uuid.uuid4()), "source_hash": review["review_token"],
                                      **proposal.model_dump(mode="json")}
        frame.updated_at = time.time()
        pipeline._save_data()
        return frame.shot_field_candidate
    except HTTPException:
        raise
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="镜头字段候选未通过结构校验，请重试") from exc


@app.post("/projects/{script_id}/frames/{frame_id}/shot-fields/apply", response_model=Script)
def apply_shot_fields(script_id: str, frame_id: str, request: ShotFieldApplyRequest,
                      user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    candidate = frame.shot_field_candidate or {}
    if candidate.get("id") != request.candidate_id or candidate.get("source_hash") != _shot_field_review(script_id, frame_id, user)["review_token"]:
        raise HTTPException(status_code=409, detail="镜头字段候选已过期")
    if frame.workbench_prompt_is_optimized:
        raise HTTPException(status_code=409, detail="完整优化稿需重新审核后才能应用镜头字段")
    from .shot_field_optimization import validate_shot_field_payload
    from .prompt_assembly import assemble_prompt
    proposal = validate_shot_field_payload({key: candidate[key] for key in ("fields", "rationale", "source_refs", "uncertainties")})
    selected = request.selected_fields
    if not selected or len(set(selected)) != len(selected) or set(selected) - set(proposal.fields):
        raise HTTPException(status_code=422, detail="请选择有效的镜头字段")
    proposed = frame.model_copy(deep=True)
    for key in selected:
        setattr(proposed, key, proposal.fields[key])
    proposed = StoryboardFrame.model_validate(proposed.model_dump(mode="json"))
    assembled = assemble_prompt(proposed, pipeline.resolve_project_assets(script)["characters"])
    for key in selected:
        setattr(frame, key, getattr(proposed, key))
    frame.assembled_prompt = assembled
    frame.shot_field_candidate = None
    frame.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


@app.post("/projects/{script_id}/frames/{frame_id}/camera-movement/apply", response_model=Script)
def apply_camera_movement(script_id: str, frame_id: str, request: CameraMovementApplyRequest,
                          user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    candidate = frame.camera_movement_candidate or {}
    if candidate.get("id") != request.candidate_id:
        raise HTTPException(status_code=409, detail="运镜候选已过期")
    if frame.workbench_prompt_is_optimized:
        raise HTTPException(status_code=409, detail="完整优化稿需重新审核后才能应用运镜")
    if candidate.get("source_hash") != _camera_movement_review(script_id, frame_id, user)["review_token"]:
        raise HTTPException(status_code=409, detail="镜头已变化，请重新生成")
    from .camera_movement import validate_movement_payload
    from .prompt_assembly import assemble_prompt
    proposal = validate_movement_payload({key: candidate[key] for key in
        ("camera_movement_structured", "rationale", "source_refs", "uncertainties")})
    frame.camera_movement_structured = proposal.camera_movement_structured
    frame.assembled_prompt = assemble_prompt(frame, pipeline.resolve_project_assets(script)["characters"])
    frame.camera_movement_candidate = None
    frame.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


class StaticFramingRequest(BaseModel):
    frame_id: str
    reviewed_messages: Optional[Dict[str, str]] = None
    review_token: Optional[str] = None


def _static_framing_review(script_id: str, frame_id: str, user: UserContext) -> Dict[str, Any]:
    from ..agent_skills import catalog as skill_catalog

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    skill = next(item for item in skill_catalog() if item["id"] == "shot-static-framing")
    projection = frame.reference_visual_projection
    selected = set(projection.selected_fields) & {"space", "camera"} if projection else set()
    plan_shot = (frame.director_shot_context or {}).get("shot") or {}
    payload = {
        "duration_seconds": frame.duration,
        "current_action": frame.action_description or "",
        "opening_performance": frame.character_acting or "",
        "shot_size": frame.shot_size or "",
        "camera_angle": frame.camera_angle or "",
        "composition": frame.composition or "",
        "blocking": frame.blocking.model_dump(mode="json") if frame.blocking else None,
        "current_camera_movement": frame.camera_movement_structured.model_dump(mode="json") if frame.camera_movement_structured else None,
        "director_static_suggestion": {key: plan_shot[key] for key in
            ("shot_size", "camera_angle", "composition", "visual_intent") if plan_shot.get(key)},
        "continuity_constraints": {
            "scope": projection.scope,
            "visual_design": {key: projection.visual_design[key] for key in selected if key in projection.visual_design},
        } if selected else None,
    }
    messages = {"system": skill["instructions"], "user": json.dumps(payload, ensure_ascii=False)}
    source = {
        "frame": frame.model_dump(exclude={"static_framing_candidate", "camera_movement_candidate",
                                            "micro_expression_candidate", "rich_refinement_candidate",
                                            "updated_at", "assembled_prompt"}, mode="json"),
        "skill_revision": skill["revision"],
    }
    token = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"messages": messages, "review_token": token, "input": payload}


@app.post("/projects/{script_id}/frames/{frame_id}/static-framing/preview")
def preview_static_framing(script_id: str, frame_id: str, request: StaticFramingRequest,
                           user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    return _static_framing_review(script_id, frame_id, user)


@app.post("/projects/{script_id}/frames/{frame_id}/static-framing/generate")
def generate_static_framing(script_id: str, frame_id: str, request: StaticFramingRequest,
                            user: UserContext = Depends(require_studio_user)):
    if request.frame_id != frame_id:
        raise HTTPException(status_code=422, detail="Frame ID mismatch")
    review = _static_framing_review(script_id, frame_id, user)
    if request.review_token != review["review_token"] or request.reviewed_messages != review["messages"]:
        raise HTTPException(status_code=409, detail="请先审核并确认完整的静态起幅模型输入")
    try:
        content = pipeline.script_processor.llm.chat(
            messages=[{"role": "system", "content": review["messages"]["system"]},
                      {"role": "user", "content": review["messages"]["user"]}],
            response_format={"type": "json_object"}, timeout_seconds=300, max_retries=1,
        )
        from .static_framing import validate_static_framing_payload
        proposal = validate_static_framing_payload(json.loads(content or ""))
        if any(set(refs) - set(review["input"]) for refs in proposal.source_refs.values()):
            raise ValueError("静态起幅来源不在当前镜头输入中")
        if _static_framing_review(script_id, frame_id, user)["review_token"] != review["review_token"]:
            raise HTTPException(status_code=409, detail="镜头已变化，请重新预览")
        script = pipeline.get_script(script_id, user.owner_profile_id)
        frame = next(item for item in script.frames if item.id == frame_id)
        frame.static_framing_candidate = {
            "id": str(uuid.uuid4()), "source_hash": review["review_token"],
            "current_fields": {key: getattr(frame, key) for key in proposal.fields},
            **proposal.model_dump(mode="json"),
        }
        frame.updated_at = time.time()
        pipeline._save_data()
        return frame.static_framing_candidate
    except HTTPException:
        raise
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Static framing result failed validation: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="静态起幅候选未通过结构校验，请重试") from exc


class StaticFramingApplyRequest(BaseModel):
    candidate_id: str
    selected_fields: List[str] = Field(min_length=1, max_length=3)


@app.post("/projects/{script_id}/frames/{frame_id}/static-framing/apply", response_model=Script)
def apply_static_framing(script_id: str, frame_id: str, request: StaticFramingApplyRequest,
                         user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == frame_id), None)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    candidate = frame.static_framing_candidate or {}
    if candidate.get("id") != request.candidate_id:
        raise HTTPException(status_code=409, detail="静态起幅候选已过期")
    if frame.workbench_prompt_is_optimized:
        raise HTTPException(status_code=409, detail="完整优化稿需重新审核后才能应用静态起幅")
    if candidate.get("source_hash") != _static_framing_review(script_id, frame_id, user)["review_token"]:
        raise HTTPException(status_code=409, detail="镜头已变化，请重新生成")
    from .static_framing import validate_static_framing_payload
    from .prompt_assembly import assemble_prompt
    proposal = validate_static_framing_payload({key: candidate[key] for key in
        ("fields", "rationale", "source_refs", "uncertainties")})
    selected = request.selected_fields
    if len(set(selected)) != len(selected) or set(selected) - set(proposal.fields):
        raise HTTPException(status_code=422, detail="请选择有效的静态起幅字段")
    proposed_frame = frame.model_copy(deep=True)
    for key in selected:
        setattr(proposed_frame, key, proposal.fields[key])
    assembled = assemble_prompt(proposed_frame, pipeline.resolve_project_assets(script)["characters"])
    for key in selected:
        setattr(frame, key, proposal.fields[key])
    frame.assembled_prompt = assembled
    frame.static_framing_candidate = None
    frame.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


@app.post("/projects/{script_id}/frames/{frame_id}/rich-refinement/apply", response_model=Script)
def apply_rich_refinement(script_id: str, frame_id: str, request: RichFrameCandidateApplyRequest,
                          user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return signed_response(pipeline.apply_rich_refinement_candidate(
            script_id, frame_id, request.candidate_id, request.selected_fields,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/projects/{script_id}/frames/{frame_id}/rich-refinement/discard", response_model=Script)
def discard_rich_refinement(script_id: str, frame_id: str, request: RichFrameCandidateDiscardRequest,
                            user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return signed_response(pipeline.discard_rich_refinement_candidate(
            script_id, frame_id, request.candidate_id,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/projects/{script_id}/storyboard/refine_batch")
def refine_storyboard_batch(script_id: str,
                            user: UserContext = Depends(require_studio_user)):
    """Phase 2: Batch refine all coarse frames. Streams SSE events."""
    from fastapi.responses import StreamingResponse

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    def event_stream():
        for event_type, data in pipeline.refine_batch_generator(script_id):
            yield f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/projects/{script_id}/storyboard/initialize")
def initialize_storyboard_batch(script_id: str,
                                user: UserContext = Depends(require_studio_user)):
    """Initialize all shots, proposing only missing fields for review."""
    from fastapi.responses import StreamingResponse

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    def event_stream():
        for event_type, data in pipeline.initialize_batch_generator(script_id):
            yield f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/projects/{script_id}/generate_storyboard", response_model=Script)
def generate_storyboard(script_id: str):
    """Triggers storyboard generation."""
    try:
        updated_script = pipeline.generate_storyboard(script_id)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/projects/{script_id}/generate_video", response_model=Script)
def generate_video(script_id: str):
    """Triggers video generation."""
    try:
        updated_script = pipeline.generate_video(script_id)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/projects/{script_id}/generate_audio", response_model=Script)
def generate_audio(script_id: str):
    """Triggers audio generation."""
    try:
        updated_script = pipeline.generate_audio(script_id)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class CreateVideoTaskRequest(BaseModel):
    image_url: str
    last_frame_url: Optional[str] = None
    last_frame_media_id: Optional[str] = None
    prompt: str
    frame_id: Optional[str] = None
    visual_source_hash: Optional[str] = None
    duration: int = 5
    seed: Optional[int] = None
    resolution: str = "720p"
    generate_audio: bool = False
    audio_url: Optional[str] = None
    prompt_extend: bool = True
    negative_prompt: Optional[str] = None
    batch_size: int = 1
    model: str = "wan2.6-i2v"
    shot_type: str = "single"  # 'single' or 'multi' (only for wan2.6-i2v)
    generation_mode: str = "i2v"  # 't2v' | 'i2v' | 'first_last_frame' | 'r2v'
    reference_video_urls: List[str] = []  # Reference video URLs for R2V (max 3)
    reference_asset_inputs: Optional[List[VideoReferenceIdentity]] = None
    # Kling params
    mode: Optional[str] = None
    sound: Optional[str] = None
    cfg_scale: Optional[float] = None
    # Vidu params
    vidu_audio: Optional[bool] = None
    movement_amplitude: Optional[str] = None
    # HappyHorse params
    reference_image_urls: List[str] = []  # Reference image URLs for HH R2V (max 9)
    pose_reference_variant_ids: Dict[str, List[str]] = {}
    director_snapshot_media_id: Optional[str] = None
    ratio: Optional[str] = None  # Aspect ratio for HH T2V/R2V
    # Watermark toggle (wan / kling / vidu / pixverse / happyhorse video).
    # None = leave to provider default; True/False = explicit user choice.
    watermark: Optional[bool] = None
    # Source tab in the Storyboard R2V workbench. Distinct from
    # generation_mode (backend dispatcher hint) — used by the candidates
    # panel to group takes per UI tab on refresh.
    workbench_tab: Optional[str] = None  # 't2i_i2v' | 'direct_r2v'


def process_video_task(script_id: str, task_id: str):
    """Background task to generate video.

    The pipeline method has its own try/except that flips status to
    "failed" on errors during generation. This outer wrapper is a
    belt-and-suspenders writeback for exceptions that escape *before*
    that inner handler armed (e.g. `get_script` raising, persistence
    layer crashing). Without it the task would stay forever-`pending`
    and the UI would show an eternal spinner.
    """
    try:
        pipeline.process_video_task(script_id, task_id)
    except Exception as e:
        logger.exception(f"Error processing video task {task_id}")
        try:
            pipeline.mark_video_task_failed(
                script_id, task_id, f"Background error: {e}"
            )
        except Exception:
            logger.exception(
                f"Could not mark video task {task_id} as failed after wrapper exception"
            )


class AnnotateVideoTaskRequest(BaseModel):
    """User-review annotations on a video task ("抽卡 review").
    Both fields optional so the same endpoint covers star-only,
    label-only, or both. `clear_label=True` explicitly removes
    the label (None on its own means "don't change")."""
    is_starred: Optional[bool] = None
    label: Optional[str] = None
    clear_label: bool = False


@app.patch("/projects/{script_id}/video_tasks/{task_id}/annotate", response_model=VideoTask)
def annotate_video_task(script_id: str, task_id: str, request: AnnotateVideoTaskRequest):
    """Set the user's star + label on a video task. Used by Storyboard's
    candidates panel for shortlist marking (multi-select) and short
    free-text notes (≤20 chars, truncated server-side)."""
    task = pipeline.annotate_video_task(
        script_id,
        task_id,
        is_starred=request.is_starred,
        label=request.label,
        clear_label=request.clear_label,
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Video task not found")
    return signed_response(task)


class UpdateFrameWorkbenchRequest(BaseModel):
    """Storyboard R2V workbench state writeback. Every field optional;
    only what the caller passes gets updated. The server clamps lists
    and indices to safe ranges; rejects unknown enum values."""
    workbench_tab_mode: Optional[str] = None  # 't2i_i2v' | 'direct_r2v'
    t2i_image_urls: Optional[List[str]] = None  # full ordered history, server caps at 10 FIFO
    t2i_selected_index: Optional[int] = None  # active首帧 index, clamped to range
    last_frame_image_urls: Optional[List[str]] = None
    last_frame_selected_index: Optional[int] = None
    video_generation_mode: Optional[str] = None
    workbench_generate_count: Optional[int] = None  # batch size, clamped to [1, 6]
    video_model: Optional[str] = None
    workbench_generate_audio: Optional[bool] = None
    workbench_prompt_is_optimized: Optional[bool] = None
    workbench_reference_variant_ids: Optional[Dict[str, List[str]]] = None
    workbench_pose_reference_variant_ids: Optional[Dict[str, List[str]]] = None
    workbench_director_snapshot_media_id: Optional[str] = None


class SaveShotVisualPresetRequest(BaseModel):
    name: str
    visual_design: Optional[Dict[str, Any]] = None
    compiled_prompt: str = ""
    source_variant_id: Optional[str] = None
    source_scene_revision: Optional[int] = None


class ApplyShotVisualPresetRequest(BaseModel):
    apply_mode: Literal[
        "parameters_only", "parameters_with_reference", "image_only", "image_and_context",
    ] = "parameters_only"
    selected_fields: Optional[List[Literal["lighting", "space", "camera", "continuity_state"]]] = None


@app.get("/projects/{script_id}/shot-visual-presets")
def list_shot_visual_presets(
    script_id: str, scene_id: Optional[str] = None,
    user: UserContext = Depends(require_studio_user),
):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    result = []
    for preset in pipeline.list_shot_visual_presets(script_id, scene_id=scene_id):
        _, _, variant, _, _ = pipeline._visual_reference_source(script, preset)
        stored = image_variant_storage_key(variant) if variant else None
        preview_url = None
        if stored:
            try:
                preview_url = _owned_media_cover_url(stored, user.owner_profile_id, 160)
            except HTTPException:
                pass
        result.append({**preset.model_dump(mode="json"), "preview_url": preview_url})
    return private_no_store_signed_response(result)


@app.get("/projects/{script_id}/frames/{frame_id}/shot-visual-presets/{preset_id}/projection")
def preview_shot_visual_preset_projection(
    script_id: str, frame_id: str, preset_id: str,
    user: UserContext = Depends(require_studio_user),
):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        return pipeline.preview_shot_visual_preset(script_id, frame_id, preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/projects/{script_id}/storyboard/continuity-sheet")
def storyboard_continuity_sheet(
    script_id: str, user: UserContext = Depends(require_studio_user),
):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return pipeline.storyboard_continuity_sheet(script_id)


@app.post("/projects/{script_id}/frames/{frame_id}/shot-visual-presets", response_model=ShotVisualPreset)
def save_shot_visual_preset(script_id: str, frame_id: str, request: SaveShotVisualPresetRequest):
    try:
        preset = pipeline.save_shot_visual_preset(
            script_id,
            frame_id,
            request.name,
            visual_design=request.visual_design,
            compiled_prompt=request.compiled_prompt,
            source_variant_id=request.source_variant_id,
            source_scene_revision=request.source_scene_revision,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if preset is None:
        raise HTTPException(status_code=404, detail="Script or frame not found")
    return preset


@app.post("/projects/{script_id}/frames/{frame_id}/shot-visual-presets/{preset_id}/apply", response_model=StoryboardFrame)
def apply_shot_visual_preset(script_id: str, frame_id: str, preset_id: str, request: ApplyShotVisualPresetRequest):
    try:
        frame = pipeline.apply_shot_visual_preset(
            script_id, frame_id, preset_id, request.apply_mode,
            selected_fields=request.selected_fields,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if frame is None:
        raise HTTPException(status_code=404, detail="Script, frame, or visual preset not found")
    return signed_response(frame)


@app.patch("/projects/{script_id}/frames/{frame_id}/workbench", response_model=StoryboardFrame)
def update_frame_workbench(
    script_id: str, frame_id: str, request: UpdateFrameWorkbenchRequest
):
    """Persist Storyboard R2V workbench state onto a frame so it
    survives refresh and cross-device opens. Previously this state
    lived only in React component state and got lost on reload."""
    try:
        frame = pipeline.update_frame_workbench(
            script_id,
            frame_id,
            workbench_tab_mode=request.workbench_tab_mode,
            t2i_image_urls=request.t2i_image_urls,
            t2i_selected_index=request.t2i_selected_index,
            last_frame_image_urls=request.last_frame_image_urls,
            last_frame_selected_index=request.last_frame_selected_index,
            video_generation_mode=request.video_generation_mode,
            workbench_generate_count=request.workbench_generate_count,
            video_model=request.video_model,
            workbench_generate_audio=request.workbench_generate_audio,
            workbench_prompt_is_optimized=request.workbench_prompt_is_optimized,
            workbench_reference_variant_ids=request.workbench_reference_variant_ids,
            workbench_pose_reference_variant_ids=request.workbench_pose_reference_variant_ids,
            workbench_director_snapshot_media_id=request.workbench_director_snapshot_media_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if frame is None:
        raise HTTPException(status_code=404, detail="Script or frame not found")
    return signed_response(frame)


@app.post("/projects/{script_id}/video_tasks/{task_id}/cancel", response_model=VideoTask)
def cancel_video_task(script_id: str, task_id: str):
    """Mark a video task as failed-by-cancel. We can't actually yank a
    running provider call mid-flight (the provider keeps rendering on
    its side), but flipping the local status to "failed" unblocks the
    UI and puts the user back in control. Treats already-completed
    tasks as a no-op."""
    ok = pipeline.mark_video_task_failed(script_id, task_id, "Canceled by user")
    if not ok:
        raise HTTPException(
            status_code=404,
            detail="Video task not found or already completed",
        )
    script = pipeline.get_script(script_id)
    task = next(
        (t for t in (script.video_tasks if script else []) if t.id == task_id),
        None,
    )
    if not task:
        raise HTTPException(status_code=404, detail="Video task not found")
    return signed_response(task)


@app.post("/projects/{script_id}/video_tasks", response_model=List[VideoTask])
def create_video_task(script_id: str, request: CreateVideoTaskRequest, background_tasks: BackgroundTasks):
    """Creates new video generation tasks."""
    if request.visual_source_hash:
        try:
            row = next(item for item in pipeline.storyboard_continuity_sheet(script_id)["rows"]
                       if item["frame_id"] == request.frame_id)
        except (ValueError, StopIteration):
            raise HTTPException(status_code=404, detail="Shot not found")
        if row["visual_source_hash"] != request.visual_source_hash:
            raise HTTPException(status_code=409, detail="Shot visual sources changed; review video input again")
    try:
        tasks = []
        for _ in range(request.batch_size):
            script, task_id = pipeline.create_video_task(
                script_id=script_id,
                image_url=request.image_url,
                last_frame_url=request.last_frame_url,
                last_frame_media_id=request.last_frame_media_id,
                prompt=request.prompt,
                frame_id=request.frame_id,
                duration=request.duration,
                seed=request.seed,
                resolution=request.resolution,
                generate_audio=request.generate_audio,
                audio_url=request.audio_url,
                prompt_extend=request.prompt_extend,
                negative_prompt=request.negative_prompt,
                model=request.model,
                shot_type=request.shot_type,
                generation_mode=request.generation_mode,
                reference_video_urls=request.reference_video_urls,
                reference_image_urls=request.reference_image_urls,
                reference_asset_inputs=request.reference_asset_inputs,
                pose_reference_variant_ids=request.pose_reference_variant_ids,
                director_snapshot_media_id=request.director_snapshot_media_id,
                ratio=request.ratio,
                watermark=request.watermark,
                mode=request.mode,
                sound=request.sound,
                cfg_scale=request.cfg_scale,
                vidu_audio=request.vidu_audio,
                movement_amplitude=request.movement_amplitude,
                workbench_tab=request.workbench_tab,
            )

            # Find the created task object
            created_task = next((t for t in script.video_tasks if t.id == task_id), None)
            if created_task:
                tasks.append(created_task)

            # Add background processing
            background_tasks.add_task(pipeline.process_video_task, script_id, task_id)

        return signed_response(tasks)

    except ValueError as e:
        # Validation failures from pipeline.create_video_task (model⇄
        # mode⇄refs mismatch, missing references for R2V, etc.) are
        # the user's responsibility to fix — surface as 400 so the
        # frontend can show an inline error instead of treating it
        # as a server error.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/assets/generate")
def generate_single_asset(script_id: str, request: GenerateAssetRequest, background_tasks: BackgroundTasks):
    """Generates a single asset with specific options (async).
    Returns immediately with task_id for polling progress."""
    _require_reviewed_asset_image_prompt(request, require_fingerprint=True)
    try:
        script, task_id = pipeline.create_asset_generation_task(
            script_id,
            request.asset_id,
            request.asset_type,
            request.style_preset,
            request.reference_image_url,
            request.style_prompt,
            request.generation_type,
            request.prompt,
            request.apply_style,
            request.negative_prompt,
            request.batch_size,
            request.model_name,
            request.aspect_ratio,
            request.reference,
            request.references,
            request.image_generation_mode,
            request.preserve_prompt,
            request.expected_review_fingerprint,
            request.scene_tool,
            request.edit_mode,
        )
        
        # Add background processing
        background_tasks.add_task(pipeline.process_asset_generation_task, task_id)
        
        # Return script with task_id for frontend polling
        response_data = script.model_dump() if hasattr(script, 'model_dump') else script.dict()
        response_data["_task_id"] = task_id
        return signed_response(response_data)

    except InvalidAssetReference as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AssetGenerationInProgress as e:
        raise HTTPException(status_code=409, detail=str(e))
    except AssetReviewChanged as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/generation/clear", response_model=Script)
def clear_asset_generation_state(script_id: str, asset_type: str, asset_id: str):
    """Clear a failed/orphaned image-generation marker without deleting the asset."""
    try:
        pipeline.clear_asset_generation_state(script_id, asset_id, asset_type)
        return get_project(script_id)
    except ValueError as e:
        status_code = 409 if "still processing" in str(e) else 404
        raise HTTPException(status_code=status_code, detail=str(e))
    except Exception as e:
        logger.exception("Failed to clear asset generation state")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tasks/{task_id}")
def get_task_status(task_id: str):
    """Returns a recoverable asset or persisted video task status."""
    status = pipeline.get_asset_generation_task_status(task_id)
    if not status:
        status = pipeline.get_video_task_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")

    if status.get("video_url"):
        return signed_response(status)

    # Asset tasks are polled frequently. Keep pending/processing responses
    # cheap, and sign only the completed target-asset snapshot so the client
    # can merge it without loading the full project.
    if status.get("asset_id") and status.get("asset_type") in (
        "character", "scene", "prop", "full_body", "head_shot"
    ):
        if status.get("status") == "completed" and status.get("asset"):
            return signed_response(status)
        return status

    # Preserve the legacy completed-script payload for non-asset task callers.
    if status.get("status") == "completed":
        script = pipeline.get_script(status["script_id"])
        if script:
            status["script"] = signed_response(script).body.decode("utf-8")

    return status


class GenerateAssetVideoRequest(BaseModel):
    prompt: Optional[str] = None
    duration: int = 5
    aspect_ratio: Optional[str] = None


@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/generate_video", response_model=Script)
def generate_asset_video(script_id: str, asset_type: str, asset_id: str, request: GenerateAssetVideoRequest, background_tasks: BackgroundTasks):
    """Generates a video for a specific asset (I2V)."""
    try:
        script, task_id = pipeline.create_asset_video_task(
            script_id,
            asset_id,
            asset_type,
            request.prompt,
            request.duration,
            request.aspect_ratio
        )
        
        # Add background processing
        background_tasks.add_task(pipeline.process_video_task, script_id, task_id)
        
        return signed_response(script)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/projects/{script_id}/assets/{asset_type}/{asset_id}/videos/{video_id}", response_model=Script)
def delete_asset_video(script_id: str, asset_type: str, asset_id: str, video_id: str):
    """Deletes a video from an asset."""
    try:
        updated_script = pipeline.delete_asset_video(
            script_id,
            asset_id,
            asset_type,
            video_id
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/projects/{script_id}/assets/toggle_lock", response_model=Script)
def toggle_asset_lock(script_id: str, request: ToggleLockRequest):
    """Toggles the locked status of an asset."""
    try:
        updated_script = pipeline.toggle_asset_lock(
            script_id,
            request.asset_id,
            request.asset_type
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/assets/toggle_starred", response_model=Script)
def toggle_asset_starred(script_id: str, request: ToggleLockRequest):
    """Toggles the starred (library shortlist) status of an asset."""
    try:
        updated_script = pipeline.toggle_asset_starred(
            script_id,
            request.asset_id,
            request.asset_type
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/projects/{script_id}/assets/update_image", response_model=Script)
def update_asset_image(script_id: str, request: UpdateAssetImageRequest):
    """Updates an asset's image URL manually."""
    try:
        updated_script = pipeline.update_asset_image(
            script_id,
            request.asset_id,
            request.asset_type,
            request.image_url
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/projects/{script_id}/assets/update_attributes")
def update_asset_attributes(script_id: str, request: UpdateAssetAttributesRequest):
    """Updates arbitrary attributes of an asset."""
    if request.response_mode == "design" and (
        request.asset_type != "character" or set(request.attributes) != {"character_design"}
    ):
        raise HTTPException(status_code=422, detail="Design response requires only a character design update")
    started = time.perf_counter()
    try:
        script = pipeline.update_asset_attributes(
            script_id,
            request.asset_id,
            request.asset_type,
            request.attributes
        )
        persisted = time.perf_counter()
        if request.response_mode == "design":
            asset, _ = pipeline._find_asset_with_source(script, request.asset_id, "character")
            response = signed_response({
                "project_id": script_id,
                "asset_id": request.asset_id,
                "asset_revision": asset.asset_revision,
                "character_design": asset.character_design,
            })
        else:
            response = get_project(script_id)
        finished = time.perf_counter()
        response.headers["Server-Timing"] = (
            f"persist;dur={(persisted - started) * 1000:.1f}, "
            f"response;dur={(finished - persisted) * 1000:.1f}"
        )
        logger.info("Asset save mode=%s persist_ms=%.1f response_ms=%.1f bytes=%d",
                    request.response_mode, (persisted - started) * 1000,
                    (finished - persisted) * 1000, len(response.body))
        return response
    except InvalidAssetName as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class UpdateAssetDescriptionRequest(BaseModel):
    asset_id: str
    asset_type: str
    description: str


@app.post("/projects/{script_id}/assets/update_description")
def update_asset_description(script_id: str, request: UpdateAssetDescriptionRequest):
    """Updates an asset's description."""
    try:
        pipeline.update_asset_description(
            script_id,
            request.asset_id,
            request.asset_type,
            request.description
        )
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class SetAssetCoverRequest(BaseModel):
    variant_id: str = Field(..., min_length=1)


class SelectVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str
    generation_type: str = None  # For character: "full_body", "three_view", "headshot"


class ConfirmAssetRevisionRequest(BaseModel):
    expected_revision: int = Field(..., ge=1)
    active_variant_ids: Optional[List[str]] = None
    selected_variant_id: Optional[str] = None


class RestoreAssetRevisionRequest(BaseModel):
    expected_revision: int = Field(..., ge=1)


class ConfirmCharacterAnchorRequest(BaseModel):
    variant_id: str = Field(..., min_length=1)
    expected_asset_revision: int = Field(..., ge=1)
    expected_pack_revision: int = Field(..., ge=0)
    verified_front_full_body: bool = False


@app.get("/projects/{script_id}/characters/{character_id}/asset-pack")
def get_project_character_asset_pack(
    script_id: str, character_id: str,
    user: UserContext = Depends(require_studio_user),
):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return pipeline.get_project_character_asset_pack(script_id, character_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/projects/{script_id}/characters/{character_id}/asset-pack/anchor")
def confirm_project_character_anchor(
    script_id: str, character_id: str, request: ConfirmCharacterAnchorRequest,
    user: UserContext = Depends(require_studio_user),
):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return pipeline.confirm_project_character_anchor(
            script_id, character_id, request.variant_id,
            request.expected_asset_revision, request.expected_pack_revision,
            request.verified_front_full_body,
        )
    except ValueError as exc:
        status = 409 if "revision changed" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


class ConfirmEpisodeCharacterUseRequest(BaseModel):
    use_id: Optional[str] = Field(None, min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=120)
    condition: str = Field("", max_length=500)
    selected_asset_id: str = Field(..., min_length=1)
    selected_variant_id: str = Field(..., min_length=1)
    expected_pack_revision: int = Field(..., ge=1)
    reviewed: bool = False


class SelectFrameCharacterUseRequest(BaseModel):
    project_character_id: str = Field(..., min_length=1)
    use_id: str = Field(..., min_length=1)
    expected_reference_revision: int = Field(..., ge=1)


@app.get("/projects/{script_id}/character-uses")
def list_episode_character_uses(
    script_id: str, user: UserContext = Depends(require_studio_user),
):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"uses": [item.model_dump() for item in script.episode_character_uses]}


@app.post("/projects/{script_id}/characters/{character_id}/episode-uses")
def confirm_episode_character_use(
    script_id: str, character_id: str, request: ConfirmEpisodeCharacterUseRequest,
    user: UserContext = Depends(require_studio_user),
):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        use = pipeline.confirm_episode_character_use(
            script_id, character_id, request.use_id or str(uuid.uuid4()),
            request.label, request.condition, request.selected_asset_id,
            request.selected_variant_id, request.expected_pack_revision,
            request.reviewed,
        )
        return use.model_dump()
    except ValueError as exc:
        status = 409 if "revision changed" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/projects/{script_id}/frames/{frame_id}/character-use")
def select_frame_character_use(
    script_id: str, frame_id: str, request: SelectFrameCharacterUseRequest,
    user: UserContext = Depends(require_studio_user),
):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        pipeline.select_frame_character_use(
            script_id, frame_id, request.project_character_id,
            request.use_id, request.expected_reference_revision,
        )
        return signed_response(pipeline.get_script(script_id, user.owner_profile_id))
    except ValueError as exc:
        status = 409 if "revision changed" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.get("/projects/{script_id}/assets/{asset_type}/{asset_id}/revisions")
def get_asset_revisions(script_id: str, asset_type: str, asset_id: str,
                        user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return private_no_store_signed_response(
            pipeline.get_asset_revisions(script_id, asset_id, asset_type))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/revisions/confirm")
def confirm_asset_revision(script_id: str, asset_type: str, asset_id: str,
                           request: ConfirmAssetRevisionRequest,
                           user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return private_no_store_signed_response(pipeline.confirm_asset_revision(
            script_id, asset_id, asset_type, request.expected_revision,
            request.active_variant_ids, request.selected_variant_id))
    except ValueError as exc:
        status = 409 if "revision changed" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc))


@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/revisions/{revision}/restore")
def restore_asset_revision(script_id: str, asset_type: str, asset_id: str,
                           revision: int, request: RestoreAssetRevisionRequest,
                           user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return private_no_store_signed_response(pipeline.restore_asset_revision(
            script_id, asset_id, asset_type, revision, request.expected_revision))
    except ValueError as exc:
        status = 409 if "revision changed" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc))

@app.post("/projects/{script_id}/assets/variant/select")
def select_asset_variant(script_id: str, request: SelectVariantRequest):
    """Selects a specific variant for an asset."""
    try:
        updated_script = pipeline.select_asset_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type
        )
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/cover")
def set_asset_cover(script_id: str, asset_type: str, asset_id: str, request: SetAssetCoverRequest):
    """Set one owned variant as the library cover without loading the project."""
    try:
        result = pipeline.set_asset_cover_variant(script_id, asset_id, asset_type, request.variant_id)
        return private_no_store_signed_response(result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to set asset library cover")
        raise HTTPException(status_code=500, detail=str(exc))


class DeleteVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str

class UpdateVariantMetadataRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str
    reference_view_role: Optional[str] = None
    reference_distance: Optional[str] = None
    display_name: Optional[str] = None

@app.post("/projects/{script_id}/assets/variant/metadata")
def update_asset_variant_metadata(script_id: str, request: UpdateVariantMetadataRequest):
    """Updates the angle/distance labels for one child reference image."""
    try:
        pipeline.update_asset_variant_metadata(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.reference_view_role,
            request.reference_distance,
            request.display_name,
        )
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/projects/{script_id}/assets/variant/delete", response_model=Script)
def delete_asset_variant(script_id: str, request: DeleteVariantRequest):
    """Deletes a specific variant from an asset."""
    try:
        pipeline.delete_asset_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id
        )
        # Shared series/global assets are merged into a project only at read
        # time. Returning the raw episode Script would temporarily remove the
        # edited asset from the frontend and close its detail workbench.
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FavoriteVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str
    generation_type: Optional[str] = None  # For character: 'full_body', 'three_view', 'headshot'
    is_favorited: bool

@app.post("/projects/{script_id}/assets/variant/favorite", response_model=Script)
def toggle_variant_favorite(script_id: str, request: FavoriteVariantRequest):
    """Toggles the favorite status of a variant. Favorited variants won't be auto-deleted when limit is reached."""
    try:
        updated_script = pipeline.toggle_variant_favorite(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.is_favorited,
            request.generation_type
        )
        return get_project(script_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/projects/{script_id}/model_settings", response_model=Script)
def update_model_settings(script_id: str, request: UpdateModelSettingsRequest):
    """Updates project's model settings for T2I/I2I/I2V and aspect ratios."""
    try:
        updated_script = pipeline.update_model_settings(
            script_id,
            request.t2i_model,
            request.i2i_model,
            request.i2v_model,
            r2v_model=request.r2v_model,
            character_aspect_ratio=request.character_aspect_ratio,
            scene_aspect_ratio=request.scene_aspect_ratio,
            prop_aspect_ratio=request.prop_aspect_ratio,
            storyboard_aspect_ratio=request.storyboard_aspect_ratio,
            image_model=request.image_model,
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UpdatePromptConfigRequest(BaseModel):
    storyboard_polish: str = ""
    video_polish: str = ""
    r2v_polish: str = ""
    entity_extraction: str = ""
    style_analysis: str = ""
    storyboard_extraction: str = ""
    polish_model: Optional[str] = None


@app.get("/projects/{script_id}/prompt_config")
def get_prompt_config(script_id: str):
    """Returns project prompt_config and system default prompts for reference."""
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        config = script.prompt_config if hasattr(script, 'prompt_config') else PromptConfig()
        return {
            "prompt_config": config.model_dump(),
            "defaults": {
                "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
                "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
                "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
                "storyboard_extraction": DEFAULT_STORYBOARD_EXTRACTION_PROMPT,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/projects/{script_id}/prompt_config")
def update_prompt_config(script_id: str, request: UpdatePromptConfigRequest):
    """Updates project custom prompt configuration. Empty string = use system default."""
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        existing = getattr(script, "prompt_config", None)
        script.prompt_config = PromptConfig(
            storyboard_polish=request.storyboard_polish,
            video_polish=request.video_polish,
            r2v_polish=request.r2v_polish,
            entity_extraction=request.entity_extraction,
            style_analysis=request.style_analysis,
            storyboard_extraction=request.storyboard_extraction,
            polish_model=request.polish_model if request.polish_model is not None else (existing.polish_model if existing else ""),
        )
        pipeline._save_data()
        return {"prompt_config": script.prompt_config.model_dump()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/prompt_defaults")
def get_prompt_defaults():
    """Return the built-in default system prompts for all configurable prompt keys.

    The frontend uses this to pre-fill the prompt fields and to compute the
    "delta" on save (a field equal to its default is stored as "" so the
    built-in default is used instead of pinning a snapshot).
    """
    return {
        "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
        "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
        "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
        "entity_extraction": DEFAULT_ENTITY_EXTRACTION_PROMPT,
        "style_analysis": DEFAULT_STYLE_ANALYSIS_PROMPT,
        "storyboard_extraction": DEFAULT_STORYBOARD_EXTRACTION_PROMPT,
    }


class BindVoiceRequest(BaseModel):
    voice_id: str
    voice_name: str


@app.post("/projects/{script_id}/characters/{char_id}/voice", response_model=Script)
def bind_voice(script_id: str, char_id: str, request: BindVoiceRequest):
    """Binds a voice to a character."""
    try:
        updated_script = pipeline.bind_voice(script_id, char_id, request.voice_id, request.voice_name)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UpdateVoiceParamsRequest(BaseModel):
    speed: float = 1.0
    pitch: float = 1.0
    volume: int = 50


@app.put("/projects/{script_id}/characters/{char_id}/voice_params", response_model=Script)
def update_voice_params(script_id: str, char_id: str, request: UpdateVoiceParamsRequest):
    """Updates voice parameters for a character."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    char = next((c for c in script.characters if c.id == char_id), None)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    char.voice_speed = request.speed
    char.voice_pitch = request.pitch
    char.voice_volume = request.volume
    pipeline._save_data()
    return signed_response(script)


@app.get("/voices")
def get_voices():
    """Returns list of available voices."""
    from ...audio.uniart_tts import UniArtTTSError
    try:
        return pipeline.audio_generator.get_available_voices()
    except UniArtTTSError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None


class VoicePreviewRequest(BaseModel):
    """PR-3g #3 · request shape for /voice/preview endpoint.

    Backs the Voice picker modal's inline ▶ button. Frontend hits this
    when user previews a voice card; backend either returns a cached
    URL or generates fresh audio via TTSProcessor.
    """
    voice_id: str
    text: str
    speed: float = 1.0
    pitch: float = 1.0
    volume: int = 50
    instructions: Optional[str] = None


@app.post("/voice/preview")
def voice_preview(request: VoicePreviewRequest):
    """Owner-scoped UniArt preview; no global SDK credentials or shared cache."""
    from ...audio.uniart_tts import UniArtTTSError
    if not pipeline.audio_generator.tts:
        raise HTTPException(status_code=503, detail="UniArt 语音服务不可用。")
    try:
        return signed_response(pipeline.audio_generator.tts.preview(
            output_root=pipeline.output_root, text=request.text, voice=request.voice_id,
            speech_rate=request.speed, pitch_rate=request.pitch, volume=request.volume,
            instructions=request.instructions,
        ))
    except UniArtTTSError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None


# ─────────────────────────────────────────────────────────────
# PR-3h · Voice clone endpoints
# Per Q16: series-level scope for custom voices. Frontend uploads audio
# via existing /upload (gets URL), then calls /voice/clone with that URL.
# ─────────────────────────────────────────────────────────────

class VoiceCloneRequest(BaseModel):
    """PR-3h request: clone a voice from a reference audio URL.

    Frontend pre-validates: ≤10MB, MP3/WAV/M4A, ≥16kHz, 10-20s recommended.
    """
    series_id: str
    audio_url: str
    label: str
    target_model: str = "cosyvoice-v3.5-plus"


@app.post("/voice/clone")
def voice_clone(request: VoiceCloneRequest):
    raise HTTPException(status_code=409, detail="UniArt 网关暂未接入音色复刻与音色设计，请选择系统音色。")


@app.get("/series/{series_id}/custom_voices")
def list_series_custom_voices(series_id: str):
    """Return all custom voices (clones + designs) in a series."""
    voices = pipeline.list_custom_voices(series_id)
    return signed_response(voices)


@app.delete("/series/{series_id}/custom_voices/{voice_id}")
def delete_series_custom_voice(series_id: str, voice_id: str):
    """Remove a custom voice from a series.

    Note: does NOT delete on dashscope side (24h retention is best-effort).
    If a character has this voice_id bound, the binding becomes orphaned
    (frontend should warn before delete in v2).
    """
    removed = pipeline.delete_custom_voice(series_id, voice_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Custom voice not found")
    return signed_response({"removed": True})


# ─────────────────────────────────────────────────────────────
# PR-3i · Voice design endpoints
# Iterative pattern: preview → (tweak prompt) → preview → accept.
# Each preview mints a NEW voice on dashscope; only accept persists.
# ─────────────────────────────────────────────────────────────

class VoiceDesignPreviewRequest(BaseModel):
    voice_prompt: str
    preview_text: str = "你好，这是一段音色测试。请仔细听一听是否符合预期。"
    target_model: str = "cosyvoice-v3.5-plus"


@app.post("/voice/design/preview")
def voice_design_preview(request: VoiceDesignPreviewRequest):
    raise HTTPException(status_code=409, detail="UniArt 网关暂未接入音色复刻与音色设计，请选择系统音色。")


class VoiceDesignSaveRequest(BaseModel):
    series_id: str
    voice_id: str
    voice_prompt: str
    label: str
    target_model: str = "cosyvoice-v3.5-plus"


@app.post("/voice/design/accept")
def voice_design_accept(request: VoiceDesignSaveRequest):
    raise HTTPException(status_code=409, detail="UniArt 网关暂未接入音色复刻与音色设计，请选择系统音色。")


class VoiceDesignTranslateRequest(BaseModel):
    description: str


@app.post("/voice/design/translate")
def voice_design_translate(request: VoiceDesignTranslateRequest):
    raise HTTPException(status_code=409, detail="UniArt 网关暂未接入音色复刻与音色设计，请选择系统音色。")


class GenerateLineAudioRequest(BaseModel):
    speed: float = 1.0
    pitch: float = 1.0
    volume: int = 50
    instructions: Optional[str] = None  # PR-3j · chip emotion + free text


@app.post("/projects/{script_id}/frames/{frame_id}/audio", response_model=Script)
def generate_line_audio(script_id: str, frame_id: str, request: GenerateLineAudioRequest):
    """Generates audio for a specific frame with parameters."""
    try:
        updated_script = pipeline.generate_dialogue_line(
            script_id, frame_id,
            request.speed, request.pitch, request.volume,
            instructions=request.instructions,
        )
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# PR-3k · Audio mix endpoints (BGM presets + per-script mix settings)
# Backs the Assembly Mix phase.
# ─────────────────────────────────────────────────────────────

@app.get("/bgm/presets")
def list_bgm_presets():
    """Return the BGM preset catalog. UI populates the Mix phase picker."""
    from .audio import get_bgm_presets
    return get_bgm_presets()


class AudioMixRequest(BaseModel):
    bgm_url: Optional[str] = None  # null clears bgm
    dialogue_volume: Optional[int] = None  # 0-100
    bgm_volume: Optional[int] = None
    sfx_volume: Optional[int] = None


@app.put("/projects/{script_id}/audio_mix", response_model=Script)
def update_audio_mix(script_id: str, request: AudioMixRequest):
    """Set BGM + per-track mix levels for the final merge.

    PATCH-style: only fields explicitly present in the request body are
    applied. Using `model_fields_set` (Pydantic v2) lets us distinguish
    "omitted" from "explicit null" — clients pass `bgm_url: null` to clear
    the BGM, which the old `is not None` check silently swallowed.
    """
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    fields_set = request.model_fields_set
    if "bgm_url" in fields_set:
        script.bgm_url = request.bgm_url or None  # null and "" both clear
    mix = dict(script.mix_settings or {"dialogue": 100, "bgm": 35, "sfx": 60})
    if "dialogue_volume" in fields_set and request.dialogue_volume is not None:
        mix["dialogue"] = max(0, min(100, request.dialogue_volume))
    if "bgm_volume" in fields_set and request.bgm_volume is not None:
        mix["bgm"] = max(0, min(100, request.bgm_volume))
    if "sfx_volume" in fields_set and request.sfx_volume is not None:
        mix["sfx"] = max(0, min(100, request.sfx_volume))
    script.mix_settings = mix
    pipeline._save_data()
    return signed_response(script)


class DubPreviewRequest(BaseModel):
    video_task_id: str
    offset_ms: int = 0


@app.post("/projects/{script_id}/frames/{frame_id}/dub/preview")
def preview_dub(script_id: str, frame_id: str, request: DubPreviewRequest):
    """Generate a preview dub (cached Demucs + fast adelay+amix+mux)."""
    try:
        updated_script = pipeline.preview_dub(
            script_id, frame_id,
            video_task_id=request.video_task_id,
            offset_ms=request.offset_ms,
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/frames/{frame_id}/dub/apply")
def apply_dub(script_id: str, frame_id: str):
    """Promote current preview to official dubbed video."""
    try:
        updated_script = pipeline.apply_dub(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/projects/{script_id}/frames/{frame_id}/dub")
def revert_frame_dub(script_id: str, frame_id: str):
    """Revert dubbing — remove dubbed+preview, keep bg cache."""
    try:
        updated_script = pipeline.revert_dub(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/projects/{script_id}/dialogue_audio/batch")
def generate_dialogue_audio_batch(script_id: str):
    """PR-3j · Generate audio for every frame that has dialogue.

    Idempotent re-use: frames whose audio is already up-to-date (matching
    text/voice/instructions hash) are skipped. Stale + missing frames get
    regenerated using each character's bound voice.

    Returns the updated script plus _batch_stats with generated/skipped/failed counts.
    """
    from .audio import dialogue_audio_is_stale
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")
        char_lookup = {c.id: c for c in script.characters}
        char_name_lookup = {c.name.strip().lower(): c for c in script.characters}
        generated = 0
        skipped = 0
        failed = 0
        no_voice = 0
        for frame in script.frames:
            dialogue_text = (
                (frame.dialogue_structured.line if hasattr(frame, 'dialogue_structured') and frame.dialogue_structured else None)
                or frame.dialogue
            )
            if not dialogue_text:
                continue
            speaker = None
            if frame.character_ids:
                speaker = char_lookup.get(frame.character_ids[0])
            speaker_name = frame.speaker or (
                frame.dialogue_structured.speaker if frame.dialogue_structured else None
            )
            if not speaker and speaker_name:
                key = speaker_name.strip().lower()
                speaker = char_name_lookup.get(key)
                if not speaker:
                    for name, char in char_name_lookup.items():
                        if key in name or name in key:
                            speaker = char
                            break
            if not speaker or not speaker.voice_id:
                no_voice += 1
                continue
            if frame.audio_url and not dialogue_audio_is_stale(frame, speaker):
                skipped += 1
                continue
            try:
                updated = pipeline.generate_dialogue_line(script_id, frame.id)
                result = next((item for item in updated.frames if item.id == frame.id), None)
                if result and result.status == GenerationStatus.COMPLETED and result.audio_url and not result.audio_error:
                    generated += 1
                else:
                    failed += 1
            except Exception as exc:
                logger.error(f"[batch_dialogue_audio] frame={frame.id} error={exc}")
                failed += 1
        logger.info(f"[batch_dialogue_audio] script={script_id} generated={generated} skipped={skipped} failed={failed} no_voice={no_voice}")
        script = pipeline.get_script(script_id)
        response_data = script.model_dump() if hasattr(script, 'model_dump') else script.dict()
        response_data["_batch_stats"] = {"generated": generated, "skipped": skipped, "failed": failed, "no_voice": no_voice}
        return signed_response(response_data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/mix/generate_sfx", response_model=Script)
def generate_mix_sfx(script_id: str):
    """Triggers Video-to-Audio SFX generation for all frames."""
    # Re-using generate_audio for now as it covers everything, 
    # but ideally we'd have granular methods in pipeline.
    # Let's just call generate_audio again, it's idempotent-ish.
    try:
        updated_script = pipeline.generate_audio(script_id)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/mix/generate_bgm", response_model=Script)
def generate_mix_bgm(script_id: str):
    """Triggers BGM generation."""
    try:
        updated_script = pipeline.generate_audio(script_id)
        return signed_response(updated_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ToggleFrameLockRequest(BaseModel):
    frame_id: str


@app.post("/projects/{script_id}/frames/toggle_lock", response_model=Script)
def toggle_frame_lock(script_id: str, request: ToggleFrameLockRequest):
    """Toggles the locked status of a frame."""
    try:
        updated_script = pipeline.toggle_frame_lock(
            script_id,
            request.frame_id
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UpdateFrameRequest(BaseModel):
    frame_id: str
    image_prompt: Optional[str] = None
    action_description: Optional[str] = None
    workbench_prompt_is_optimized: Optional[bool] = None
    dialogue: Optional[str] = None
    camera_angle: Optional[str] = None
    scene_id: Optional[str] = None
    character_ids: Optional[List[str]] = None
    crowd_instances: Optional[List[ExtraShotInstance]] = None
    duration: Optional[int] = None
    shot_size: Optional[str] = None
    camera_movement_description: Optional[str] = None
    transition_hint: Optional[str] = None
    style_prompt_override: Optional[str] = None
    lighting_override: Optional[str] = None
    negative_prompt_override: Optional[str] = None
    move_ref: Optional[str] = None
    move_variant: Optional[str] = None
    performance_moves: Optional[List[Dict[str, Any]]] = None
    reference_package: Optional[StoryboardReferencePackage] = None

@app.post("/projects/{script_id}/frames/update", response_model=Script)
def update_frame(script_id: str, request: UpdateFrameRequest):
    """Updates frame data (prompt, scene, characters, etc.)."""
    try:
        updated_script = pipeline.update_frame(
            script_id,
            request.frame_id,
            image_prompt=request.image_prompt,
            action_description=request.action_description,
            workbench_prompt_is_optimized=request.workbench_prompt_is_optimized,
            dialogue=request.dialogue,
            camera_angle=request.camera_angle,
            scene_id=request.scene_id,
            character_ids=request.character_ids,
            crowd_instances=request.crowd_instances,
            duration=request.duration,
            shot_size=request.shot_size,
            camera_movement_description=request.camera_movement_description,
            transition_hint=request.transition_hint,
            style_prompt_override=request.style_prompt_override,
            lighting_override=request.lighting_override,
            negative_prompt_override=request.negative_prompt_override,
            move_ref=request.move_ref,
            move_variant=request.move_variant,
            performance_moves=request.performance_moves,
            reference_package=request.reference_package,
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class AddFrameRequest(BaseModel):
    scene_id: Optional[str] = None
    action_description: str = ""
    camera_angle: str = "medium_shot"
    insert_at: Optional[int] = None

@app.post("/projects/{script_id}/frames", response_model=Script)
def add_frame(script_id: str, request: AddFrameRequest):
    """Adds a new storyboard frame."""
    try:
        updated_script = pipeline.add_frame(
            script_id, 
            request.scene_id, 
            request.action_description, 
            request.camera_angle,
            request.insert_at
        )
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/projects/{script_id}/frames/{frame_id}", response_model=Script)
def delete_frame(script_id: str, frame_id: str):
    """Deletes a storyboard frame."""
    try:
        updated_script = pipeline.delete_frame(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class CopyFrameRequest(BaseModel):
    frame_id: str
    insert_at: Optional[int] = None

@app.post("/projects/{script_id}/frames/copy", response_model=Script)
def copy_frame(script_id: str, request: CopyFrameRequest):
    """Copies a storyboard frame."""
    try:
        updated_script = pipeline.copy_frame(script_id, request.frame_id, request.insert_at)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ReorderFramesRequest(BaseModel):
    frame_ids: List[str]

@app.put("/projects/{script_id}/frames/reorder", response_model=Script)
def reorder_frames(script_id: str, request: ReorderFramesRequest):
    """Reorders storyboard frames."""
    try:
        updated_script = pipeline.reorder_frames(script_id, request.frame_ids)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class RenderFrameRequest(BaseModel):
    frame_id: str
    composition_data: Optional[Dict[str, Any]] = None
    prompt: str
    negative_prompt: Optional[str] = None
    batch_size: int = 1
    prompt_is_complete: bool = False
    context_token: Optional[str] = None


class RenderFrameJobRequest(RenderFrameRequest):
    request_id: str


class RenderFramePreviewRequest(BaseModel):
    frame_id: str
    prompt: str
    negative_prompt: Optional[str] = None
    slot: Literal["first", "last"] = "first"

class RenderFrameCandidateRequest(BaseModel):
    frame_id: str
    prompt: str
    negative_prompt: Optional[str] = None
    context_token: str


@app.post("/projects/{script_id}/storyboard/render-candidate-preview")
def preview_frame_candidate(script_id: str, request: RenderFramePreviewRequest,
                            user: UserContext = Depends(require_studio_user)):
    """Show the exact candidate prompt and effective settings before rendering."""
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    frame = next((item for item in script.frames if item.id == request.frame_id), None)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    if not request.prompt.strip():
        raise HTTPException(status_code=422, detail="Storyboard prompt cannot be empty")
    try:
        before = pipeline.storyboard_render_context_token(script_id, request.frame_id)
        candidate_prompt = pipeline.preview_storyboard_candidate_prompt(
            script_id, request.frame_id, request.prompt, slot=request.slot,
        )
        if before != pipeline.storyboard_render_context_token(script_id, request.frame_id):
            raise HTTPException(status_code=409, detail="镜头内容已变化，请重新预览首尾帧输入")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    series = pipeline.series_store.get(script.series_id) if script.series_id else None
    assets = pipeline.resolve_project_assets(script)
    character_assets = {item.id: item for item in assets["characters"]}
    scene_assets = {item.id: item for item in assets["scenes"]}
    selected_assets = pipeline.resolve_storyboard_asset_selection(script_id, frame.id)["assets"]
    reference_labels = []
    for item_id in frame.character_ids:
        character = character_assets.get(item_id)
        if not character:
            reference_labels.append(f"{item_id}（素材未找到）")
            continue
        selected = next((item for item in selected_assets
                         if item["asset_type"] == "character" and item["asset_id"] == item_id), None)
        reference_labels.append(f"{character.name}（{'已选参考图' if selected and selected.get('variant_id') else '无参考图'}）")
    if frame.scene_id:
        scene_asset = scene_assets.get(frame.scene_id)
        selected = next((item for item in selected_assets
                         if item["asset_type"] == "scene" and item["asset_id"] == frame.scene_id), None)
        reference_labels.append(f"{scene_asset.name if scene_asset else '场景'}（{'已选参考图' if selected and selected.get('variant_id') else '无参考图'}）")
    from .assets import ASPECT_RATIO_TO_SIZE
    return {
        "prompt": candidate_prompt,
        "negative_prompt": request.negative_prompt or "",
        "model": series.model_settings.i2i_model if series else script.model_settings.i2i_model,
        "aspect_ratio": script.model_settings.storyboard_aspect_ratio,
        "size": ASPECT_RATIO_TO_SIZE.get(script.model_settings.storyboard_aspect_ratio, "1024*576"),
        "character_ids": frame.character_ids,
        "scene_id": frame.scene_id,
        "reference_asset_labels": reference_labels,
        "source_label": pipeline.storyboard_render_scene_design_source(script_id, request.frame_id),
        "polish_review": pipeline.storyboard_image_polish_review(script_id, request.frame_id, request.prompt),
        "context_token": pipeline.storyboard_candidate_preview_token(
            script_id, request.frame_id, candidate_prompt, request.negative_prompt,
        ),
    }

@app.post("/projects/{script_id}/storyboard/render-candidate")
def render_frame_candidate(script_id: str, request: RenderFrameCandidateRequest,
                           user: UserContext = Depends(require_studio_user)):
    """Render an isolated first/last-frame candidate without changing the
    Storyboard frame's canonical image fields."""
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if not any(item.id == request.frame_id for item in script.frames):
        raise HTTPException(status_code=404, detail="Frame not found")
    try:
        url = pipeline.generate_storyboard_candidate(
            script_id, request.frame_id, request.prompt, request.negative_prompt,
            context_token=request.context_token,
        )
        return {"image_url": url}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error rendering storyboard candidate %s", request.frame_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/projects/{script_id}/storyboard/render-preview")
def preview_render_frame(script_id: str, request: RenderFramePreviewRequest,
                         user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        before = pipeline.storyboard_render_context_token(script_id, request.frame_id)
        prompt = pipeline.preview_storyboard_render_prompt(script_id, request.frame_id, request.prompt)
        source_label = pipeline.storyboard_render_scene_design_source(script_id, request.frame_id)
        omitted_plan_lighting = pipeline.storyboard_render_omitted_plan_lighting(script_id, request.frame_id)
        polish_review = pipeline.storyboard_image_polish_review(script_id, request.frame_id, request.prompt)
        after = pipeline.storyboard_render_context_token(script_id, request.frame_id)
        if before != after:
            raise HTTPException(status_code=409, detail="Storyboard render preview is outdated; preview the current frame again")
        return {
            "prompt": prompt,
            "context_token": pipeline.storyboard_render_preview_token(after, prompt, request.negative_prompt),
            "source_label": source_label,
            "omitted_plan_lighting": omitted_plan_lighting,
            "polish_review": polish_review,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/projects/{script_id}/storyboard/render-jobs", status_code=202)
def start_render_frame_job(script_id: str, request: RenderFrameJobRequest,
                           user: UserContext = Depends(require_studio_user)):
    """Submit a storyboard render without holding the browser connection open."""
    import hashlib

    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if not any(frame.id == request.frame_id for frame in script.frames):
        raise HTTPException(status_code=404, detail="Frame not found")
    if not request.request_id or len(request.request_id) > 128:
        raise HTTPException(status_code=422, detail="Invalid request id")
    if request.context_token:
        try:
            current_token = pipeline.storyboard_render_context_token(script_id, request.frame_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        expected = pipeline.storyboard_render_preview_token(current_token, request.prompt, request.negative_prompt)
        if not request.prompt_is_complete or request.context_token != expected:
            raise HTTPException(status_code=409, detail="Storyboard render preview is outdated; preview the current frame again")
    fingerprint = hashlib.sha256(json.dumps({
        "request_id": request.request_id,
        "frame_id": request.frame_id,
        "composition_data": request.composition_data,
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt,
        "batch_size": request.batch_size,
        "prompt_is_complete": request.prompt_is_complete,
        "context_token": request.context_token,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def work():
        logger.info("Rendering frame %s", request.frame_id)
        pipeline.generate_storyboard_render(
            script_id, request.frame_id, request.composition_data,
            request.prompt, request.batch_size, request.negative_prompt,
            prompt_is_complete=request.prompt_is_complete,
            context_token=request.context_token,
        )
        return {"frame_id": request.frame_id}

    job = extraction_jobs.start(
        user.owner_profile_id, f"{script_id}:{request.frame_id}",
        f"storyboard-render:{fingerprint}", work, reuse_running=True,
    )
    return {"job_id": job["id"], "status": job["status"], "error": job.get("error")}


@app.get("/projects/{script_id}/storyboard/render-jobs/{job_id}")
def render_frame_status(script_id: str, job_id: str,
                        user: UserContext = Depends(require_studio_user)):
    script = pipeline.get_script(script_id, user.owner_profile_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    job = extraction_jobs.get_for_project_prefix(
        user.owner_profile_id, script_id, job_id, "storyboard-render:",
    )
    return {"job_id": job["id"], "status": job["status"], "error": job.get("error")}


@app.post("/projects/{script_id}/storyboard/render", response_model=Script)
def render_frame(script_id: str, request: RenderFrameRequest):
    """Legacy synchronous rendering contract for other storyboard surfaces."""
    try:
        updated_script = pipeline.generate_storyboard_render(
            script_id, request.frame_id, request.composition_data,
            request.prompt, request.batch_size, request.negative_prompt,
            prompt_is_complete=request.prompt_is_complete,
            context_token=request.context_token,
        )
        return signed_response(updated_script)
    except ValueError as e:
        if "preview is outdated" in str(e):
            raise HTTPException(status_code=409, detail=str(e)) from e
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Error rendering frame %s", request.frame_id)
        raise HTTPException(status_code=500, detail=str(e))


class SelectVideoRequest(BaseModel):
    video_id: str


@app.post("/projects/{script_id}/frames/{frame_id}/select_video", response_model=Script)
def select_video(script_id: str, frame_id: str, request: SelectVideoRequest):
    """Selects a video variant for a specific frame."""
    try:
        updated_script = pipeline.select_video_for_frame(script_id, frame_id, request.video_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/frames/{frame_id}/auto_select_latest_video", response_model=Script)
def auto_select_latest_video(script_id: str, frame_id: str):
    """Auto-pick the latest completed video as this frame's active take.

    Idempotent; skipped when the frame is pinned (is_video_pinned=True).
    Frontend calls this on every task-completion poll so the freshly
    generated take surfaces on the hero — unless the user has explicitly
    pinned a different take.
    """
    try:
        updated_script = pipeline.auto_select_latest_video(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/frames/{frame_id}/unpin_video", response_model=Script)
def unpin_video(script_id: str, frame_id: str):
    """Clear the manual pin; auto_select_latest_video resumes on next poll.

    Leaves selected_video_id / video_url untouched — the user keeps seeing
    the current take until a new generation produces a newer completed
    task.
    """
    try:
        updated_script = pipeline.unpin_video(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ExtractLastFrameRequest(BaseModel):
    video_task_id: str


@app.post("/projects/{script_id}/frames/{frame_id}/extract_last_frame")
def extract_last_frame(script_id: str, frame_id: str, request: ExtractLastFrameRequest):
    """Extract the last frame from a completed video and add it as a variant to the frame's rendered_image_asset."""
    try:
        updated_script = pipeline.extract_last_frame(script_id, frame_id, request.video_task_id)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception(f"Error extracting last frame: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/frames/{frame_id}/upload_image")
def upload_frame_image(
    script_id: str,
    frame_id: str,
    file: UploadFile = File(...),
    user: UserContext = Depends(require_studio_user),
):
    """Upload an image as a variant for a frame's rendered_image_asset."""
    try:
        # Save file locally first
        file_ext = _safe_upload_ext(file.filename)
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path, _stored_path = _studio_upload_target(user, filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        updated_script = pipeline.upload_frame_image(script_id, frame_id, file_path)
        return signed_response(updated_script)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Error uploading frame image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Issue 10: T2I 首帧 upload — uploaded image is appended to the frame's
# t2i_image_urls history and becomes the active首帧 immediately, unlocking
# Step 2 (I2V generation). Whitelisted formats + 8 MB cap reflect that this
# is a user-facing creator upload, not an arbitrary file store.
_T2I_UPLOAD_MAX_BYTES = 8 * 1024 * 1024
_T2I_UPLOAD_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


class AttachAssetFrameRequest(BaseModel):
    scope: Literal["project", "series"]
    container_id: str
    asset_type: Literal["character", "scene", "prop"]
    asset_id: str
    variant_id: str
    slot: Literal["first", "last"] = "first"


@app.post("/projects/{script_id}/frames/{frame_id}/attach_asset_frame")
def attach_asset_frame(
    script_id: str,
    frame_id: str,
    request: AttachAssetFrameRequest,
    user: UserContext = Depends(require_studio_user),
):
    """Attach an owned asset by durable identity, never by its delivery URL."""
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(status_code=404, detail="Project not found")
    index = pipeline.get_asset_reference_index(script_id, scope="project")
    scope = "episode" if request.scope == "project" else request.scope
    entry = next((item for item in index.assets
                  if item.asset_type == request.asset_type and item.asset_id == request.asset_id
                  and item.source_scope == scope and item.source_container_id == request.container_id), None)
    variant = next((item for item in entry.variants if item.id == request.variant_id), None) if entry else None
    if not variant:
        raise HTTPException(status_code=404, detail="Asset variant not found in this project")
    stored = image_variant_storage_key(variant)
    if not stored:
        raise HTTPException(status_code=404, detail="Asset image not found")
    copied_path = None
    if is_object_key(stored) or stored.startswith(("http://", "https://")):
        # A managed cloud key is already durable. Reject external/disabled
        # storage through the same owner delivery boundary as asset viewing.
        if stored.startswith(("http://", "https://")):
            stored = managed_object_key_from_url(stored, OSSImageUploader())
            if not stored:
                raise HTTPException(status_code=422, detail="External asset image is not managed")
        _owned_media_delivery_url(stored, user.owner_profile_id)
    else:
        if storage_backend() != "local":
            raise HTTPException(status_code=404, detail="Asset is outside the active storage")
        try:
            source = pipeline._resolve_stored_reference_value(stored, user.owner_profile_id)
        except InvalidAssetReference as exc:
            raise HTTPException(status_code=404, detail="Asset image not found") from exc
        ext = os.path.splitext(source)[1].lower()
        if ext not in _T2I_UPLOAD_ALLOWED_EXTS or os.path.getsize(source) > 64 * 1024 * 1024:
            raise HTTPException(status_code=415, detail="Asset image format or size is unsupported")
        copied_path, stored = _studio_upload_target(user, f"{request.slot}_asset_{uuid.uuid4().hex}{ext}")
        try:
            shutil.copyfile(source, copied_path)
        except OSError:
            if os.path.exists(copied_path):
                os.unlink(copied_path)
            raise HTTPException(status_code=503, detail="Asset image could not be copied") from None
    try:
        frame = (pipeline.upload_last_frame if request.slot == "last" else pipeline.upload_t2i_frame)(
            script_id, frame_id, stored,
        )
        if frame is None:
            raise HTTPException(status_code=404, detail="Frame not found")
    except Exception:
        if copied_path and os.path.exists(copied_path):
            os.unlink(copied_path)
        raise
    return signed_response(frame)


@app.post("/projects/{script_id}/frames/{frame_id}/upload_t2i")
async def upload_t2i_frame(
    script_id: str,
    frame_id: str,
    file: UploadFile = File(...),
    slot: Literal["first", "last"] = "first",
    user: UserContext = Depends(require_studio_user),
):
    """Upload an external image as a T2I首帧 candidate for an I2V flow.

    Validation:
      - ≤ 8 MB (rejected with 413 to differentiate from validation 400)
      - jpg/jpeg/png/webp only (rejected with 415)

    On success, returns the updated StoryboardFrame so the client can read
    back `t2i_image_urls` and `t2i_selected_index` without an extra round-
    trip. The uploaded image becomes the active首帧 (auto-selected).
    """
    try:
        original_name = (file.filename or "").strip()
        if not original_name:
            raise HTTPException(status_code=400, detail="No filename provided")
        ext = os.path.splitext(original_name)[1].lower()
        if ext not in _T2I_UPLOAD_ALLOWED_EXTS:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type {ext!r}. Allowed: {sorted(_T2I_UPLOAD_ALLOWED_EXTS)}",
            )

        # Stream-to-disk with explicit byte cap so we never load >8 MB
        # into memory if a client lies about Content-Length.
        filename = f"{slot}_frame_{uuid.uuid4().hex}{ext}"
        abs_path, rel_path = _studio_upload_target(user, filename)
        size = 0
        try:
            with open(abs_path, "wb") as buffer:
                while chunk := await file.read(64 * 1024):
                    size += len(chunk)
                    if size > _T2I_UPLOAD_MAX_BYTES:
                        buffer.close()
                        os.unlink(abs_path)
                        raise HTTPException(
                            status_code=413,
                            detail=f"File exceeds {_T2I_UPLOAD_MAX_BYTES // (1024 * 1024)} MB limit",
                        )
                    buffer.write(chunk)
        except HTTPException:
            raise
        except Exception as e:
            # Clean up partial file on any unexpected error
            if os.path.exists(abs_path):
                try:
                    os.unlink(abs_path)
                except OSError:
                    pass
            raise HTTPException(status_code=500, detail=f"Upload write failed: {e}")

        # `pipeline.upload_t2i_frame` synchronously serializes + writes the
        # whole projects.json (~50-500KB) — wrap in to_thread so we don't
        # block the event loop for the ~50ms write. Matches the pattern
        # used by create_project / reparse_project / analyze_script_for_styles.
        loop = asyncio.get_event_loop()
        frame = await loop.run_in_executor(
            None,
            partial(pipeline.upload_last_frame if slot == "last" else pipeline.upload_t2i_frame, script_id, frame_id, rel_path),
        )
        if frame is None:
            # Roll back the file — frame/script gone, no reference will exist
            if os.path.exists(abs_path):
                try:
                    os.unlink(abs_path)
                except OSError:
                    pass
            raise HTTPException(status_code=404, detail="Script or frame not found")
        return signed_response(frame)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("upload_t2i_frame unexpected error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/merge", response_model=Script)
def merge_videos(script_id: str):
    """Merge all selected frame videos into final output"""
    import traceback
    try:
        merged_script = pipeline.merge_videos(script_id)
        return signed_response(merged_script)
    except ValueError as e:
        # Known validation errors (no videos, etc.)
        logger.error(f"[MERGE ERROR] Validation failed: {e}")
        logger.exception("An error occurred")
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # FFmpeg or processing errors
        logger.error(f"[MERGE ERROR] Runtime error: {e}")
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[MERGE ERROR] Unexpected error: {e}")
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")


# ===== Export Endpoint =====

class ExportRequest(BaseModel):
    resolution: str = "1080p"
    format: str = "mp4"
    subtitles: str = "none"

@app.post("/projects/{script_id}/export")
def export_project(script_id: str, request: ExportRequest):
    """Export project video by merging all selected frame videos.

    Currently delegates to the existing merge_videos pipeline.
    resolution/format/subtitles parameters are accepted but not yet applied
    (requires FFmpeg pipeline iteration).
    """
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")

        # If already merged, return existing URL directly
        if script.merged_video_url:
            return signed_response({"url": script.merged_video_url})

        # Otherwise, run merge pipeline
        merged_script = pipeline.merge_videos(script_id)
        return signed_response({"url": merged_script.merged_video_url})
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[EXPORT ERROR] {e}")
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


# ===== Art Direction Endpoints =====

class AnalyzeStyleRequest(BaseModel):
    script_text: str


class SaveArtDirectionRequest(BaseModel):
    selected_style_id: str
    style_config: Dict[str, Any]
    custom_styles: List[Dict[str, Any]] = []
    ai_recommendations: List[Dict[str, Any]] = []


def _freeze_director_skills(stage, request):
    try:
        return director_skills.freeze(stage, request.skills)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/projects/{script_id}/director-skills/{stage}")
def get_project_director_skills(script_id: str, stage: director_skills.Stage,
                                user: UserContext = Depends(require_studio_user)):
    if stage == "series":
        raise HTTPException(422, "Use the series scope for series Skills")
    if not pipeline.get_script(script_id):
        raise HTTPException(404, "Project not found")
    return {"catalog": [{k: v for k, v in task.items() if k != "instructions"} for task in director_skills.catalog(stage)],
            "skills": director_skills.preferences(user.owner_profile_id, "project:" + script_id, stage)}


@app.put("/projects/{script_id}/director-skills/{stage}")
def save_project_director_skills(script_id: str, stage: director_skills.Stage,
                                 request: director_skills.DirectorSkillsRequest,
                                 user: UserContext = Depends(require_studio_user)):
    if stage == "series":
        raise HTTPException(422, "Use the series scope for series Skills")
    if not pipeline.get_script(script_id):
        raise HTTPException(404, "Project not found")
    _freeze_director_skills(stage, request)
    return {"skills": director_skills.preferences(user.owner_profile_id, "project:" + script_id, stage, request.skills)}


@app.get("/series/{series_id}/director-skills")
def get_series_director_skills(series_id: str, user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_series(series_id):
        raise HTTPException(404, "Series not found")
    return {"catalog": [{k: v for k, v in task.items() if k != "instructions"} for task in director_skills.catalog("series")],
            "skills": director_skills.preferences(user.owner_profile_id, "series:" + series_id, "series")}


@app.put("/series/{series_id}/director-skills")
def save_series_director_skills(series_id: str, request: director_skills.DirectorSkillsRequest,
                                user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_series(series_id):
        raise HTTPException(404, "Series not found")
    _freeze_director_skills("series", request)
    return {"skills": director_skills.preferences(user.owner_profile_id, "series:" + series_id, "series", request.skills)}


class DirectorProfileRefineRequest(BaseModel):
    draft: Dict[str, Any]
    instructions: List[str] = Field(min_length=1, max_length=12)


class DirectorProfileApplyRequest(BaseModel):
    draft: Dict[str, Any]
    expected_current_revision: Optional[int] = Field(None, ge=0)
    expected_draft_revision: Optional[int] = Field(None, ge=0)


class DirectorProfileDraftSaveRequest(BaseModel):
    source_revision: int = Field(..., ge=1)
    expected_draft_revision: int = Field(..., ge=0)
    draft: Dict[str, Any]
    draft_name: Optional[str] = Field(None, max_length=160)


class DirectorShootingPlanDraftSaveRequest(BaseModel):
    source_revision: int = Field(..., ge=1)
    expected_draft_revision: int = Field(..., ge=0)
    plan: DirectorShootingPlan
    allow_stale_lineage: bool = False


class DirectorShootingPlanConfirmRequest(BaseModel):
    expected_current_revision: int = Field(..., ge=0)
    expected_draft_revision: int = Field(..., ge=0)
    plan: DirectorShootingPlan
    user_title: str = Field("", max_length=160)
    summary: str = Field("", max_length=1000)
    allow_stale_lineage: bool = False


class DirectorShootingPlanRestoreRequest(BaseModel):
    expected_draft_revision: int = Field(..., ge=0)


class ScriptFactLedgerDraftRequest(BaseModel):
    source_revision: int = Field(..., ge=1)
    expected_draft_revision: int = Field(..., ge=0)
    facts: List[ScriptFactLedgerEntry] = Field(..., max_length=500)


class ScriptFactLedgerConfirmRequest(BaseModel):
    expected_revision: int = Field(..., ge=0)
    expected_draft_revision: int = Field(..., ge=0)


@app.get("/projects/{script_id}/fact-ledger")
def get_script_fact_ledger(
    script_id: str,
    source_revision: int,
    ledger_revision: Optional[int] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    user: UserContext = Depends(require_studio_user),
):
    del user  # Project ownership is enforced by enforce_studio_owner_boundary.
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return query_script_fact_ledger(script, source_revision, ledger_revision, offset, limit)


@app.get("/projects/{script_id}/fact-ledger/revisions", response_model=List[ScriptFactLedgerRevisionSummary])
def list_script_fact_ledger_revisions(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return [
        ScriptFactLedgerRevisionSummary(
            revision=item.revision,
            source_revision=item.source_revision,
            source_revision_id=item.source_revision_id,
            fact_count=len(item.facts),
            confirmed_at=item.confirmed_at,
        )
        for item in script.fact_ledger_revisions
    ]


@app.get("/projects/{script_id}/fact-ledger/draft")
def get_script_fact_ledger_draft(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return {
        "project_id": script.id,
        "draft_revision": script.fact_ledger_draft_revision,
        "source_revision": script.fact_ledger_draft_source_revision,
        "facts": [fact.model_dump() for fact in script.fact_ledger_draft],
        "updated_at": script.fact_ledger_draft_updated_at,
    }


@app.put("/projects/{script_id}/fact-ledger/draft")
def save_script_fact_ledger_draft(
    script_id: str,
    request: ScriptFactLedgerDraftRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user  # Project ownership is enforced by enforce_studio_owner_boundary.
    try:
        updated = pipeline.save_fact_ledger_draft(
            script_id,
            request.source_revision,
            request.expected_draft_revision,
            request.facts,
        )
        return {
            "project_id": updated.id,
            "draft_revision": updated.fact_ledger_draft_revision,
            "source_revision": updated.fact_ledger_draft_source_revision,
            "facts": [fact.model_dump() for fact in updated.fact_ledger_draft],
            "updated_at": updated.fact_ledger_draft_updated_at,
        }
    except ValueError as exc:
        message = str(exc)
        status = 409 if "revision changed" in message.lower() else 422
        raise HTTPException(status, message) from exc


@app.post("/projects/{script_id}/fact-ledger/confirm", response_model=Script)
def confirm_script_fact_ledger(
    script_id: str,
    request: ScriptFactLedgerConfirmRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        updated = pipeline.confirm_fact_ledger(
            script_id,
            request.expected_revision,
            request.expected_draft_revision,
            user_title=request.user_title,
            summary=request.summary,
        )
        return signed_response(updated)
    except ValueError as exc:
        message = str(exc)
        status = 409 if "revision changed" in message.lower() else 422
        raise HTTPException(status, message) from exc


@app.get("/projects/{script_id}/evidence/source")
def get_evidence_source(script_id: str, user: UserContext = Depends(require_studio_user)):
    """Return the current text fingerprint used to pin evidence queries."""
    del user  # Studio ownership is enforced by enforce_studio_owner_boundary.
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return {
        "project_id": script_id,
        "source_version": source_version(script.original_text or ""),
        "source_version_kind": "content_hash",
        "character_count": len(script.original_text or ""),
    }


@app.get("/projects/{script_id}/evidence/assets/{asset_kind}/{asset_id}")
def get_asset_evidence(
    script_id: str,
    asset_kind: Literal["character", "scene", "prop"],
    asset_id: str,
    source_version: str,
    limit: int = Query(20, ge=1, le=100),
    user: UserContext = Depends(require_studio_user),
):
    """Return source spans for a structured asset, without inferring facts."""
    del user  # Studio ownership is enforced by enforce_studio_owner_boundary.
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return query_asset_mentions(
        script, asset_kind, asset_id, source_version,
        assets=pipeline.resolve_episode_assets(script), limit=limit,
    )


def _validated_director_profile_draft(draft: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize and validate a visible Director draft before queueing work."""
    try:
        normalized = normalize_director_profile_draft(draft)
        DirectorProfile(**normalized)
    except ValidationError as exc:
        details = []
        for error in exc.errors():
            location = ".".join(str(item) for item in error.get("loc", ()))
            details.append(f"{location}: {error.get('msg', 'invalid value')}")
        message = "; ".join(details) or "invalid profile shape"
        raise HTTPException(422, f"Invalid director profile draft: {message}") from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, f"Invalid director profile draft: {exc}") from exc
    return normalized


def _director_profile_fingerprint(script_id: str, draft=None, instructions=None) -> str:
    script, entities, style = pipeline.director_analysis_context(script_id)
    llm = pipeline.script_processor.llm
    return hashlib.sha256(json.dumps([
        script.original_text, entities, style, draft, instructions,
        director_preset_identity("director-interpretation"),
        director_preset_identity("director-intent"),
        llm.provider, llm._get_default_model(),
    ], ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@app.post("/projects/{script_id}/director-profile-jobs", status_code=202)
def start_director_profile_analysis(
    script_id: str,
    request: director_skills.DirectorSkillsRequest = director_skills.DirectorSkillsRequest(),
    user: UserContext = Depends(require_studio_user),
):
    skill_snapshot = _freeze_director_skills("episode", request)
    fingerprint = _director_profile_fingerprint(script_id) + hashlib.sha256(json.dumps(skill_snapshot, sort_keys=True).encode()).hexdigest()
    return extraction_jobs.start(
        user.owner_profile_id, script_id, "director:" + fingerprint,
        lambda: {
            "profile": pipeline.preview_director_profile(script_id, skill_snapshot=skill_snapshot),
            "source_audit": getattr(pipeline, "_last_director_analysis_audit", {}),
        },
        queue_group="director",
    )


@app.post("/projects/{script_id}/director-profile-jobs/refine", status_code=202)
def start_director_profile_refinement(
    script_id: str,
    request: DirectorProfileRefineRequest,
    user: UserContext = Depends(require_studio_user),
):
    instructions = [item.strip() for item in request.instructions if item.strip()]
    if not instructions or any(len(item) > 2000 for item in instructions):
        raise HTTPException(422, "Revision instructions must contain 1-12 non-empty items of at most 2000 characters")
    draft = _validated_director_profile_draft(request.draft)
    fingerprint = _director_profile_fingerprint(script_id, draft, instructions)
    return extraction_jobs.start(
        user.owner_profile_id, script_id, "director:" + fingerprint,
        lambda: {"profile": pipeline.refine_director_profile(
            script_id, draft, instructions
        )},
        queue_policy="lifo",
        queue_group="director",
    )


@app.get("/projects/{script_id}/director-profile-jobs/{job_id}")
def director_profile_status(
    script_id: str,
    job_id: str,
    user: UserContext = Depends(require_studio_user),
):
    return extraction_jobs.get(user.owner_profile_id, script_id, job_id)


@app.get("/projects/{script_id}/director-profile/revisions", response_model=List[DirectorProfileRevision])
def list_director_profile_revisions(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """List confirmed Director snapshots without exposing transient jobs."""
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    if script.director_profile_revisions:
        return script.director_profile_revisions
    # Legacy confirmed profiles were embedded in art_direction before the
    # revision archive was introduced. Expose that immutable profile as a
    # migration snapshot without rewriting project data on read.
    legacy = script.art_direction.director_profile if script.art_direction else None
    if legacy is None:
        return []
    return [DirectorProfileRevision(
        revision=legacy.revision,
        content_hash=legacy.content_hash or "legacy-director-profile",
        profile=legacy,
        confirmed_at=legacy.confirmed_at,
        source="migration",
    )]


@app.get("/projects/{script_id}/director-profile/draft")
def get_director_profile_draft(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    draft = script.director_profile_draft
    draft_revision = script.director_profile_draft_revision
    draft_source_revision = script.director_profile_draft_source_revision
    updated_at = script.director_profile_draft_updated_at
    if draft is None:
        # Keep the pre-revision Director profile editable after upgrading an
        # existing workspace. This is a read-only compatibility projection.
        draft = script.art_direction.director_profile if script.art_direction else None
        if draft is not None:
            # The confirmed profile revision is not the optimistic-concurrency
            # revision of the separate draft resource. A migrated profile is
            # editable content backed by the real draft revision (normally 0),
            # otherwise the first save after refresh always conflicts.
            draft_revision = script.director_profile_draft_revision
            draft_source_revision = script.source_revision
            updated_at = draft.confirmed_at
    # Older drafts may already contain story-map events but empty storyline
    # and scene-summary arrays. Normalize on read as well as on save so the
    # Director editor does not require a second model submission to reveal
    # structures that can be derived from the existing events.
    if draft is not None:
        projected = normalize_director_profile_draft(draft.model_dump(exclude={
            "revision", "content_hash", "confirmed_at",
        }))
        pipeline._bind_director_story_map(
            script,
            pipeline.director_source_assets(script),
            projected,
        )
        draft_payload = projected
    else:
        draft_payload = None
    return {
        "project_id": script.id,
        "draft_revision": draft_revision,
        "source_revision": draft_source_revision,
        "draft": draft_payload,
        "updated_at": updated_at,
        "draft_name": script.director_profile_draft_name,
    }


@app.get("/series/{series_id}/director-profile")
def get_series_director_profile(
    series_id: str,
    user: UserContext = Depends(require_studio_user),
):
    """Return the Series-level Director understanding handoff."""
    del user
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(404, "Series not found")
    profile = pipeline.effective_series_director_profile(series_id)
    return {
        "series_id": series_id,
        "source_context": series.source_context,
        "profile": profile.model_dump() if profile else None,
        "style_review_required": bool(
            profile and series.director_style_hash
            and series.director_style_hash != _director_style_hash(
                series.art_direction.style_config if series.art_direction else {}
            )
        ),
        "confirmed_revisions": [item.model_dump() for item in series.director_profile_revisions],
        "draft": series.director_profile_draft.model_dump() if series.director_profile_draft else None,
        "draft_revision": series.director_profile_draft_revision,
        "draft_name": series.director_profile_draft_name,
    }


@app.post("/series/{series_id}/director-profile-jobs", status_code=202)
def start_series_director_profile_analysis(
    series_id: str,
    request: director_skills.DirectorSkillsRequest = director_skills.DirectorSkillsRequest(),
    user: UserContext = Depends(require_studio_user),
):
    skill_snapshot = _freeze_director_skills("series", request)
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(404, "Series not found")
    fingerprint = hashlib.sha256(json.dumps([
        series.source_context, skill_snapshot,
        [pipeline.get_script(item).original_text for item in series.episode_ids if pipeline.get_script(item)],
        series.characters, series.scenes, series.props,
    ], ensure_ascii=False, default=str, sort_keys=True).encode()).hexdigest()
    return extraction_jobs.start(
        user.owner_profile_id, "series:" + series_id, "series-director:" + fingerprint,
        lambda: pipeline.preview_series_director_profile(series_id, skill_snapshot=skill_snapshot),
        queue_group="series-director",
    )


@app.get("/series/{series_id}/director-profile-jobs/{job_id}")
def series_director_profile_status(
    series_id: str,
    job_id: str,
    user: UserContext = Depends(require_studio_user),
):
    return extraction_jobs.get(user.owner_profile_id, "series:" + series_id, job_id)


class SeriesDirectorProfileSaveRequest(BaseModel):
    draft: Dict[str, Any]
    draft_name: Optional[str] = None


class SeriesSourceContextSaveRequest(BaseModel):
    text: str = ""


@app.put("/series/{series_id}/source-context")
def save_series_source_context(
    series_id: str,
    request: SeriesSourceContextSaveRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        series = pipeline.save_series_source_context(series_id, request.text)
        return {"series_id": series_id, "source_context": series.source_context}
    except ValueError as exc:
        raise HTTPException(404 if str(exc) == "Series not found" else 422, str(exc)) from exc


@app.put("/series/{series_id}/director-profile/draft")
def save_series_director_profile_draft(
    series_id: str,
    request: SeriesDirectorProfileSaveRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        series = pipeline.save_series_director_profile_draft(series_id, request.draft, request.draft_name)
        return {"series_id": series_id, "draft_revision": series.director_profile_draft_revision,
                "draft": series.director_profile_draft.model_dump() if series.director_profile_draft else None,
                "draft_name": series.director_profile_draft_name}
    except ValueError as exc:
        raise HTTPException(404 if str(exc) == "Series not found" else 422, str(exc)) from exc


@app.post("/series/{series_id}/director-profile/confirm")
def confirm_series_director_profile(
    series_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        series = pipeline.confirm_series_director_profile(series_id)
        return {"series_id": series_id, "profile": pipeline.effective_series_director_profile(series_id).model_dump(),
                "revision": series.director_profile_revisions[-1].revision}
    except ValueError as exc:
        raise HTTPException(404 if str(exc) == "Series not found" else 409, str(exc)) from exc


@app.put("/projects/{script_id}/director-profile/draft")
def save_director_profile_draft(
    script_id: str,
    request: DirectorProfileDraftSaveRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        draft = _validated_director_profile_draft(request.draft)
        updated = pipeline.save_director_profile_draft(
            script_id,
            request.source_revision,
            request.expected_draft_revision,
            draft,
            request.draft_name,
        )
        return {
            "project_id": updated.id,
            "draft_revision": updated.director_profile_draft_revision,
            "source_revision": updated.director_profile_draft_source_revision,
            "draft": updated.director_profile_draft.model_dump(exclude={
                "revision", "content_hash", "confirmed_at",
            }) if updated.director_profile_draft else None,
            "updated_at": updated.director_profile_draft_updated_at,
            "draft_name": updated.director_profile_draft_name,
        }
    except ValueError as exc:
        message = str(exc)
        status = 409 if "revision changed" in message.lower() else 422
        if message == "Script not found":
            status = 404
        raise HTTPException(status, message) from exc


def _director_shooting_plan_counts(plan: Optional[DirectorShootingPlan]) -> Dict[str, int]:
    if plan is None:
        return {"scene_count": 0, "beat_count": 0, "shot_count": 0, "duration_seconds": 0}
    beats = [beat for scene in plan.scenes for beat in scene.beats]
    shots = [shot for beat in beats for shot in beat.shots]
    return {
        "scene_count": len(plan.scenes),
        "beat_count": len(beats),
        "shot_count": len(shots),
        "duration_seconds": sum(shot.duration_seconds or 0 for shot in shots),
    }


def _director_shooting_plan_revision_summary(revision: DirectorShootingPlanRevision) -> Dict[str, Any]:
    return {
        "revision": revision.revision,
        "content_hash": revision.content_hash,
        "user_title": revision.user_title,
        "summary": revision.summary,
        "confirmed_at": revision.confirmed_at,
        "source_revision": revision.plan.source_revision,
        "source_revision_id": revision.plan.source_revision_id,
        "director_profile_revision": revision.plan.director_profile_revision,
        "director_profile_hash": revision.plan.director_profile_hash,
        "effective_style_hash": revision.plan.effective_style_hash,
        **_director_shooting_plan_counts(revision.plan),
    }


@app.get("/projects/{script_id}/director-shooting-plan")
def get_director_shooting_plan(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    try:
        lineage = pipeline.director_shooting_plan_lineage(script_id)
        lineage_error = None
    except ValueError as exc:
        lineage = None
        lineage_error = str(exc)
    from .llm import split_director_source
    source_chunks = split_director_source(
        script.original_text, direct_max_chars=4500, target_chars=4000, max_chars=4500,
    )
    revisions = script.director_shooting_plan_revisions
    confirmed = revisions[-1] if revisions else None
    director_profile = pipeline.effective_director_profile(script)
    story_map = pipeline._effective_shooting_story_map(script, director_profile) if director_profile else None
    story_events = [
        {
            "id": event["event_id"],
            "label": f"{phase.get('label') or phase.get('phase_id') or ''} · {event.get('title') or str(event.get('description') or '')[:48]}",
        }
        for phase in (story_map or {}).get("phases", [])
        for event in phase.get("events", [])
        if event.get("event_id")
    ]
    return {
        "project_id": script.id,
        "draft_revision": script.director_shooting_plan_draft_revision,
        "draft_updated_at": script.director_shooting_plan_draft_updated_at,
        "draft": pipeline.normalize_director_shooting_plan_lighting(
            script.director_shooting_plan_draft
        ).model_dump() if script.director_shooting_plan_draft else None,
        "current_revision": confirmed.revision if confirmed else 0,
        "current": _director_shooting_plan_revision_summary(confirmed) if confirmed else None,
        "current_lineage": lineage,
        "readiness_error": lineage_error,
        "draft_stale": bool(script.director_shooting_plan_draft and _director_plan_lineage_changed(
            script.director_shooting_plan_draft, lineage,
        )),
        "current_stale": bool(confirmed and _director_plan_lineage_changed(confirmed.plan, lineage)),
        "current_story_events": story_events,
        "source_chunks": [{
            "source_ref": item["source_ref"],
            "char_start": item["char_start"],
            "char_end": item["char_end"],
        } for item in source_chunks],
    }


@app.get("/projects/{script_id}/episode-visual-context")
def get_episode_visual_context(script_id: str, user: UserContext = Depends(require_studio_user)):
    del user
    try:
        return pipeline.get_episode_visual_context(script_id)
    except ValueError as exc:
        status = 404 if str(exc) == "Script not found" else 409
        raise HTTPException(status, str(exc)) from exc


@app.post("/projects/{script_id}/episode-visual-context/sync")
def sync_episode_visual_context(script_id: str, user: UserContext = Depends(require_studio_user)):
    del user
    try:
        return pipeline.sync_episode_assets_from_shooting_plan(script_id)
    except ValueError as exc:
        status = 404 if str(exc) == "Script not found" else 409
        raise HTTPException(status, str(exc)) from exc


class EpisodePersonAssetBindingRequest(BaseModel):
    person_id: str = Field(..., min_length=1)
    asset_id: Optional[str] = None
    expected_plan_revision: int = Field(..., ge=1)


@app.put("/projects/{script_id}/episode-visual-context/person-asset")
def bind_episode_person_asset(script_id: str, request: EpisodePersonAssetBindingRequest,
                              user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(404, "Project not found")
    try:
        return pipeline.bind_episode_person_asset(
            script_id, request.person_id, request.asset_id, request.expected_plan_revision)
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(409 if "revision changed" in message else 422, message) from exc


class EpisodePlanAssetBindingRequest(BaseModel):
    asset_type: Literal["scene", "prop"]
    plan_asset_ids: List[str] = Field(..., min_length=1)
    asset_id: str = Field(..., min_length=1)
    expected_plan_revision: int = Field(..., ge=1)


class EpisodePlanSceneBindingRequest(BaseModel):
    scene_id: str = Field(..., min_length=1, max_length=120)
    shot_id: Optional[str] = Field(None, min_length=1, max_length=120)
    asset_id: str = Field(..., min_length=1, max_length=120)
    expected_plan_revision: int = Field(..., ge=1)


@app.put("/projects/{script_id}/episode-visual-context/plan-scene")
def bind_episode_plan_scene(script_id: str, request: EpisodePlanSceneBindingRequest,
                            user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(404, "Project not found")
    try:
        return pipeline.bind_episode_plan_scene(
            script_id, request.scene_id, request.shot_id,
            request.asset_id, request.expected_plan_revision)
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(409 if "revision changed" in message else 422, message) from exc


@app.put("/projects/{script_id}/episode-visual-context/plan-asset")
def bind_episode_plan_asset(script_id: str, request: EpisodePlanAssetBindingRequest,
                            user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(404, "Project not found")
    try:
        return pipeline.bind_episode_plan_asset(
            script_id, request.asset_type, request.plan_asset_ids,
            request.asset_id, request.expected_plan_revision)
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(409 if "revision changed" in message else 422, message) from exc


@app.get("/projects/{script_id}/storyboard/{frame_id}/asset-context")
def get_storyboard_asset_context(script_id: str, frame_id: str, user: UserContext = Depends(require_studio_user)):
    del user
    try:
        return pipeline.resolve_storyboard_asset_selection(script_id, frame_id)
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(404 if message in {"Script not found", "Frame not found"} else 409, message) from exc


@app.get("/projects/{script_id}/director-shooting-plan/revisions")
def list_director_shooting_plan_revisions(
    script_id: str,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    return [_director_shooting_plan_revision_summary(item) for item in reversed(script.director_shooting_plan_revisions)]


@app.get("/projects/{script_id}/director-shooting-plan/revisions/{revision}")
def get_director_shooting_plan_revision(
    script_id: str,
    revision: int,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    snapshot = next((item for item in script.director_shooting_plan_revisions if item.revision == revision), None)
    if snapshot is None:
        raise HTTPException(404, "Shooting-plan revision not found")
    plan = pipeline.normalize_director_shooting_plan_lighting(snapshot.plan)
    return {**_director_shooting_plan_revision_summary(snapshot), "plan": plan.model_dump()}


@app.put("/projects/{script_id}/director-shooting-plan/draft")
def save_director_shooting_plan_draft(
    script_id: str,
    request: DirectorShootingPlanDraftSaveRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        updated = pipeline.save_director_shooting_plan_draft(
            script_id,
            request.source_revision,
            request.expected_draft_revision,
            request.plan,
            allow_stale_lineage=request.allow_stale_lineage,
        )
        return {
            "project_id": updated.id,
            "draft_revision": updated.director_shooting_plan_draft_revision,
            "draft_updated_at": updated.director_shooting_plan_draft_updated_at,
            "draft": updated.director_shooting_plan_draft.model_dump() if updated.director_shooting_plan_draft else None,
        }
    except ValueError as exc:
        message = str(exc)
        status = 404 if message == "Script not found" else (
            409 if "revision changed" in message.lower() or "stale" in message.lower() else 422
        )
        raise HTTPException(status, message) from exc


@app.post("/projects/{script_id}/director-shooting-plan/confirm")
def confirm_director_shooting_plan(
    script_id: str,
    request: DirectorShootingPlanConfirmRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        updated = pipeline.apply_director_shooting_plan(
            script_id,
            request.plan,
            request.expected_current_revision,
            request.expected_draft_revision,
            user_title=request.user_title,
            summary=request.summary,
            allow_stale_lineage=request.allow_stale_lineage,
        )
        current = updated.director_shooting_plan_revisions[-1]
        return {
            "project_id": updated.id,
            "current_revision": current.revision,
            "current": _director_shooting_plan_revision_summary(current),
            "draft_revision": updated.director_shooting_plan_draft_revision,
        }
    except ValueError as exc:
        message = str(exc)
        status = 404 if message == "Script not found" else (
            409 if "revision changed" in message.lower() or "unsaved" in message.lower() or "stale" in message.lower() else 422
        )
        raise HTTPException(status, message) from exc


@app.post("/projects/{script_id}/director-shooting-plan/revisions/{revision}/restore")
def restore_director_shooting_plan_revision(
    script_id: str,
    revision: int,
    request: DirectorShootingPlanRestoreRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    try:
        updated = pipeline.restore_director_shooting_plan_revision(
            script_id,
            revision,
            request.expected_draft_revision,
        )
        return {
            "project_id": updated.id,
            "draft_revision": updated.director_shooting_plan_draft_revision,
            "draft_updated_at": updated.director_shooting_plan_draft_updated_at,
            "draft": updated.director_shooting_plan_draft.model_dump() if updated.director_shooting_plan_draft else None,
        }
    except ValueError as exc:
        message = str(exc)
        status = 404 if message in {"Script not found", "Shooting-plan revision not found"} else (
            409 if "revision changed" in message.lower() or "stale" in message.lower() else 422
        )
        raise HTTPException(status, message) from exc


def _director_shooting_plan_fingerprint(script_id: str, lineage: Dict[str, Any], model: Optional[str] = None) -> str:
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    entities = pipeline.resolve_episode_assets(script)
    llm = pipeline.script_processor.llm
    def selected_fields(items, names):
        return [{name: getattr(item, name, None) for name in names} for item in items]

    payload = [
        lineage,
        selected_fields(entities["characters"], ("id", "name", "persona", "base_character_id", "description")),
        selected_fields(entities["scenes"], ("id", "name", "description")),
        selected_fields(entities["props"], ("id", "name", "description")),
        director_preset_identity("shooting-plan-handoff"),
        llm.provider,
        model or llm._get_default_model(),
    ]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@app.post("/projects/{script_id}/director-shooting-plan-jobs", status_code=202)
def start_director_shooting_plan(
    script_id: str,
    request: director_skills.DirectorSkillsRequest = director_skills.DirectorSkillsRequest(),
    user: UserContext = Depends(require_studio_user),
):
    skill_snapshot = _freeze_director_skills("shooting_plan", request)
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(404, "Project not found")
    if not script.original_text.strip():
        raise HTTPException(422, "Script text is required before generating a shooting plan")
    try:
        lineage = pipeline.director_shooting_plan_lineage(script_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    from .llm import split_director_source
    chunks = split_director_source(
        script.original_text, direct_max_chars=4500, target_chars=4000, max_chars=4500,
    )
    model = _get_polish_model_for_project(script_id).strip() or None
    if model:
        try:
            published = fetch_uniart_catalog(studio_uniart_config())
        except Exception as exc:
            raise HTTPException(502, f"uniart_models_unavailable: {exc}") from exc
        if not any(item["api_model_id"] == model and "chat" in item["capabilities"] for item in published):
            raise HTTPException(422, "Selected LLM model is not published for this user")
    fingerprint = "director_shooting_plan:" + _director_shooting_plan_fingerprint(script_id, lineage, model) + hashlib.sha256(json.dumps(skill_snapshot, sort_keys=True).encode()).hexdigest()
    return extraction_jobs.start(
        user.owner_profile_id,
        script_id,
        fingerprint,
        lambda job_id: {
            "plan": pipeline.preview_director_shooting_plan(
                script_id,
                load_batches=lambda: extraction_jobs.load_batches(
                    user.owner_profile_id, script_id, fingerprint,
                ),
                save_batch=lambda index, source_ref, result: extraction_jobs.save_batch(
                    user.owner_profile_id, script_id, fingerprint, job_id,
                    index, source_ref, result,
                ),
                expected_lineage=lineage,
                model=model,
                skill_snapshot=skill_snapshot,
            ).model_dump(),
        },
        pass_job_id=True,
        total_batches=len(chunks),
        queue_group="director_shooting_plan",
    )


@app.get("/projects/{script_id}/director-shooting-plan-jobs/{job_id}")
def director_shooting_plan_status(
    script_id: str,
    job_id: str,
    user: UserContext = Depends(require_studio_user),
):
    return extraction_jobs.get(user.owner_profile_id, script_id, job_id)


@app.get("/projects/{script_id}/director-evidence")
def get_director_evidence(
    script_id: str,
    source_revision: int,
    category: Optional[str] = None,
    subject: Optional[str] = None,
    limit: int = 50,
    user: UserContext = Depends(require_studio_user),
):
    del user
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    return query_director_facts(
        script,
        source_revision,
        category=category,
        subject=subject,
        limit=max(1, min(limit, 100)),
    )


@app.post("/projects/{script_id}/director-profile/apply", response_model=Script)
def apply_director_profile(
    script_id: str,
    request: DirectorProfileApplyRequest,
    user: UserContext = Depends(require_studio_user),
):
    del user
    draft = _validated_director_profile_draft(request.draft)
    try:
        return signed_response(pipeline.apply_director_profile(
            script_id,
            draft,
            request.expected_current_revision,
            request.expected_draft_revision,
        ))
    except ValueError as exc:
        message = str(exc)
        status = 409 if "revision changed" in message.lower() or "unsaved edits" in message.lower() else 422
        if message == "Script not found":
            status = 404
        raise HTTPException(status, message) from exc


@app.post("/projects/{script_id}/art_direction/analyze")
async def analyze_script_for_styles(script_id: str, request: AnalyzeStyleRequest):
    """Analyze script content and recommend visual styles using LLM"""
    try:
        # Get the script to ensure it exists
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")

        # Use LLM to analyze and recommend styles (run in thread pool to avoid blocking, Python 3.8 compatible)
        custom_style = getattr(getattr(script, "prompt_config", None), "style_analysis", "")
        loop = asyncio.get_event_loop()
        recommendations = await loop.run_in_executor(
            None,  # Use default executor
            partial(pipeline.script_processor.analyze_script_for_styles, request.script_text, custom_style)
        )

        return {"recommendations": recommendations}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{script_id}/art_direction/clear")
def clear_project_art_direction(script_id: str):
    """Remove the episode style override while retaining its Director profile."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    profile = script.art_direction.director_profile if script.art_direction else None
    script.art_direction = ArtDirection(
        selected_style_id="director-profile", style_config={}, director_profile=profile,
    ) if profile else None
    script.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline._save_data()
    return get_project(script_id)


@app.put("/projects/{script_id}/last_episode_summary")
def update_last_episode_summary(script_id: str, payload: dict):
    """R2V v2 Phase P1-b — manually edit the cached AI summary.
    Body: {"ai_summary": "user-edited text"} or null to clear."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    summary = payload.get("ai_summary")
    if summary is None:
        script.last_episode_summary_cache = None
        script.last_episode_summary_revision = None
    else:
        script.last_episode_summary_cache = str(summary).strip()
        # When user manually edits, mark the revision as the current
        # previous-episode revision so it doesn't show stale.
        if script.series_id:
            series = pipeline.get_series(script.series_id)
            if series:
                try:
                    idx = series.episode_ids.index(script_id)
                    if idx > 0:
                        prev = pipeline.get_script(series.episode_ids[idx - 1])
                        if prev:
                            script.last_episode_summary_revision = _prev_text_revision(prev.original_text or "")
                except ValueError:
                    pass
    script.updated_at = time.time()
    pipeline.scripts[script_id] = script
    pipeline._save_data()
    return signed_response(script)


@app.post("/projects/{script_id}/art_direction/save", response_model=Script)
def save_art_direction(script_id: str, request: SaveArtDirectionRequest):
    """Save Art Direction configuration to the project"""
    try:
        updated_script = pipeline.save_art_direction(
            script_id,
            request.selected_style_id,
            request.style_config,
            request.custom_styles,
            request.ai_recommendations
        )
        return get_project(updated_script.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/art_direction/presets")
def get_style_presets():
    """Get built-in style presets (v2: categories + presets)"""
    try:
        import json
        import os
        preset_file = os.path.join(os.path.dirname(__file__), "style_presets.json")

        if not os.path.exists(preset_file):
            return {"version": 2, "categories": [], "presets": []}

        with open(preset_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and data.get("version") == 2:
                return data
            # Legacy fallback: plain array
            return {"version": 2, "categories": [], "presets": data if isinstance(data, list) else []}
    except Exception as e:
        logger.exception("Failed to load style presets")
        raise HTTPException(status_code=500, detail=str(e))


# NOTE: /storyboard/polish_prompt removed - use /storyboard/refine_prompt instead


def _get_custom_prompt(script_id: str, field: str) -> str:
    """Read a custom prompt with 3-level fallback: Episode → Series → system default.
    Returns empty string if result equals system default (so LLM method uses its built-in)."""
    if not script_id:
        return ""
    script = pipeline.get_script(script_id)
    if not script:
        return ""
    series = pipeline.get_series(script.series_id) if script.series_id else None
    effective = pipeline.get_effective_prompt(field, script, series)
    # If it's the system default, return empty so the LLM method uses its built-in default
    from .llm import DEFAULT_STORYBOARD_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT, DEFAULT_R2V_POLISH_PROMPT
    defaults = {
        "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
        "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
        "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
    }
    if effective == defaults.get(field, ""):
        return ""
    return effective


def _get_director_prompt_context(script_id: str, frame_id: str = "", overrides: Optional[Dict[str, str]] = None) -> str:
    if not script_id or not frame_id:
        return ""
    script = pipeline.get_script(script_id)
    frame = next((item for item in script.frames if item.id == frame_id), None) if script else None
    context = frame.director_shot_context if frame else None
    if frame is None:
        return ""
    context = context if isinstance(context, dict) else {}
    scene = context.get("scene") if isinstance(context.get("scene"), dict) else {}
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    selected = {
        "scene": {key: str(scene[key])[:160] for key in (
            "scene_ref", "time_anchor", "location", "place_continuity_id", "time_continuity_id",
        ) if scene.get(key)},
        "shot": {key: str(shot[key])[:240] for key in (
            "visual_intent", "performance_action", "composition", "camera_movement", "lighting", "ambient_sound",
        ) if shot.get(key)},
    }
    if frame.blocking:
        blocking = frame.blocking
        selected["blocking"] = {
            "description": blocking.description[:400],
            **({"camera_relation": blocking.camera_relation[:160]} if blocking.camera_relation else {}),
            **({"stage": [subject.model_dump(mode="json", exclude_none=True) for subject in blocking.stage[:8]]}
               if blocking.stage else {}),
        }
    current = overrides if overrides is not None else {
        "style": frame.style_prompt_override or "",
        "lighting": frame.lighting_override or "",
    }
    selected["shot_overrides"] = {
        key: str(current[key]).strip()[:160]
        for key in ("style", "lighting") if current.get(key) and str(current[key]).strip()
    }
    if selected["shot_overrides"].get("lighting"):
        selected["shot"].pop("lighting", None)
    if not context and not selected["shot_overrides"] and not frame.blocking:
        return ""
    baseline = context.get("lighting_baseline")
    if (isinstance(baseline, dict)
            and scene.get("place_continuity_id")
            and scene.get("time_continuity_id")
            and baseline.get("place_continuity_id") == scene["place_continuity_id"]
            and baseline.get("time_continuity_id") == scene["time_continuity_id"]):
        light = baseline.get("lighting") if isinstance(baseline.get("lighting"), dict) else {}
        selected["lighting_baseline"] = {
            key: str(baseline[key])[:120]
            for key in ("daylight_phase", "weather", "shadow_direction") if baseline.get(key)
        }
        selected["lighting_baseline"]["lighting"] = {
            key: str(light[key])[:160]
            for key in ("key_source", "color_tone", "contrast") if light.get(key)
        }
        if isinstance(context.get("shooting_plan_revision"), int):
            selected["shooting_plan_revision"] = context["shooting_plan_revision"]
    def encoded() -> str:
        return json.dumps(selected, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    for group, key in (
        ("shot", "ambient_sound"), ("shot", "camera_movement"),
        ("shot", "composition"), ("shot", "performance_action"),
        ("shot", "visual_intent"), ("scene", "location"),
        ("scene", "scene_ref"), ("scene", "time_anchor"),
        ("lighting_baseline", "weather"), ("lighting_baseline", "shadow_direction"),
    ):
        if len(encoded()) <= 1200:
            break
        selected.get(group, {}).pop(key, None)
    for key in ("contrast", "color_tone"):
        if len(encoded()) <= 1200:
            break
        selected.get("lighting_baseline", {}).get("lighting", {}).pop(key, None)
    if len(encoded()) > 1200:
        selected["shot"].pop("lighting", None)
    if len(encoded()) > 1200 and selected.get("blocking", {}).get("stage"):
        selected["blocking"].pop("stage")
    return encoded()


def _get_polish_model_for_project(script_id: str) -> str:
    """Read polish_model with 3-level fallback: Episode.prompt_config → Series.prompt_config → "".
    Empty = LLMAdapter uses its default (qwen3.6-plus). The frontend's polish-model dropdown
    in PromptConfig modal writes here; backend just reads."""
    if not script_id:
        return ""
    script = pipeline.get_script(script_id)
    if not script:
        return ""
    # Episode first
    ep_pc = getattr(script, "prompt_config", None)
    if ep_pc and getattr(ep_pc, "polish_model", ""):
        return ep_pc.polish_model
    # Series fallback
    if getattr(script, "series_id", None):
        series = pipeline.get_series(script.series_id)
        if series:
            s_pc = getattr(series, "prompt_config", None)
            if s_pc and getattr(s_pc, "polish_model", ""):
                return s_pc.polish_model
    return ""


class PolishVideoPromptRequest(BaseModel):
    generate_audio: Optional[bool] = None
    target_duration: Optional[float] = Field(default=None, gt=0)
    draft_prompt: str
    feedback: str = Field("", max_length=2000)  # User feedback for iterative refinement
    script_id: str = ""  # Optional: project ID to load custom prompt config
    frame_id: str = ""
    shot_overrides: Optional[Dict[Literal["style", "lighting"], str]] = None
    # 迭代时传入上一次的 CN 作为双语锚点，让模型同步修改双语；首次留空。
    prev_cn: str = ""
    # I2V 模式：首帧图 URL(s)。Vision-capable polish 模型会真正看见图像并
    # 用其指导润色（光影、构图、被摄主体等）。空列表 = 纯文本润色。
    image_urls: List[str] = Field(default_factory=list, max_length=4)
    # 显式覆盖 polish 用的 LLM 模型；空 = 用 project / series PromptConfig
    # 的 polish_model（再 fallback 到 system default）。
    polish_model: str = ""
    optimizer_provider: Literal["local_llm", "minimax_context_ir", "gpt", "qwen", "deepseek", "glm"] = "local_llm"
    optimization_skills: Optional[List[str]] = Field(default=None, max_length=12)
    target_ratio: str = Field("16:9", max_length=20)
    target_video_model: str = ""
    # Editor-level camera structure; independent of provider-specific shot_type.
    shot_structure: Literal["auto", "single", "multi"] = "auto"
    generation_mode: Literal["t2v", "i2v", "first_last_frame", "r2v"] = "i2v"
    dialogue_speaker: str = Field("", max_length=200)
    dialogue_line: str = Field("", max_length=2000)
    reviewed_messages: Optional[Dict[Literal["system", "user"], str]] = None
    review_token: str = ""


def _polish_error_response(err) -> Dict[str, Any]:
    """把 PolishError 转成统一的 502 响应体。
    model_echo 时附带原文双语供前端做 warning 渲染。"""
    body: Dict[str, Any] = {
        "reason": err.reason,
        "message_zh": err.message_zh,
        "message_en": err.message_en,
    }
    if err.prompt_cn:
        body["prompt_cn"] = err.prompt_cn
    if err.prompt_en:
        body["prompt_en"] = err.prompt_en
    return body


_STORYBOARD_VIDEO_POLISH_SKILLS = frozenset({
    "minimax-h3-director", "seedance-prompt", "seedance-camera",
    "sequence-continuity", "director-style", "shot-action-physics",
    "shot-martial-choreography",
})


def _target_model_guidance(model_id: str) -> str:
    """Legacy model-to-skill mapping for callers before explicit skill selection."""
    value = (model_id or "").lower()
    from ..agent_skills import catalog
    label = "MiniMax H3" if "h3" in value else "Seedance" if "seedance" in value else ""
    if not label:
        return ""
    default_id = "minimax-h3-director" if label == "MiniMax H3" else "seedance-prompt"
    package = next((p for p in catalog() if p["id"] == default_id), None)
    if package is None:
        return ""
    text = package["instructions"]
    return f"TARGET VIDEO MODEL: {label}. Shared Agent skill guidance:\n{text}"


def _selected_skill_guidance(skill_ids: Optional[List[str]], model_id: str = "") -> str:
    """Compose explicitly selected catalog skills in request order.

    The catalog remains the source of truth, so arbitrary prompt text cannot inject a new
    instruction package or a missing skill id.
    """
    if skill_ids is None:
        return ""
    from ..agent_skills import catalog
    packages = {package["id"]: package for package in catalog()}
    unknown = [skill_id for skill_id in skill_ids if skill_id not in packages]
    if unknown:
        raise HTTPException(status_code=422, detail={"reason": "unknown_optimization_skill", "skill_ids": unknown})
    ineligible = [skill_id for skill_id in skill_ids if skill_id not in _STORYBOARD_VIDEO_POLISH_SKILLS]
    if ineligible:
        raise HTTPException(status_code=422, detail={"reason": "ineligible_optimization_skill", "skill_ids": ineligible})
    selected = [packages[skill_id] for skill_id in dict.fromkeys(skill_ids)]
    model = (model_id or "").lower()
    target = "MiniMax H3" if "h3" in model else "Seedance" if "seedance" in model else ""
    incompatible = [package["id"] for package in selected if target and target not in package.get("targets", [])]
    if incompatible:
        raise HTTPException(status_code=422, detail={"reason": "incompatible_optimization_skill", "skill_ids": incompatible})
    if not selected:
        return ""
    text = "\n\n".join(f"[{package['id']} · {package['name']} v{package['version']}]\n{package.get('instructions', '')}" for package in selected)
    return "SELECTED OPTIMIZATION SKILLS (user-selected; do not infer additional skills):\n" + text


def _automatic_motion_skill_ids(text: str) -> List[str]:
    """Return model-independent motion baselines inferred from observable verbs.

    These are separate from user-selected optimization skills: the baseline
    protects causal movement and spatial continuity without changing the
    user's chosen model/style packages.
    """
    value = text or ""
    action = re.compile(
        r"踢|踹|打|击|撞|推|拉扯|抓住|抓|掐|砍|刺|劈|受击|命中|踉跄|跌倒|倒伏|摔倒|击飞|追赶|追逐|搏斗|fight|impact|stagger|fall",
        re.I,
    )
    martial = re.compile(
        r"武术|武指|招式|套路|兵器|拳法|剑法|刀法|棍法|格斗编排|martial|choreograph",
        re.I,
    )
    ids = ["shot-action-physics"] if action.search(value) else []
    if martial.search(value):
        ids.append("shot-martial-choreography")
        if "shot-action-physics" not in ids:
            ids.insert(0, "shot-action-physics")
    return ids


def _automatic_motion_skill_guidance(text: str, model_id: str = "") -> str:
    ids = _automatic_motion_skill_ids(text)
    if not ids:
        return ""
    from ..agent_skills import catalog
    packages = {package["id"]: package for package in catalog()}
    selected = [packages[item] for item in ids if item in packages]
    if not selected:
        return ""
    text = "\n\n".join(
        f"[{package['id']} · {package['name']} v{package['version']}]\n{package.get('instructions', '')}"
        for package in selected
    )
    return "AUTOMATIC MOTION BASELINES (inferred from observable action terms; do not add new plot events):\n" + text


def _first_last_polish_guidance(target_duration: Optional[float]) -> str:
    endpoint = f"{target_duration:.2f} seconds" if target_duration is not None else "the end of the clip"
    return f"""
FIRST/LAST FRAME VIDEO MODE (highest visual priority):
Two attached images are ordered: image 1 is the actual first frame at 0.00 seconds;
image 2 is the actual last frame at {endpoint}. Examine both images. Describe
only visible opening and ending states as observed; write a continuous, plausible
camera and subject motion path between them. At the end, subjects, camera,
composition and lighting must settle into the second image. A still image
does not prove its people are moving: if the ending pose has no clear motion
cue, let movement decelerate and hold that pose. Do not keep subjects walking
through or beyond the ending frame. Do not invent unseen events or claim the
two images depict motion by themselves. In each bilingual
prompt, state both frame alignments before the existing model-specific body
fields, then make the final action inside the visual timeline reach image 2.
Do not add a new body heading or append an afterword to the polished prompt.
"""


_ACTION_RHYTHM_GUIDANCE = """
SHOT ACTION RHYTHM:
When the current shot contains a causal action, organize its visible progress
into a small number of beats: initiating movement, immediate reaction, and
changed end state. Let related actions overlap where natural, but specify
which action triggers the next and where the motion stops. Fit the beats into
the requested duration; any timings are a newly designed timeline, never
claimed as measured source cuts. Keep camera trajectory, lens changes, and
subject/object tempo independent: a slow Push In or Zoom In does not make a
grab, recoil, or fall slow motion. Push In moves the camera; Zoom In changes
focal length. Do not add slow motion, prolonged posing, extra events,
shots, or characters unless requested. For an atmospheric shot without a
causal action, keep its intended pace and do not invent an action sequence.
When the draft uses rapid-impact words such as "猛然", "快速", "立即", or
"接触瞬间", preserve real-time motion: compress the reaction into the
available beat instead of stretching it into slow motion or a gradual fall.
Preserve explicit user-authored time windows; do not silently retime them or
divide duration evenly by default.
If the user explicitly names a table, wall, counter, or prop collision, include
that collision and its visible consequences in the same causal chain. For a
kick followed by a table collision and fall: single contact, immediate recoil
and backward steps, body hits the table, table visibly shifts or shakes,
objects actually visible on it slide, tip, or fall, then the person falls.
Do not make the person turn around to reach a table behind them. If no table
objects are visible, do not invent them. Put the collision, table response,
and any object response in the same or immediately following time beat.
When audio is enabled, align impact, wood movement, and falling-object sounds
with those visible events. If visual beats are retimed, rewrite any sound
timestamps copied from the draft to match them; do not preserve stale sound
timings. When silent, do not invent sound cues. Do not
apply the default prop-preservation rule to an explicitly authorized impact.
Place the rhythm inside the existing model-specific visual description,
without adding a new output field.
"""


_SHOT_SPACE_VISIBILITY_GUIDANCE = """
SHOT SPACE AND VISIBILITY:
Treat confirmed blocking and camera relation as the opening screen geography.
Keep each subject on the same side of barriers and at the same depth until an
explicit visible movement changes that position. A reference image anchors
appearance and environment; it does not prove an unseen movement or camera cut.
For one continuous shot, describe only actions readable from its viewpoint.
If a counter, doorway, crowd, or frame edge hides feet, hands, or a contact point,
describe the visible reaction or object movement instead of claiming the hidden
detail is seen. Do not move a subject across a barrier merely to show an action.
If a hidden action must be shown, require an explicit new shot or camera angle;
do not silently add one. State opening positions, causal action beats, and
changed end positions in that order. Keep camera motion separate from subject
timing and preserve the chosen shot count.
"""


_IR_SHOT_GUIDANCE = """
SHOT CONSTRAINTS: Preserve accepted shot fields, explicit visual timings,
first-frame blocking, identities, scene lighting, and the chosen shot count.
Keep camera motion independent of subject speed. For contact actions, show
one contact followed by its immediate force reaction, displacement, any
explicitly authorized collision and visible prop response, then the end state.
Do not invent unseen objects or make a subject cross an occluding barrier.
Fast action stays real-time unless the creator requests slow motion. Preserve
user-authored timing intent, but if the draft timing does not fit the requested
duration, retime the beats while preserving their causal order. For a single
continuous shot, keep all beats inside one [Shot 1] body. When multi-shot
structure is allowed, provider-native shot labels may be used. The visual
process must contain explicit timestamped
motion nodes or contiguous time ranges from 0.00s through the requested end
time; the final range must end exactly at that duration. Align sound cues with
the corresponding visual events; discard stale sound timestamps in the draft.
Silent mode has no sound.
"""


_MINIMAX_IR_TEXT_LIMIT = 7000


def _storyboard_polish_contract(model_id: str, custom: str, default: str, generate_audio=None, target_duration=None, dialogue_speaker="", dialogue_line="", optimization_skills: Optional[List[str]] = None, reference_mode: bool = False, generation_mode: str = "i2v", shot_structure: str = "auto") -> str:
    guidance = _selected_skill_guidance(optimization_skills, model_id) if optimization_skills is not None else _target_model_guidance(model_id)
    is_h3 = "h3" in (model_id or "").lower()
    if not guidance and not is_h3 and generation_mode != "first_last_frame":
        return (custom or default) + _ACTION_RHYTHM_GUIDANCE + _SHOT_SPACE_VISIBILITY_GUIDANCE
    constraints = ""
    if generate_audio is False:
        constraints += ("\nOUTPUT MUST BE SILENT: overall_soundscape and non_diegetic_music must be N/A. "
                        if is_h3 else "\nOUTPUT MUST BE SILENT: omit all audio and music cues. ")
        constraints += "No spoken dialogue, vocalization or sound cues. Preserve visual actions."
    elif generate_audio is True:
        constraints += "\nAudio is enabled. Preserve specified dialogue exactly; do not invent dialogue or music without permission."
        if dialogue_line.strip():
            speaker = dialogue_speaker.strip() or "Speaker"
            constraints += f"\nEXPLICIT DIALOGUE (verbatim, do not translate, omit, or rewrite): {speaker}: {dialogue_line.strip()}"
    if target_duration is not None:
        constraints += f"\nTarget duration: {target_duration} seconds. All action must fit within this duration; no invented exact source cut times."
        constraints += "\nSHOT STRUCTURE: the system may choose single-shot or multi-shot coverage. User-authored shot labels remain editable; do not hard-reject a valid shot structure. Preserve the continuous total timeline."
        if is_h3 and target_duration <= 6:
            constraints += f"""
SHORT H3 ACTION TIMELINE: For a causal action shot, write 3-6 contiguous,
explicit time ranges or timestamped motion nodes inside the existing visual
description, starting at 0.00s and ending at {target_duration:.2f}s. Use either
            the form 0.00-0.60s, the bracketed node form [00:00.000] ... [00:00.600],
            or the official-style node form At 00:00.000 ... At 00:00.600 in
BOTH prompt_cn and prompt_en. Each range or node must advance a visible action beat:
initiation, single contact, immediate force reaction, authorized collision,
and final state as applicable. These are authored action timings, not measured
source cut points or extra [Shot] labels. A fast impact and fall remain real
time; camera movement does not slow the subjects. For a purely atmospheric
shot without causal action, do not invent motion just to fill ranges.
If a person visibly collides with a table, show the table shift or shake and
the resulting movement of objects actually visible on it, then the person's
fall. Do not add table objects absent from the reference. Align permitted
impact and falling-object sounds with those visual beats; silence means no
sound cues at all.
"""
    if generation_mode == "first_last_frame":
        constraints += _first_last_polish_guidance(target_duration)
    if is_h3:
        constraints += """
HARD H3 TEXT-OVERLAY PROHIBITION:
Do not add subtitles, captions, karaoke text, dialogue text overlays, title cards,
watermarks, labels, or any other burned-in/on-screen typography. Dialogue, if
requested, is audio only and must not be rendered as text. Do not describe or
request subtitle tracks in either prompt language.
"""
    base_prompt = custom or (default if not guidance else "")
    contract = guidance + "\n" + base_prompt + constraints + _ACTION_RHYTHM_GUIDANCE + _SHOT_SPACE_VISIBILITY_GUIDANCE + """
STORYBOARD OUTPUT CONTRACT:
Return only JSON with string fields prompt_cn and prompt_en. Each string follows
the selected target model's prompt format and generation mode.
Preserve every existing [characterN:name] editor token exactly, including its
number and name. These are stable editor references; use them as source labels
inside the model-specific structure. Do not invent or renumber references.
Provider-native labels will be resolved at submission, not guessed here.
References in order: {SLOTS}
Preserve character/product replacement, scene, explicit dialogue and timing.
Do not invent dialogue text, music, extra shots or replacement identities unless
requested. Inspect all attached images, including scene, prop and storyboard
images. Distinguish observed image content from user requirements; sampling
cannot establish exact cut times. Missing images must not be described as seen.
"""
    if reference_mode and is_h3:
        contract += """
R2V / REF2VA MODE:
This is reference-guided video generation, not T2VA. Never label the task
[T2VA]. In summary, use an appropriate reference-generation task label such
as [reference generation] when reference media is present. If no reference
media is attached, state that no reference media is attached instead of
claiming that character labels are visual references.
"""
    if not is_h3:
        return contract
    contract += "\nFor H3, preserve every required model-specific heading. Do not replace that structure with scene/action/camera headings.\n"
    headings = (
        "subject_definitions:\nsummary:\nretention_analysis:\ndetailed_description:\noverall_soundscape:\nnon_diegetic_music:"
        if reference_mode else
        "integrated_multimodal_description:\noverall_soundscape:\nnon_diegetic_music:"
    )
    return contract + f"""
FINAL H3 ENFORCEMENT (highest priority):
Do not return a standalone sentence, summary, explanation, Markdown prose, or
an unstructured action description. Return one JSON object with exactly these
string keys: prompt_cn and prompt_en. Inside EACH string, emit the required
field headings in this exact order and spelling, each followed by a colon:
{headings}
Never omit a heading. Never put subtitles or any other text overlay in the prompt.
"""


def _needs_short_action_timeline(model_id: str, target_duration: Optional[float], draft_prompt: str) -> bool:
    return (
        "h3" in (model_id or "").lower()
        and target_duration is not None
        and target_duration <= 6
        and bool(re.search(r"踢|踹|受击|命中|碰撞|撞到|跌倒|倒地|摔倒|击飞|kick|impact|collision|stagger|fall", draft_prompt or "", re.I))
    )


def _has_short_action_timeline(text: str, duration: float, reference_mode: bool) -> bool:
    heading = "detailed_description" if reference_mode and re.search(
        r"(?im)^\s*detailed_description\s*[:：]", text
    ) else "integrated_multimodal_description"
    visual = re.search(rf"(?is){heading}\s*[:：](.*?)(?:overall_soundscape\s*[:：]|$)", text)
    # Context-IR may return provider-native H3 prose without the editor's
    # local field heading.  The official H3 examples use the visual text
    # directly, so validate the whole returned prompt in that case.
    visual_text = visual.group(1) if visual else text
    ranges = [
        (float(match.group(1)), float(match.group(2)))
        for match in re.finditer(r"(?<!\d)(\d{1,2}(?:\.\d{1,2})?)\s*[-–—~至]\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:s|秒)", visual_text, re.I)
    ]
    if (
        3 <= len(ranges) <= 6
        and abs(ranges[0][0]) <= 0.05
        and abs(ranges[-1][1] - duration) <= 0.05
        and all(start < end for start, end in ranges)
        and all(abs(left[1] - right[0]) <= 0.05 for left, right in zip(ranges, ranges[1:]))
    ):
        return True
    # MiniMax H3 also accepts explicit event nodes. Require a visible opening
    # node, a small number of progressing nodes, and an explicit final state
    # at the requested end time so the provider cannot stretch an underspecified
    # timeline across a longer rendered clip.
    timestamps = [
        float(minutes) * 60 + float(seconds)
        for minutes, seconds in re.findall(r"\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]", visual_text)
    ]
    if not timestamps:
        timestamps = [
            float(minutes) * 60 + float(seconds)
            for minutes, seconds in re.findall(
                r"(?i)\bAt\s+(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\b", visual_text
            )
        ]
    return (
        3 <= len(timestamps) <= 6
        and abs(timestamps[0]) <= 0.05
        and abs(timestamps[-1] - duration) <= 0.05
        and all(left < right for left, right in zip(timestamps, timestamps[1:]))
    )


def _validate_storyboard_polish_result(model_id: str, result: Dict[str, Any], reference_mode: bool, generate_audio=None, dialogue_line="", generation_mode: str = "i2v", short_action_duration: Optional[float] = None, shot_structure: str = "auto") -> None:
    """Reject responses that ignore the selected provider's prompt contract."""
    if generation_mode == "first_last_frame":
        first = re.compile(r"(?i)first[\s_-]*(?:frame|image)|opening[\s_-]*(?:frame|image)|picture\s*1\b|首帧|起始帧")
        last = re.compile(r"(?i)last[\s_-]*(?:frame|image)|final[\s_-]*(?:frame|image)|ending[\s_-]*(?:frame|image)|picture\s*2\b|尾帧|终帧|末帧")
        if any(not first.search(result.get(key, "")) or not last.search(result.get(key, ""))
               for key in ("prompt_cn", "prompt_en")):
            from .llm import PolishError
            raise PolishError(
                reason="model_contract_mismatch",
                message_zh="润色结果没有同时说明首帧与尾帧，本次结果未应用。",
                message_en="Polished result omitted the first or last frame; it was not applied.",
            )
    if "h3" not in (model_id or "").lower():
        return
    if reference_mode and any(
        re.search(r"(?i)\[\s*T2VA\s*\]", result.get(key, ""))
        for key in ("prompt_cn", "prompt_en")
    ):
        from .llm import PolishError
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="R2V 润色结果被误标为 T2VA，本次结果未应用。请检查参考素材后重试。",
            message_en="The R2V polish was mislabeled as T2VA and was not applied. Check the references and retry.",
        )
    reference_fields = ("subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music")
    base_fields = ("integrated_multimodal_description", "overall_soundscape", "non_diegetic_music")
    def has_field(text: Any, field: str) -> bool:
        """Accept the model's harmless Markdown decoration around contract fields.

        The prompt contract is still field based; models commonly render a
        valid field as ``1. **subject_definitions:**`` or
        ``subject_definitions:``.  Requiring the raw token at column zero
        made those responses fail despite containing every required section.
        """
        if not isinstance(text, str):
            return False
        parts = [part for part in re.split(r"[\s_-]+", field.strip().lower()) if part]
        field_pattern = r"[\s_-]*".join(re.escape(part) for part in parts)
        pattern = re.compile(
            rf"(?im)^\s*(?:[-*]\s*|\d+[.)]\s*)?(?:[\"'`]|\*\*)?"
            rf"{field_pattern}(?:[\"'`]|\*\*)?\s*(?:[:：-]|$)"
        )
        return pattern.search(text) is not None

    invalid_languages = []
    missing_fields = {}
    for key in ("prompt_cn", "prompt_en"):
        text = result.get(key, "")
        # MiniMax IR may return the valid base H3/T2VA contract even when the
        # caller entered through the R2V polish surface. Accept that explicit
        # three-field form; do not accept an unstructured sentence.
        accepted = (reference_fields, base_fields) if reference_mode else (base_fields,)
        if not any(all(has_field(text, field) for field in fields) for fields in accepted):
            invalid_languages.append(key)
            missing_fields[key] = {
                "base": [field for field in base_fields if not has_field(text, field)],
                **({"reference": [field for field in reference_fields if not has_field(text, field)]}
                   if reference_mode else {}),
            }
    if invalid_languages:
        logger.warning("H3 polish headings missing: reference_mode=%s languages=%s missing=%s",
                       reference_mode, invalid_languages, missing_fields)
        from .llm import PolishError
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="润色模型未返回 MiniMax H3 所需的结构化提示词，请重试。本次结果未应用。",
            message_en="The polish model did not return the structured MiniMax H3 prompt. Retry; this result was not applied.",
        )
    if short_action_duration is not None and any(
        not _has_short_action_timeline(result.get(key, ""), short_action_duration, reference_mode)
        for key in ("prompt_cn", "prompt_en")
    ):
        from .llm import PolishError
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="润色结果缺少覆盖全片的分段动作节拍，本次结果未应用。请重试。",
            message_en="The polished result lacks a complete timed action sequence; it was not applied. Retry.",
        )
    exact_dialogue = dialogue_line.strip()
    if generate_audio is True and exact_dialogue and any(
        exact_dialogue not in result.get(key, "") or "<d>" not in result.get(key, "")
        for key in ("prompt_cn", "prompt_en")
    ):
        from .llm import PolishError
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="润色结果遗漏或改写了镜头对白，请重试。本次结果未应用。",
            message_en="The polished prompt omitted or rewrote the shot dialogue. Retry; this result was not applied.",
        )


def _validate_context_ir_polish_result(result: Dict[str, str], *, reference_mode: bool = False,
                                       generation_mode: str = "i2v", generate_audio=None,
                                       dialogue_line: str = "",
                                       short_action_duration: Optional[float] = None,
                                       shot_structure: str = "auto") -> None:
    """Validate observable content without imposing local chat-model headings on IR."""
    from .llm import PolishError

    prompt = result.get("prompt_en", "")
    if not prompt.strip():
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="MiniMax IR 未返回提示词，本次结果未应用。",
            message_en="MiniMax IR returned no prompt; this result was not applied.",
        )
    if reference_mode and re.search(r"(?i)\[\s*T2VA\s*\]", prompt):
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="R2V 润色结果被误标为 T2VA，本次结果未应用。",
            message_en="The R2V polish was mislabeled as T2VA and was not applied.",
        )
    if generation_mode == "first_last_frame":
        first = re.compile(r"(?i)first[\s_-]*(?:frame|image)|opening[\s_-]*(?:frame|image)|picture\s*1\b|首帧|起始帧")
        last = re.compile(r"(?i)last[\s_-]*(?:frame|image)|final[\s_-]*(?:frame|image)|ending[\s_-]*(?:frame|image)|picture\s*2\b|尾帧|终帧|末帧")
        if not first.search(prompt) or not last.search(prompt):
            raise PolishError(
                reason="model_contract_mismatch",
                message_zh="润色结果没有同时说明首帧与尾帧，本次结果未应用。",
                message_en="Polished result omitted the first or last frame; it was not applied.",
            )
    if short_action_duration is not None:
        prompt = result.get("prompt_en", "")
        if not _has_short_action_timeline(prompt, short_action_duration, reference_mode):
            raise PolishError(
                reason="model_contract_mismatch",
                message_zh="润色结果的时间轴未从 0.00 秒连续覆盖到目标时长，请重试。",
                message_en="The polished result does not provide a contiguous timeline from 0.00s to the target duration; retry.",
            )
    exact_dialogue = dialogue_line.strip()
    if generate_audio is True and exact_dialogue and exact_dialogue not in prompt:
        raise PolishError(
            reason="model_contract_mismatch",
            message_zh="润色结果遗漏了镜头对白，本次结果未应用。",
            message_en="The polished prompt omitted the shot dialogue; it was not applied.",
        )


def _compile_ir_polish_text(request, custom_prompt: str) -> str:
    instruction = custom_prompt.strip()
    instruction += "\n" + _IR_SHOT_GUIDANCE
    instruction += f"\nSHOT STRUCTURE MODE: {request.shot_structure}. This is planning metadata only; the system may choose one or multiple provider-native [Shot N] sections, and the user may edit them. Do not hard-reject shot count; keep one continuous total timeline."
    if _needs_short_action_timeline(request.target_video_model, request.target_duration, request.draft_prompt):
        instruction += (f"\nUse 3-6 contiguous authored time ranges from 0.00s to {request.target_duration:.2f}s "
                        "inside the H3 visual description in both language outputs. "
                        "Preserve explicit visual timings in the draft; do not silently retime them. "
                        "Rewrite sound timestamps to match the visual beats; do not copy stale "
                        "sound times from the draft.")
    if getattr(request, "generation_mode", "") == "first_last_frame":
        instruction += _first_last_polish_guidance(request.target_duration)
    instruction += "\n\nH3 constraint: do not add subtitles, captions, title cards, watermarks, labels, or any burned-in on-screen text. Dialogue is audio only."
    selected_skills = _effective_optimization_skills(request)
    if selected_skills:
        instruction += "\n\n" + _selected_skill_guidance(selected_skills, request.target_video_model)
        instruction += "\nPreserve the official H3 output format."
    text = f"{instruction}\n\n[DRAFT PROMPT]\n{request.draft_prompt.strip()}"
    if request.feedback.strip():
        text += f"\n\n[USER FEEDBACK]\n{request.feedback.strip()}"
    return text


def _video_polish_user_text(request) -> str:
    if request.feedback.strip():
        if request.prev_cn.strip():
            return f"[当前提示词-CN]\n{request.prev_cn.strip()}\n\n[当前提示词-EN]\n{request.draft_prompt}\n\n[用户反馈]\n{request.feedback.strip()}\n\n请根据用户反馈同步修改双语版本，只修改用户指出的问题，保持其他部分不变。"
        return f"[当前提示词]\n{request.draft_prompt}\n\n[用户反馈]\n{request.feedback.strip()}\n\n请根据用户反馈修改提示词，只修改用户指出的问题，保持其他部分不变。"
    return request.draft_prompt


def _r2v_scene_lighting(script, frame, draft_prompt: str,
                        reference_variant_ids: Optional[Dict[str, List[str]]] = None) -> Optional[Dict[str, Any]]:
    """Read lighting only from the selected scene image's frozen lineage."""
    if frame is None:
        return None
    names = set(re.findall(r"\[(?:character\d+|scene):([^\]]+)\]", draft_prompt))
    scenes = pipeline.resolve_project_assets(script)["scenes"]
    matches = [scene for scene in scenes if scene.id == getattr(frame, "scene_id", None) and scene.name in names]
    if len(matches) != 1 or sum(scene.name == matches[0].name for scene in scenes) != 1:
        return None
    scene = matches[0]
    variants = {item.id: item for item in scene.image_asset.variants}
    selections = reference_variant_ids if reference_variant_ids is not None else frame.workbench_reference_variant_ids
    selected_ids = (selections or {}).get(scene.id) or []
    if len(selected_ids) > 1:
        return None
    selected_id = selected_ids[0] if selected_ids else scene.image_asset.selected_id
    variant = variants.get(selected_id)
    if variant is None:
        return None
    snapshot = variant.submission_snapshot
    design = snapshot.visual_design if snapshot and isinstance(snapshot.visual_design, dict) else {}
    fields: Dict[str, Any] = {}
    for key in ("ambient_lighting", "local_lighting"):
        value = design.get(key)
        if value and (not isinstance(value, dict) or any(str(part).strip() for part in value.values())):
            fields[key] = value
    constraints = design.get("visual_constraints")
    if isinstance(constraints, dict) and constraints.get("key_light_direction") not in (None, "", "unspecified"):
        fields["key_light_direction"] = constraints["key_light_direction"]

    source_variant = variant
    source_scene_name = scene.name
    tool = variant.scene_tool if isinstance(variant.scene_tool, dict) else None
    if (not tool or tool.get("kind") != "lighting") and snapshot and isinstance(snapshot.scene_tool, dict):
        tool = snapshot.scene_tool
    if snapshot:
        lighting_sources = []
        for reference in snapshot.reference_inputs:
            if reference.asset_type != "scene":
                continue
            parent = next((item for item in scenes if item.id == reference.asset_id), None)
            candidate = next((item for item in parent.image_asset.variants
                              if item.id == reference.variant_id), None) if parent else None
            if candidate and isinstance(candidate.scene_tool, dict) and candidate.scene_tool.get("kind") == "lighting":
                lighting_sources.append((candidate, parent.name))
        if (not tool or tool.get("kind") != "lighting") and len(lighting_sources) == 1:
            source_variant, source_scene_name = lighting_sources[0]
            tool = source_variant.scene_tool
    if tool and tool.get("kind") == "lighting":
        fields.update({key: tool[key] for key in ("light_side", "color", "brightness", "rim_light") if key in tool})
    if not fields:
        return None
    return {
        "scene_name": scene.name, "scene_id": scene.id, "variant_id": variant.id,
        "source_variant_id": source_variant.id, "source_scene_name": source_scene_name,
        "source_variant_name": source_variant.display_name if hasattr(source_variant, "display_name") else None,
        "design_revision": snapshot.design_revision_at_submission if snapshot else None,
        "fields": fields,
    }


def _r2v_reference_designs(script, request) -> List[Dict[str, Any]]:
    """Resolve reviewed character design through the referenced asset identity."""
    if not request.slots:
        return []
    assets = pipeline.resolve_project_assets(script)
    by_id = {
        kind: {asset.id: asset for asset in assets.get(f"{kind}s", [])}
        for kind in ("character", "scene", "prop")
    }
    result: List[Dict[str, Any]] = []
    seen_slots: set[int] = set()
    for ordinal, slot in enumerate(request.slots, 1):
        if not slot.asset_id:
            continue  # Legacy text-only caller.
        number = slot.slot or ordinal
        if number in seen_slots or not 1 <= number <= 9:
            raise HTTPException(422, "参考图槽位无效，请重新选择参考素材")
        seen_slots.add(number)
        kind = slot.asset_type
        asset = by_id.get(kind or "", {}).get(slot.asset_id)
        if asset is None or not slot.name or asset.name != slot.name:
            raise HTTPException(422, "参考素材身份已变化，请重新选择参考素材")
        tag = f"[character{number}:{slot.name}]"
        if tag not in request.draft_prompt and f"[{kind}:{slot.name}]" not in request.draft_prompt:
            raise HTTPException(422, "参考素材与当前镜头文字不匹配，请重新预览")
        variants = {item.id: item for item in pipeline._asset_image_variants(asset, kind)}
        if not slot.variant_ids or any(variant_id not in variants for variant_id in slot.variant_ids):
            raise HTTPException(422, "参考图版本已变化，请重新选择参考素材")
        selected = (request.reference_variant_ids or {}).get(asset.id)
        if selected and selected != slot.variant_ids:
            raise HTTPException(422, "参考图版本与镜头选择不一致，请重新预览")
        if kind != "character":
            continue
        if len(slot.variant_ids) != 1:
            raise HTTPException(422, "角色参考图必须对应一个已选版本")
        variant = variants[slot.variant_ids[0]]
        snapshot = variant.submission_snapshot
        revision = snapshot.design_revision_at_submission if snapshot else None
        if revision is None and asset.asset_pack:
            anchor = next((item for item in reversed(asset.asset_pack.revisions)
                           if item.variant_id == variant.id), None)
            if anchor:
                revision = anchor.source_design_revision
        revisions = (asset.character_design or {}).get("design_revisions") or []
        if revision is None:
            confirmed = revisions[-1] if revisions else None
        else:
            confirmed = next((item for item in revisions if item.get("revision") == revision), None)
            if confirmed is None:
                raise HTTPException(422, "角色参考图对应的设计版本已缺失，请重新确认角色设计")
        design = confirmed.get("design") if isinstance(confirmed, dict) else None
        structured = {}
        if isinstance(design, dict):
            for section in ("identity", "look"):
                value = design.get(section)
                if isinstance(value, dict):
                    selected_fields = {key: value[key] for key in ("visual_notes", "features") if value.get(key)}
                    if selected_fields:
                        structured[section] = selected_fields
        if structured:
            result.append({
                "slot": number, "name": asset.name,
                "design_revision": confirmed.get("revision"),
                "design": structured,
            })
    return result


def _compile_video_polish_review(request, reference_mode: bool) -> Dict[str, Any]:
    from .llm import DEFAULT_R2V_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT
    user = current_studio_user()
    frame_snapshot: Dict[str, Any] = {}
    effective_shot_fields: Dict[str, Any] = {}
    scene_lighting: Optional[Dict[str, Any]] = None
    reference_designs: List[Dict[str, Any]] = []
    if user is not None and request.script_id:
        script = pipeline.get_script(request.script_id, user.owner_profile_id)
        if not script:
            raise HTTPException(404, "Script not found")
        if request.frame_id:
            frame = next((item for item in script.frames if item.id == request.frame_id), None)
            if frame is None:
                raise HTTPException(404, "Frame not found")
            if reference_mode and request.image_urls:
                scene_lighting = _r2v_scene_lighting(
                    script, frame, request.draft_prompt, request.reference_variant_ids,
                )
                reference_designs = _r2v_reference_designs(script, request)
            frame_snapshot = {name: getattr(frame, name, None) for name in (
                "scene_id", "shot_id", "director_profile_revision", "director_profile_hash",
                "director_shot_context", "action_description", "style_prompt_override",
                "lighting_override", "shot_visual_design", "blocking", "composition", "shot_size",
                "camera_angle", "camera_movement", "transition_hint", "dialogue",
            )}
            frame_snapshot = {
                key: value.model_dump() if hasattr(value, "model_dump") else value
                for key, value in frame_snapshot.items()
            }
            row = next((item for item in pipeline.storyboard_continuity_sheet(request.script_id)["rows"]
                        if item["frame_id"] == request.frame_id), None)
            if row:
                keys = ("duration", "shot_size", "camera_angle", "camera_movement", "transition_hint",
                        "style", "story_time", "daylight_phase", "weather", "shadow_direction",
                        "key_source", "ambient_lighting", "color_tone", "contrast", "practical_sources",
                        "direction", "quality", "color_temp", "lighting_override")
                effective_shot_fields = {
                    key: {"value": row["fields"][key]["value"],
                          "source": row["fields"][key]["source_kind"],
                          "revision": row["fields"][key]["source_revision"]}
                    for key in keys if key in row["fields"]
                }
    if not reference_mode and request.generation_mode == "first_last_frame" and (
        len(request.image_urls) != 2 or request.image_urls[0] == request.image_urls[1]
    ):
        raise HTTPException(422, "首尾帧润色需要两张不同的已选图片")
    custom = _get_custom_prompt(request.script_id, "r2v_polish" if reference_mode else "video_polish")
    lighting_choice = getattr(request, "reference_lighting_choice", None)
    lighting_values: Dict[str, Any] = {}
    if scene_lighting:
        lighting_values = {key: value for key, value in effective_shot_fields.items()
                           if key in ("direction", "quality", "color_temp", "key_source", "ambient_lighting",
                                      "color_tone", "contrast", "lighting_override") and value.get("value") not in (None, "")}
        if request.shot_overrides and request.shot_overrides.get("lighting"):
            lighting_values["shot_override"] = request.shot_overrides["lighting"]
        if not lighting_values and lighting_choice is None:
            lighting_choice = "reference"
        scene_lighting = {**scene_lighting, "requires_decision": bool(lighting_values),
                          "shot_lighting": lighting_values, "choice": lighting_choice}
    model_shot_fields = ({key: value for key, value in effective_shot_fields.items()
                          if key not in ("direction", "quality", "color_temp", "key_source", "ambient_lighting",
                                         "color_tone", "contrast", "lighting_override")}
                         if lighting_choice == "reference" and scene_lighting else effective_shot_fields)
    if model_shot_fields:
        custom = "\n\n".join(filter(None, [custom,
            "ACCEPTED SHOT FIELDS AND VISUAL CONTINUITY (preserve these values; do not rewrite them):\n"
            + json.dumps(model_shot_fields, ensure_ascii=False, sort_keys=True)]))
    director = _get_director_prompt_context(request.script_id, request.frame_id, request.shot_overrides)
    if director:
        custom = "\n\n".join(filter(None, [custom, "CURRENT SHOT CONTEXT (editable overrides replace planned shot settings; matching continuity baseline is background):\n" + director]))
    if scene_lighting:
        if lighting_choice == "reference":
            instruction = "Use these frozen reference lighting fields for this shot. They supersede conflicting shot lighting values above; preserve all non-lighting shot fields."
        elif lighting_choice == "shot":
            instruction = "Keep this shot's lighting values. The scene image still anchors space and appearance, but do not transfer its lighting."
        else:
            instruction = "Scene lighting is available, but the shot also defines lighting. A creator choice is required before generation."
        source_text = ("SELECTED SCENE IMAGE LIGHTING (frozen variant; do not copy its actions or full prompt):\n"
                       + json.dumps({"scene_name": scene_lighting["scene_name"], "fields": scene_lighting["fields"]},
                                    ensure_ascii=False, sort_keys=True) + "\n") if lighting_choice == "reference" else ""
        custom = "\n\n".join(filter(None, [custom, source_text + instruction]))
    if reference_designs:
        model_designs = [{"slot": item["slot"], "name": item["name"], **item["design"]}
                         for item in reference_designs]
        custom = "\n\n".join(filter(None, [custom,
            "CHARACTER ASSET IDENTITY AND LOOK (confirmed structured fields for the selected character references):\n"
            + json.dumps(model_designs, ensure_ascii=False, sort_keys=True)
            + "\nUse these fields as the character appearance constraints. Unspecified fields are unconstrained. Keep shot action, blocking and camera separate from character identity/look."]))
    default = DEFAULT_R2V_POLISH_PROMPT if reference_mode else DEFAULT_VIDEO_POLISH_PROMPT
    if request.optimizer_provider == "minimax_context_ir":
        if request.target_video_model and "h3" not in request.target_video_model.lower():
            raise HTTPException(422, "MiniMax Context-IR requires an H3 target")
        messages = {"system": "", "user": _compile_ir_polish_text(request, custom)}
    else:
        system = _storyboard_polish_contract(
            request.target_video_model, custom, default, request.generate_audio,
            request.target_duration, request.dialogue_speaker, request.dialogue_line,
            _effective_optimization_skills(request), reference_mode=reference_mode,
            generation_mode=getattr(request, "generation_mode", "r2v"),
        ).strip()
        automatic = _automatic_motion_skill_guidance(
            "\n".join([request.draft_prompt, request.feedback, custom]),
            request.target_video_model,
        )
        if automatic:
            system += "\n\n" + automatic
        if reference_mode:
            slots = "\n".join(f"- character{slot.slot or i + 1}: {slot.description}" for i, slot in enumerate(request.slots)) or "No reference videos provided."
            system = system.replace("{SLOTS}", slots)
        if request.image_urls:
            if reference_mode:
                system += "\n\nIMPORTANT: The user has attached the reference image(s) for character1/2/3 above. Look at the images to understand each character's actual appearance, costume, and pose. Use that grounding when writing the action / camera description so the polished prompt is faithful to what the references show. Do NOT contradict visible details."
            elif request.generation_mode == "first_last_frame":
                system += "\n\nThe two attached images are ordered: first is the actual opening frame, second is the actual ending frame. Inspect both. A still image alone does not prove its people are moving; if the ending pose has no motion cue, settle and hold it. Describe a continuous transition that reaches the ending image without animating subjects past it. Do not claim unseen intermediate events are observed."
            else:
                system += "\n\nIMPORTANT: The user has attached the first frame image(s) of the clip. Look at the image(s) to ground your polish — describe what is actually visible (subjects, composition, lighting, color palette) and use that to enrich the motion/camera description. Do NOT invent elements absent from the image."
        messages = {"system": system, "user": _video_polish_user_text(request)}
    labels = (["首帧 0.00 秒", "尾帧 结束时"] if getattr(request, "generation_mode", "") == "first_last_frame" else [f"参考图 {i + 1}" for i in range(len(request.image_urls))])
    media = [{"label": labels[i], "url": url} for i, url in enumerate(request.image_urls)]
    source = request.model_dump(exclude={"reviewed_messages", "review_token"})
    token = hashlib.sha256(json.dumps({"source": source, "frame": frame_snapshot,
                                      "effective_shot_fields": effective_shot_fields,
                                      "scene_lighting": scene_lighting,
                                      "reference_designs": reference_designs,
                                      "compiled": messages},
                                      sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    format_note = (
        "MiniMax Context IR 按所选模型的原生结构生成；这里展示送入 IR 的完整文字。"
        if request.optimizer_provider == "minimax_context_ir" else
        "MiniMax H3 必须保留结构化输出字段；删除必需字段会在调用前拒绝。"
        if "h3" in request.target_video_model.lower() else
        "模型以 JSON 返回中英双语提示词。"
    )
    return {"messages": messages, "media": media, "review_token": token,
            "format_note": format_note,
            "review_context": {
                "effective_shot_fields": effective_shot_fields,
                "selected_skills": _effective_optimization_skills(request) or [],
                "target_duration": request.target_duration,
                "scene_lighting": scene_lighting,
                "reference_designs": reference_designs,
            }}


def _require_video_polish_review(request, reference_mode: bool) -> Dict[str, str]:
    compiled = _compile_video_polish_review(request, reference_mode)
    lighting = compiled.get("review_context", {}).get("scene_lighting")
    if lighting and lighting.get("requires_decision") and not lighting.get("choice"):
        raise HTTPException(422, "参考场景光影与本镜设置并存，请先选择采用哪一方")
    messages = request.reviewed_messages
    if not request.review_token or request.review_token != compiled["review_token"] or not messages:
        raise HTTPException(409, "润色输入或来源已变化，请重新预览并确认")
    if set(messages) != {"system", "user"} or not messages["user"].strip():
        raise HTTPException(422, "确认后的模型输入缺少用户消息")
    if request.optimizer_provider == "minimax_context_ir" and messages["system"].strip():
        raise HTTPException(422, "MiniMax Context IR 只接受一条输入文字，请将编辑内容放入用户文字")
    if "h3" in request.target_video_model.lower() and request.optimizer_provider != "minimax_context_ir":
        required = ("subject_definitions", "summary", "retention_analysis", "detailed_description",
                    "overall_soundscape", "non_diegetic_music") if reference_mode else (
                    "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music")
        if any(field not in messages["system"] for field in required):
            raise HTTPException(422, "MiniMax H3 的必需输出字段已被移除，请恢复格式要求后再提交")
    if request.generate_audio is True and request.dialogue_line.strip() and (
        request.dialogue_line.strip() not in messages["system"] + messages["user"]
    ):
        raise HTTPException(422, "镜头对白已从模型输入移除，请先修改镜头对白设置或恢复该行")
    return messages


@app.post("/video/polish_prompt/preview")
def preview_video_polish_prompt(request: PolishVideoPromptRequest):
    return _compile_video_polish_review(request, False)


def _complete_minimax_ir_polish(request, custom_prompt: str, reviewed_text: Optional[str] = None) -> Dict[str, str]:
    """Run the official MiniMax Context-IR optimizer for storyboard polish."""
    from .llm import PolishError
    if request.target_video_model and "h3" not in request.target_video_model.lower():
        raise HTTPException(status_code=422, detail={
            "reason": "optimizer_target_mismatch",
            "message": "MiniMax Context-IR is only available for MiniMax H3 optimization.",
        })
    user = current_studio_user()
    if user is None:
        raise HTTPException(status_code=401, detail="MiniMax Context-IR requires a Studio user context")
    from ...models.uniart import complete_context_ir, _image_reference_url
    from ..studio_access import runtime_uniart_for_owner
    config = runtime_uniart_for_owner(user.user_id, user.owner_profile_id)
    text = reviewed_text if reviewed_text is not None else _compile_ir_polish_text(request, custom_prompt)
    if len(text) > _MINIMAX_IR_TEXT_LIMIT:
        raise PolishError(
            reason="api_error",
            message_zh=f"MiniMax IR 输入 {len(text)} 字符，超过 {_MINIMAX_IR_TEXT_LIMIT} 字符上限。请在模型输入检查中缩短文字后重试。",
            message_en=f"MiniMax IR input is {len(text)} characters, above the {_MINIMAX_IR_TEXT_LIMIT}-character limit. Shorten the reviewed text and retry.",
        )
    try:
        content: List[Dict[str, Any]] = [{"type": "text", "text": text}]
        for index, value in enumerate(_polish_image_urls(request.image_urls or [])):
            label = ("Actual first frame at 0.00 seconds", "Actual last frame at the end") if getattr(request, "generation_mode", "") == "first_last_frame" else ()
            content.append({"type": "text", "text": label[index] if label else f"Reference image {index + 1}"})
            content.append({"type": "image_url", "role": "reference_image", "image_url": {"url": _image_reference_url(value)}})
        prompt = complete_context_ir(
            config,
            content,
            duration=max(1, int(round(request.target_duration or 5))),
            ratio=request.target_ratio or "16:9",
            idempotency_key=f"storyboard-polish:{request.script_id}:{hashlib.sha256(json.dumps([text, request.image_urls], ensure_ascii=False).encode('utf-8')).hexdigest()[:24]}",
        )
    except PolishError:
        raise
    except Exception as exc:
        logger.exception("MiniMax Context-IR storyboard polish failed")
        raise PolishError(reason="api_error", message_zh=f"MiniMax IR 调用失败：{exc}", message_en=f"MiniMax Context-IR failed: {exc}") from exc
    return {"prompt_cn": prompt, "prompt_en": prompt}


_OPTIMIZER_MODEL_IDS = {
    "gpt": "gpt-5.6-sol",
    "qwen": "qwen3.8-flash",
    "deepseek": "deepseek-v4.1-flash",
    "glm": "glm-5.3",
}


def _effective_optimization_skills(request) -> Optional[List[str]]:
    """Choose legacy default guidance only for a matching video model."""
    if request.optimization_skills is not None:
        return request.optimization_skills
    if request.optimizer_provider in _OPTIMIZER_MODEL_IDS:
        model = (request.target_video_model or "").lower()
        if "h3" in model:
            return ["minimax-h3-director"]
        if "seedance" in model:
            return ["seedance-prompt"]
        return []
    return None


def _polish_image_urls(image_urls: List[str]) -> List[str]:
    """Turn signed Studio media URLs into owner-verified local image paths."""
    from .llm import PolishError

    resolved = []
    for value in image_urls:
        if urlparse(value).path.startswith("/studio/media/"):
            user = current_studio_user()
            if user is None:
                raise PolishError(
                    reason="api_error", message_zh="参考图无法读取，请重新选择后再润色。",
                    message_en="Reference image could not be read; reselect it before polishing.",
                )
            try:
                resolved.append(resolve_studio_reference(value, user.owner_profile_id, output_root=pipeline.output_root))
            except ValueError as exc:
                raise PolishError(
                    reason="api_error", message_zh="参考图无法读取，请重新选择后再润色。",
                    message_en="Reference image could not be read; reselect it before polishing.",
                ) from exc
        else:
            resolved.append(value)
    return resolved


@app.post("/video/polish_prompt")
def polish_video_prompt(request: PolishVideoPromptRequest):
    """Polishes a video generation prompt using LLM. Returns bilingual prompts.

    NOTE: Defined as a SYNC handler on purpose. The body calls
    `processor.polish_video_prompt()` which makes a blocking HTTP call to
    DashScope (openai sync client). If declared `async def`, FastAPI would
    run it on the event loop itself — blocking ALL other endpoints for the
    10-30s LLM call (e.g. concurrent `GET /prompt_config` from the modal
    looks "stuck loading"). Sync handlers get auto-dispatched to anyio's
    threadpool, freeing the event loop for other requests.

    成功：200 + {prompt_cn, prompt_en}
    失败：502 + {reason, message_zh, message_en, prompt_cn?, prompt_en?}
      其中 reason ∈ {is_configured_false, api_error, json_parse_error,
                     missing_keys, model_contract_mismatch, model_echo}。
      model_echo 是 warning 性质（带原文双语），其余是 hard error。
    """
    from .llm import PolishError
    try:
        reviewed = _require_video_polish_review(request, False)
        from .llm import DEFAULT_VIDEO_POLISH_PROMPT
        short_action_duration = request.target_duration if _needs_short_action_timeline(
            request.target_video_model, request.target_duration, request.draft_prompt
        ) else None
        if request.generation_mode == "first_last_frame" and (
            len(request.image_urls) != 2 or request.image_urls[0] == request.image_urls[1]
        ):
            raise PolishError(
                reason="api_error",
                message_zh="首尾帧润色需要两张不同的已选图片，请先选择首帧和尾帧。",
                message_en="First/last-frame polish requires two different selected images.",
            )
        custom = _get_custom_prompt(request.script_id, "video_polish")
        director = _get_director_prompt_context(request.script_id, request.frame_id, request.shot_overrides)
        if director:
            custom = "\n\n".join(filter(None, [custom, "CURRENT SHOT CONTEXT (editable overrides replace planned shot settings; matching continuity baseline is background):\n" + director]))
        selected_skills = _effective_optimization_skills(request)
        if request.optimizer_provider == "minimax_context_ir":
            # Context-IR owns its provider-native structure. Keep the existing
            # freeform instruction path and validate only observable IR invariants.
            result = _complete_minimax_ir_polish(request, custom or DEFAULT_VIDEO_POLISH_PROMPT, reviewed["user"])
            _validate_context_ir_polish_result(result, generation_mode=request.generation_mode,
                                               generate_audio=request.generate_audio, dialogue_line=request.dialogue_line,
                                               short_action_duration=short_action_duration,
                                               shot_structure=request.shot_structure)
            return result
        custom_prompt = _storyboard_polish_contract(request.target_video_model, custom, DEFAULT_VIDEO_POLISH_PROMPT, request.generate_audio, request.target_duration, request.dialogue_speaker, request.dialogue_line, selected_skills, reference_mode=False, generation_mode=request.generation_mode, shot_structure=request.shot_structure)
        # Polish model: request override → project/series PromptConfig → ""
        polish_model = request.polish_model or _OPTIMIZER_MODEL_IDS.get(request.optimizer_provider) or _get_polish_model_for_project(request.script_id)
        processor = ScriptProcessor()
        result = processor.polish_video_prompt(
            request.draft_prompt,
            request.feedback,
            custom_prompt,
            request.prev_cn,
            image_urls=_polish_image_urls(request.image_urls) or None,
            polish_model=polish_model,
            generation_mode=request.generation_mode,
            reviewed_messages=reviewed,
        )
        _validate_storyboard_polish_result(request.target_video_model, result, reference_mode=False, generate_audio=request.generate_audio, dialogue_line=request.dialogue_line, generation_mode=request.generation_mode, short_action_duration=short_action_duration, shot_structure=request.shot_structure)
        return {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", "")
        }
    except PolishError as e:
        logger.warning("polish_video_prompt failed: %s", e)
        raise HTTPException(status_code=502, detail=_polish_error_response(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("polish_video_prompt unexpected error")
        raise HTTPException(status_code=500, detail=str(e))


class RefSlot(BaseModel):
    description: str  # Character name, e.g., "雷震", "白兔"
    slot: Optional[int] = Field(None, ge=1, le=9)
    asset_id: Optional[str] = None
    asset_type: Optional[Literal["character", "scene", "prop"]] = None
    name: Optional[str] = None
    variant_ids: List[str] = Field(default_factory=list)


class PolishR2VPromptRequest(BaseModel):
    generate_audio: Optional[bool] = None
    target_duration: Optional[float] = Field(default=None, gt=0)
    draft_prompt: str
    slots: List[RefSlot]
    feedback: str = Field("", max_length=2000)  # User feedback for iterative refinement
    script_id: str = ""  # Optional: project ID to load custom prompt config
    frame_id: str = ""
    shot_overrides: Optional[Dict[Literal["style", "lighting"], str]] = None
    prev_cn: str = ""  # 双语锚点迭代用，首次留空
    # R2V 模式：用户挂载的 character1/2/3 参考图 URL(s)，让 vision 模型
    # 看清各角色实际形象。空列表 = 纯文本润色（兼容旧调用方）。
    image_urls: List[str] = Field(default_factory=list, max_length=9)
    reference_variant_ids: Optional[Dict[str, List[str]]] = None
    reference_lighting_choice: Optional[Literal["shot", "reference"]] = None
    polish_model: str = ""
    optimizer_provider: Literal["local_llm", "minimax_context_ir", "gpt", "qwen", "deepseek", "glm"] = "local_llm"
    optimization_skills: Optional[List[str]] = Field(default=None, max_length=12)
    target_ratio: str = Field("16:9", max_length=20)
    target_video_model: str = ""
    shot_structure: Literal["auto", "single", "multi"] = "auto"
    dialogue_speaker: str = Field("", max_length=200)
    dialogue_line: str = Field("", max_length=2000)
    reviewed_messages: Optional[Dict[Literal["system", "user"], str]] = None
    review_token: str = ""


@app.post("/video/polish_r2v_prompt/preview")
def preview_r2v_polish_prompt(request: PolishR2VPromptRequest):
    return _compile_video_polish_review(request, True)


@app.post("/video/polish_r2v_prompt")
def polish_r2v_prompt(request: PolishR2VPromptRequest):
    """Polishes a R2V (Reference-to-Video) prompt using LLM. Returns bilingual prompts.
    错误约定同 /video/polish_prompt。
    SYNC handler on purpose — see polish_video_prompt for rationale."""
    from .llm import PolishError
    try:
        reviewed = _require_video_polish_review(request, True)
        from .llm import DEFAULT_R2V_POLISH_PROMPT
        short_action_duration = request.target_duration if _needs_short_action_timeline(
            request.target_video_model, request.target_duration, request.draft_prompt
        ) else None
        custom = _get_custom_prompt(request.script_id, "r2v_polish")
        director = _get_director_prompt_context(request.script_id, request.frame_id, request.shot_overrides)
        if director:
            custom = "\n\n".join(filter(None, [custom, "CURRENT SHOT CONTEXT (editable overrides replace planned shot settings; matching continuity baseline is background):\n" + director]))
        selected_skills = _effective_optimization_skills(request)
        if request.optimizer_provider == "minimax_context_ir":
            result = _complete_minimax_ir_polish(request, custom or DEFAULT_R2V_POLISH_PROMPT, reviewed["user"])
            _validate_context_ir_polish_result(result, reference_mode=True, generate_audio=request.generate_audio,
                                               dialogue_line=request.dialogue_line, short_action_duration=short_action_duration,
                                               shot_structure=request.shot_structure)
            return result
        custom_prompt = _storyboard_polish_contract(request.target_video_model, custom, DEFAULT_R2V_POLISH_PROMPT, request.generate_audio, request.target_duration, request.dialogue_speaker, request.dialogue_line, selected_skills, reference_mode=True, shot_structure=request.shot_structure)
        polish_model = request.polish_model or _OPTIMIZER_MODEL_IDS.get(request.optimizer_provider) or _get_polish_model_for_project(request.script_id)
        processor = ScriptProcessor()
        slot_info = [{"description": s.description} for s in request.slots]
        result = processor.polish_r2v_prompt(
            request.draft_prompt,
            slot_info,
            request.feedback,
            custom_prompt,
            request.prev_cn,
            image_urls=_polish_image_urls(request.image_urls) or None,
            polish_model=polish_model,
            reviewed_messages=reviewed,
        )
        _validate_storyboard_polish_result(request.target_video_model, result, reference_mode=True, generate_audio=request.generate_audio, dialogue_line=request.dialogue_line, short_action_duration=short_action_duration, shot_structure=request.shot_structure)
        return {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", "")
        }
    except PolishError as e:
        logger.warning("polish_r2v_prompt failed: %s", e)
        raise HTTPException(status_code=502, detail=_polish_error_response(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("polish_r2v_prompt unexpected error")
        raise HTTPException(status_code=500, detail=str(e))


def _start_polish_job(script_id: str, request, mode: str, owner: str):
    """Run slow model calls independently of the browser's HTTP connection."""
    if request.script_id != script_id:
        raise HTTPException(422, "Project identity mismatch")
    if not pipeline.get_script(script_id, owner):
        raise HTTPException(404, "Script not found")
    if request.frame_id and not any(
        frame.id == request.frame_id for frame in pipeline.get_script(script_id, owner).frames
    ):
        raise HTTPException(404, "Frame not found")
    _require_video_polish_review(request, mode == "r2v")

    def work():
        try:
            value = polish_r2v_prompt(request) if mode == "r2v" else polish_video_prompt(request)
            return {"prompt_cn": value["prompt_cn"], "prompt_en": value["prompt_en"]}
        except HTTPException as exc:
            if exc.status_code == 502 and isinstance(exc.detail, dict):
                return {"detail": exc.detail}
            logger.warning("Polish job failed: mode=%s status=%s", mode, exc.status_code)
            return {"detail": {
                "reason": "api_error",
                "message_zh": "润色任务失败，请重试。",
                "message_en": "Polish task failed. Please retry.",
            }}

    fingerprint = f"polish:{mode}:{uuid.uuid4().hex}"
    return extraction_jobs.start(
        owner, f"polish:{script_id}:{request.frame_id or 'general'}",
        fingerprint, work,
    )


@app.post("/projects/{script_id}/polish-jobs/video", status_code=202)
def start_video_polish_job(script_id: str, request: PolishVideoPromptRequest,
                           user: UserContext = Depends(require_studio_user)):
    return _start_polish_job(script_id, request, "video", user.owner_profile_id)


@app.post("/projects/{script_id}/polish-jobs/r2v", status_code=202)
def start_r2v_polish_job(script_id: str, request: PolishR2VPromptRequest,
                         user: UserContext = Depends(require_studio_user)):
    return _start_polish_job(script_id, request, "r2v", user.owner_profile_id)


@app.get("/projects/{script_id}/polish-jobs/{job_id}")
def get_polish_job(script_id: str, job_id: str,
                   user: UserContext = Depends(require_studio_user)):
    if not pipeline.get_script(script_id, user.owner_profile_id):
        raise HTTPException(404, "Script not found")
    return extraction_jobs.get_for_project_prefix(
        user.owner_profile_id, f"polish:{script_id}", job_id, "polish:",
    )


# ===== Environment Configuration Endpoints =====

def _check_mulerun_cli_status() -> bool:
    """Check if MuleRun CLI is installed and logged in."""
    try:
        import shutil, subprocess
        if shutil.which("mulerun") is None:
            return False
        result = subprocess.run(
            ["mulerun", "login", "status"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False


@app.post("/config/mulerun-login")
def trigger_mulerun_login():
    """Trigger mulerun login — opens browser for OAuth."""
    import shutil, subprocess
    if shutil.which("mulerun") is None:
        raise HTTPException(status_code=400, detail="MuleRun CLI 未安装。请先运行: npm i -g @mulerunai/cli")
    try:
        subprocess.Popen(
            ["mulerun", "login"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {"status": "ok", "message": "浏览器已打开，请完成登录"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动登录失败: {e}")


# Credential-like env fields that must never be returned in plaintext.
SECRET_FIELDS = {
    "DASHSCOPE_API_KEY",
    "ALIBABA_CLOUD_ACCESS_KEY_ID",
    "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    "KLING_ACCESS_KEY",
    "KLING_SECRET_KEY",
    "VIDU_API_KEY",
    "MULEROUTER_API_KEY",
    "OPENAI_API_KEY",
    "UNIART_API_KEY",
}

# Bullet sentinel: never appears in a real key, so the save path can detect an
# unchanged (still-masked) field and avoid overwriting the stored secret.
_MASK_CHAR = "\u2022"


def _mask_secret(value: Optional[str]) -> str:
    """Return a masked representation (bullets + last 4 chars) for a configured
    secret, or an empty string when it is unset. Never reveals the full value."""
    v = (value or "").strip()
    if not v:
        return ""
    if len(v) <= 4:
        return _MASK_CHAR * len(v)
    return _MASK_CHAR * 8 + v[-4:]


@app.get("/config/env")
def get_env_config(identity: UserContext = Depends(require_user_context)):
    """Get current environment configuration.

    Secrets are masked (bullets + last 4 chars) and never returned in
    plaintext. `secrets_configured` reports which credential fields are set so
    the frontend can drive required-field / validation logic without the raw
    value. Non-secret config (OSS bucket/endpoint/base path, provider modes,
    endpoint overrides) is returned as-is."""
    del identity
    try:
        from ...utils.endpoints import PROVIDER_DEFAULTS
        from ...utils.oss_utils import is_oss_enabled
        endpoint_overrides = {}
        for provider in PROVIDER_DEFAULTS:
            env_key = f"{provider}_BASE_URL"
            value = os.getenv(env_key)
            if value:
                endpoint_overrides[env_key] = value

        secrets_configured = {
            field: bool((os.getenv(field, "") or "").strip())
            for field in SECRET_FIELDS
        }


        return {
            "LLM_PROVIDER": os.getenv("LLM_PROVIDER", "dashscope"),
            "OPENAI_BASE_URL": os.getenv("OPENAI_BASE_URL", ""),
            "OPENAI_MODEL": os.getenv("OPENAI_MODEL", ""),
            # Non-secret config.
            "OSS_BUCKET_NAME": os.getenv("OSS_BUCKET_NAME", ""),
            "OSS_ENDPOINT": os.getenv("OSS_ENDPOINT", ""),
            "OSS_BASE_PATH": os.getenv("OSS_BASE_PATH", ""),
            "OSS_ENABLE": is_oss_enabled(),
            "IFRAME_MEDIA_ROOT": os.getenv("IFRAME_MEDIA_ROOT", "output"),
            "IFRAME_STORAGE_BACKEND": (
                storage_backend() if os.getenv("IFRAME_STORAGE_BACKEND") is not None
                else "cos" if is_cos_configured() else "local"
            ),
            "PROVIDER_MEDIA_PUBLIC_BASE_URL": os.getenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", os.getenv("UNIART_MEDIA_BASE_URL", "")),
            "PROVIDER_MEDIA_URL_TTL_SECONDS": int(os.getenv("PROVIDER_MEDIA_URL_TTL_SECONDS", "1800")),
            "UNIART_VIDEO_COS_BUCKET": os.getenv("UNIART_VIDEO_COS_BUCKET", ""),
            "UNIART_VIDEO_COS_REGION": os.getenv("UNIART_VIDEO_COS_REGION", ""),
            "UNIART_VIDEO_COS_DOMAIN": os.getenv("UNIART_VIDEO_COS_DOMAIN", ""),
            "MANAGED_COS_CONFIGURED": bool(os.getenv("MANAGED_STORAGE_BASE_URL") and os.getenv("MANAGED_STORAGE_SERVICE_TOKEN")),
            "MULERUN_CLI_LOGGED_IN": _check_mulerun_cli_status(),
            "KLING_PROVIDER_MODE": _normalize_provider_mode(os.getenv("KLING_PROVIDER_MODE")),
            "VIDU_PROVIDER_MODE": _normalize_provider_mode(os.getenv("VIDU_PROVIDER_MODE")),
            "PIXVERSE_PROVIDER_MODE": _normalize_provider_mode(os.getenv("PIXVERSE_PROVIDER_MODE")),
            "endpoint_overrides": endpoint_overrides,
            "secrets_configured": secrets_configured,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





@app.get("/config/models")
@app.get("/config/uniart/models")
def get_uniart_models(provider: Optional[Literal["uniart", "greena", "nsfw"]] = None):
    """Fetch the current owner-scoped gateway model list.

    The upstream response is normalized into the capability vocabulary used by
    iFrame selectors; credentials stay server-side.
    """
    if provider is not None:
        from ..user_config import get_user_config_store
        from ...utils.provider_catalog import fetch_provider_catalog
        runtime_config = get_user_config_store().get_runtime_provider(require_studio_user(), provider)
        try:
            models = fetch_provider_catalog(provider, runtime_config)
        except Exception as exc:
            logger.warning("Provider catalog unavailable for %s (%s)", provider, type(exc).__name__)
            raise HTTPException(status_code=502, detail=f"{provider}_models_unavailable") from exc
        return {"provider": runtime_config["provider"], "base_url": runtime_config["public_base_url"],
                "models": models, "fetched_at": time.time()}
    runtime_config = studio_uniart_config()
    base = runtime_config.get("public_base_url", runtime_config["base_url"]).rstrip("/")
    from ...utils.provider_catalog import catalog_name, catalog_label, fetch_selected_catalog
    try:
        models = fetch_selected_catalog(runtime_config) if catalog_name(runtime_config) else fetch_uniart_catalog(runtime_config)
    except Exception as exc:
        logger.warning("%s unavailable (%s)", catalog_label(runtime_config), type(exc).__name__)
        raise HTTPException(status_code=502, detail=f"{catalog_label(runtime_config)} 模型目录暂时不可用") from None
    return {"provider": catalog_name(runtime_config) or "mixed", "base_url": base, "models": models, "fetched_at": time.time()}


# ============================================
# Prop CRUD Endpoints
# ============================================

class CreatePropRequest(BaseModel):
    name: str
    description: str = ""

@app.post("/projects/{script_id}/props")
def create_prop(script_id: str, request: CreatePropRequest):
    """Creates a new prop in the project."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    import uuid
    from .models import Prop, GenerationStatus

    new_prop = Prop(
        id=f"prop_{uuid.uuid4().hex[:8]}",
        name=request.name,
        description=request.description,
        status=GenerationStatus.PENDING
    )

    script.props.append(new_prop)
    script.updated_at = time.time()
    pipeline._save_data()

    return signed_response(script)


@app.delete("/projects/{script_id}/props/{prop_id}")
def delete_prop(script_id: str, prop_id: str):
    """Deletes a prop from the project."""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    original_count = len(script.props)
    script.props = [p for p in script.props if p.id != prop_id]

    if len(script.props) == original_count:
        raise HTTPException(status_code=404, detail="Prop not found")

    pipeline.retire_episode_plan_asset(script, "prop", prop_id)
    # Remove prop references from frames
    for frame in script.frames:
        if prop_id in frame.prop_ids:
            frame.prop_ids.remove(prop_id)

    script.updated_at = time.time()
    pipeline._save_data()

    return signed_response(script)


# ─────────────────────────────────────────────────────────────────────────────
# Document CRUD — Script Editor document persistence
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime, timezone

_TRON_PROJECTS_DIR = Path.home() / ".tron" / "comic" / "projects"


class SaveDocumentRequest(BaseModel):
    content: dict  # Tiptap JSON document
    create_snapshot: bool = False


class DocumentSnapshotInfo(BaseModel):
    project_id: str
    timestamp: str  # ISO format
    created_at: str
    size_bytes: int


def _get_project_dir(project_id: str) -> Path:
    """Return the project directory, raising 404 if it doesn't exist."""
    project_dir = _TRON_PROJECTS_DIR / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return project_dir


def _ensure_history_dir(project_dir: Path) -> Path:
    """Ensure history/ subdirectory exists and return its path."""
    history_dir = project_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    return history_dir


def _snapshot_info(project_id: str, snapshot_path: Path) -> DocumentSnapshotInfo:
    """Build the stable metadata returned to the editor for one snapshot."""
    created_at = datetime.fromtimestamp(
        snapshot_path.stat().st_mtime, timezone.utc
    ).isoformat()
    return DocumentSnapshotInfo(
        project_id=project_id,
        timestamp=snapshot_path.stem,
        created_at=created_at,
        size_bytes=snapshot_path.stat().st_size,
    )


def _create_snapshot(project_dir: Path, project_id: Optional[str] = None) -> Optional[DocumentSnapshotInfo]:
    """Create a unique snapshot of the current document.json."""
    doc_path = project_dir / "document.json"
    if not doc_path.exists():
        return None
    history_dir = _ensure_history_dir(project_dir)
    # Include microseconds so repeated saves in one second never overwrite a
    # previous version. The collision loop also covers unusual filesystem clock
    # resolution and makes the invariant explicit.
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S%fZ")
    snapshot_path = history_dir / f"{ts}.json"
    while snapshot_path.exists():
        ts = f"{ts}-{uuid.uuid4().hex[:8]}"
        snapshot_path = history_dir / f"{ts}.json"
    shutil.copy2(str(doc_path), str(snapshot_path))
    return _snapshot_info(project_id or project_dir.name, snapshot_path)


def _document_response(project_id: str, content: dict, doc_path: Path) -> dict:
    """Return one consistent document envelope for load and restore."""
    updated_at = datetime.fromtimestamp(
        doc_path.stat().st_mtime, timezone.utc
    ).isoformat() if doc_path.exists() else None
    return {
        "project_id": project_id,
        "content": content,
        "updated_at": updated_at,
    }


def _legacy_script_document(project_id: str) -> dict:
    """Convert an older project's plain script text into editor blocks."""
    getter = getattr(pipeline, "get_script", None)
    script = getter(project_id) if callable(getter) else None
    text = getattr(script, "original_text", "") if script else ""
    blocks = []
    for line in (text or "").splitlines():
        if line:
            blocks.append({
                "type": "action",
                "content": [{"type": "text", "text": line}],
            })
    if not blocks and text:
        blocks.append({
            "type": "action",
            "content": [{"type": "text", "text": text}],
        })
    return {"type": "doc", "content": blocks}


@app.post("/projects/{project_id}/document")
def save_document(project_id: str, request: SaveDocumentRequest):
    """Save the Tiptap JSON document for a project."""
    project_dir = _TRON_PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    doc_path = project_dir / "document.json"

    snapshot = None
    # Optionally create a snapshot before overwriting
    if request.create_snapshot and doc_path.exists():
        snapshot = _create_snapshot(project_dir, project_id)

    try:
        with open(doc_path, "w", encoding="utf-8") as f:
            json.dump(request.content, f, ensure_ascii=False, indent=2)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save document: {e}")

    response = {
        "status": "ok",
        "project_id": project_id,
        "size_bytes": doc_path.stat().st_size,
        "updated_at": datetime.fromtimestamp(
            doc_path.stat().st_mtime, timezone.utc
        ).isoformat(),
        "snapshot_created": snapshot is not None,
    }
    if snapshot is not None:
        response["snapshot"] = snapshot.model_dump()
    return response


@app.get("/projects/{project_id}/document")
def load_document(project_id: str):
    """Load the Tiptap JSON document for a project."""
    project_dir = _TRON_PROJECTS_DIR / project_id
    doc_path = project_dir / "document.json"

    if not doc_path.exists():
        # Existing Studio projects predate document.json. Return their source
        # script as an editable action document so opening the editor never
        # silently drops the story opening.
        return _document_response(project_id, _legacy_script_document(project_id), doc_path)

    try:
        with open(doc_path, "r", encoding="utf-8") as f:
            content = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to load document: {e}")

    return _document_response(project_id, content, doc_path)


@app.get("/projects/{project_id}/document/snapshots")
def list_document_snapshots(project_id: str):
    """List all document snapshots for a project, ordered by time descending."""
    project_dir = _get_project_dir(project_id)
    history_dir = project_dir / "history"

    if not history_dir.exists():
        return []

    snapshots = []
    for f in history_dir.iterdir():
        if f.suffix == ".json" and f.is_file():
            snapshots.append(
                _snapshot_info(project_id, f)
            )

    # Sort by timestamp descending
    snapshots.sort(key=lambda s: s.timestamp, reverse=True)
    return snapshots


@app.post("/projects/{project_id}/document/snapshots")
def create_document_snapshot(project_id: str):
    """Create a snapshot of the current document."""
    project_dir = _get_project_dir(project_id)
    doc_path = project_dir / "document.json"

    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="No document to snapshot")

    snapshot = _create_snapshot(project_dir, project_id)
    return {
        "status": "ok",
        **(snapshot.model_dump() if snapshot else {}),
    }


@app.post("/projects/{project_id}/document/snapshots/{timestamp}/restore")
def restore_document_snapshot(project_id: str, timestamp: str):
    """Restore a document from a snapshot."""
    project_dir = _get_project_dir(project_id)
    history_dir = project_dir / "history"
    snapshot_path = history_dir / f"{timestamp}.json"

    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    doc_path = project_dir / "document.json"

    try:
        # Keep the document that is about to be replaced. This gives restore a
        # reversible boundary and lets a user continue editing either branch.
        _create_snapshot(project_dir, project_id)
        shutil.copy2(str(snapshot_path), str(doc_path))
        with open(doc_path, "r", encoding="utf-8") as f:
            content = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore snapshot: {e}")

    return _document_response(project_id, content, doc_path)


# ═══════════════════════════════════════════════════════════════
# Document Import/Export
# ═══════════════════════════════════════════════════════════════


class ImportDocRequest(BaseModel):
    filename: str
    content: str  # base64 encoded file content
    file_type: str  # "fdx" | "fountain" | "txt"


class ExportDocRequest(BaseModel):
    content: dict  # Tiptap JSON document
    format: str  # "pdf" | "docx"
    options: dict = {}


def _parse_fdx(xml_text: str) -> dict:
    """Parse FDX (Final Draft XML) into Tiptap JSON."""
    import re
    from xml.etree.ElementTree import ParseError

    # defusedxml guards against entity-expansion attacks (XML bomb).
    # Hard dependency (declared in requirements.txt) so the parse path is
    # always the hardened one; no stdlib fallback.
    from defusedxml.ElementTree import fromstring as _xml_fromstring

    # Reject DTD/entity declarations outright (defense-in-depth;
    # FDX files never legitimately contain them)
    if "<!DOCTYPE" in xml_text or "<!ENTITY" in xml_text:
        raise HTTPException(status_code=400, detail="FDX XML with DTD/entity declarations is not allowed")

    FDX_TO_NODE: dict = {
        "Scene Heading": "sceneHeading",
        "Action": "action",
        "Character": "characterCue",
        "Dialogue": "dialogue",
        "Parenthetical": "parenthetical",
        "Transition": "transition",
    }

    try:
        root = _xml_fromstring(xml_text)
    except (ParseError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid FDX XML: {e}")

    content_nodes = []
    # Find all Paragraph elements (support both with and without Content wrapper)
    paragraphs = root.findall(".//Paragraph")

    for para in paragraphs:
        para_type = para.get("Type", "Action")
        node_type = FDX_TO_NODE.get(para_type, "action")

        # Extract text from Text elements
        texts = []
        for text_el in para.findall(".//Text"):
            text_content = text_el.text or ""
            style = text_el.get("Style", "")
            marks = []
            if "Bold" in style:
                marks.append({"type": "bold"})
            if "Italic" in style:
                marks.append({"type": "italic"})
            if "Underline" in style:
                marks.append({"type": "underline"})

            text_node: dict = {"type": "text", "text": text_content}
            if marks:
                text_node["marks"] = marks
            texts.append(text_node)

        if not texts:
            texts = [{"type": "text", "text": ""}]

        node: dict = {"type": node_type, "content": texts}

        # Add attributes for scene headings
        if node_type == "sceneHeading":
            full_text = "".join(t.get("text", "") for t in texts)
            match = re.match(r"^(INT|EXT|INT/EXT|I/E)[\./\s]", full_text, re.IGNORECASE)
            attrs: dict = {"id": str(uuid.uuid4())}
            if match:
                attrs["intExt"] = match.group(1).upper()
            node["attrs"] = attrs

        content_nodes.append(node)

    return {"type": "doc", "content": content_nodes}


def _parse_fountain(text: str) -> dict:
    """Parse Fountain format text into Tiptap JSON."""
    import re

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    content_nodes = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Empty lines - skip
        if not stripped:
            i += 1
            continue

        # Forced scene heading (starts with .)
        if stripped.startswith(".") and len(stripped) > 1 and not stripped.startswith(".."):
            heading_text = stripped[1:]
            match = re.match(r"^(INT|EXT|INT/EXT|I/E)[\./\s]", heading_text, re.IGNORECASE)
            attrs: dict = {"id": str(uuid.uuid4())}
            if match:
                attrs["intExt"] = match.group(1).upper()
            content_nodes.append({
                "type": "sceneHeading",
                "attrs": attrs,
                "content": [{"type": "text", "text": heading_text}],
            })
            i += 1
            continue

        # Scene heading: INT./EXT. pattern
        if re.match(r"^(INT|EXT|INT/EXT|I/E)[\./\s]", stripped, re.IGNORECASE):
            match = re.match(r"^(INT|EXT|INT/EXT|I/E)", stripped, re.IGNORECASE)
            attrs = {"id": str(uuid.uuid4())}
            if match:
                attrs["intExt"] = match.group(1).upper()
            content_nodes.append({
                "type": "sceneHeading",
                "attrs": attrs,
                "content": [{"type": "text", "text": stripped}],
            })
            i += 1
            continue

        # Transition: all caps ending with colon, or starts with >
        if stripped.startswith(">"):
            t_text = stripped[1:].strip()
            content_nodes.append({
                "type": "transition",
                "content": [{"type": "text", "text": t_text}],
            })
            i += 1
            continue

        if (
            stripped.isupper()
            and stripped.endswith(":")
            and len(stripped) > 2
            and not stripped.startswith("(")
        ):
            content_nodes.append({
                "type": "transition",
                "content": [{"type": "text", "text": stripped}],
            })
            i += 1
            continue

        # Character cue: all uppercase, preceded by empty line (check)
        # In Fountain spec: a line of all-uppercase text
        if (
            stripped.isupper()
            and len(stripped) > 1
            and not stripped.endswith(":")
            and (i == 0 or not lines[i - 1].strip())
        ):
            content_nodes.append({
                "type": "characterCue",
                "content": [{"type": "text", "text": stripped}],
            })
            i += 1

            # Following lines until empty line are dialogue/parenthetical
            while i < len(lines) and lines[i].strip():
                dline = lines[i].strip()
                if dline.startswith("(") and dline.endswith(")"):
                    content_nodes.append({
                        "type": "parenthetical",
                        "content": [{"type": "text", "text": dline}],
                    })
                else:
                    content_nodes.append({
                        "type": "dialogue",
                        "content": [{"type": "text", "text": dline}],
                    })
                i += 1
            continue

        # Default: Action
        content_nodes.append({
            "type": "action",
            "content": [{"type": "text", "text": stripped}],
        })
        i += 1

    return {"type": "doc", "content": content_nodes}


def _parse_txt(text: str) -> dict:
    """Parse plain text into Tiptap JSON (all as action nodes)."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    content_nodes = []

    for line in lines:
        if line.strip():
            content_nodes.append({
                "type": "action",
                "content": [{"type": "text", "text": line.strip()}],
            })

    if not content_nodes:
        content_nodes = [{"type": "action", "content": [{"type": "text", "text": ""}]}]

    return {"type": "doc", "content": content_nodes}


@app.post("/projects/{project_id}/document/import")
def import_document(project_id: str, req: ImportDocRequest):
    """Import FDX/Fountain/TXT file and convert to Tiptap JSON."""
    import base64

    try:
        raw_bytes = base64.b64decode(req.content)
        # Script formats are text; detect common binary media early so a JPEG
        # header (0xff 0xd8) is never surfaced as a confusing UTF-8 traceback.
        if raw_bytes.startswith((b"\xff\xd8\xff", b"\x89PNG", b"RIFF")):
            raise ValueError("binary media was submitted to the document importer; choose a TXT, Fountain, or FDX file")
        try:
            text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = raw_bytes.decode("utf-16")
            except UnicodeDecodeError:
                text = raw_bytes.decode("gb18030", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode file content: {e}")

    file_type = req.file_type.lower()

    if file_type == "fdx":
        doc = _parse_fdx(text)
    elif file_type == "fountain":
        doc = _parse_fountain(text)
    elif file_type == "txt":
        doc = _parse_txt(text)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")

    return {"content": doc, "filename": req.filename, "file_type": file_type}


@app.post("/projects/{project_id}/document/export")
def export_document(project_id: str, req: ExportDocRequest):
    """Export Tiptap JSON to PDF/DOCX. Returns HTML fallback if libraries unavailable."""
    from fastapi.responses import Response

    doc = req.content
    fmt = req.format.lower()

    # Helper to extract plain text from Tiptap doc
    def extract_text(node: dict) -> str:
        if node.get("text"):
            return node["text"]
        children = node.get("content", [])
        return "".join(extract_text(c) for c in children)

    def doc_to_lines(doc: dict) -> list:
        lines = []
        for node in doc.get("content", []):
            node_type = node.get("type", "action")
            text = extract_text(node)
            lines.append((node_type, text))
        return lines

    if fmt == "pdf":
        # Try reportlab first, fallback to HTML
        try:
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Paragraph as RLParagraph, Spacer
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.enums import TA_CENTER, TA_RIGHT
            import io

            buffer = io.BytesIO()
            doc_pdf = SimpleDocTemplate(buffer, pagesize=letter,
                                        leftMargin=1.5 * inch, rightMargin=1 * inch,
                                        topMargin=1 * inch, bottomMargin=1 * inch)

            styles = getSampleStyleSheet()
            styles.add(ParagraphStyle("SceneHeading", parent=styles["Heading3"],
                                      fontName="Helvetica-Bold", fontSize=12,
                                      spaceAfter=6, spaceBefore=18))
            styles.add(ParagraphStyle("CharacterCue", parent=styles["Normal"],
                                      fontName="Helvetica-Bold", fontSize=10,
                                      alignment=TA_CENTER, spaceBefore=12))
            styles.add(ParagraphStyle("DialogueStyle", parent=styles["Normal"],
                                      fontName="Helvetica", fontSize=10,
                                      leftIndent=1.5 * inch, rightIndent=1.5 * inch))
            styles.add(ParagraphStyle("TransitionStyle", parent=styles["Normal"],
                                      fontName="Helvetica-Bold", fontSize=10,
                                      alignment=TA_RIGHT, spaceBefore=12))

            story = []
            lines = doc_to_lines(doc)
            style_map = {
                "sceneHeading": "SceneHeading",
                "characterCue": "CharacterCue",
                "dialogue": "DialogueStyle",
                "transition": "TransitionStyle",
            }

            for node_type, text in lines:
                style_name = style_map.get(node_type, "Normal")
                story.append(RLParagraph(text or " ", styles[style_name]))

            doc_pdf.build(story)
            pdf_bytes = buffer.getvalue()
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="script.pdf"'},
            )

        except ImportError:
            # Fallback: generate printable HTML
            from html import escape as _esc

            lines = doc_to_lines(doc)
            html_parts = [
                "<!DOCTYPE html><html><head><meta charset='utf-8'>",
                "<title>Script Export</title>",
                "<style>body{font-family:Courier,monospace;max-width:7in;margin:1in auto;}",
                ".scene-heading{font-weight:bold;text-transform:uppercase;margin-top:1.5em;}",
                ".character-cue{text-align:center;font-weight:bold;margin-top:1em;text-transform:uppercase;}",
                ".dialogue{margin-left:1.5in;margin-right:1.5in;}",
                ".parenthetical{margin-left:2in;margin-right:1.5in;font-style:italic;}",
                ".transition{text-align:right;font-weight:bold;margin-top:1em;}",
                "</style></head><body>",
            ]
            for node_type, text in lines:
                css_class = {
                    "sceneHeading": "scene-heading",
                    "characterCue": "character-cue",
                    "dialogue": "dialogue",
                    "parenthetical": "parenthetical",
                    "transition": "transition",
                    "action": "action",
                }.get(node_type, "action")
                html_parts.append(f'<p class="{css_class}">{_esc(text)}</p>')
            html_parts.append("</body></html>")
            html_content = "\n".join(html_parts)

            return Response(
                content=html_content.encode("utf-8"),
                media_type="text/html",
                headers={
                    "Content-Disposition": 'attachment; filename="script.html"',
                    "X-Export-Fallback": "true",
                },
            )

    elif fmt == "docx":
        # Try python-docx, fallback to plain text
        try:
            from docx import Document as DocxDocument
            from docx.shared import Pt, Inches
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            import io

            document = DocxDocument()
            lines = doc_to_lines(doc)

            for node_type, text in lines:
                if node_type == "sceneHeading":
                    p = document.add_paragraph()
                    p.style = document.styles["Heading 3"]
                    run = p.add_run(text.upper())
                    run.bold = True
                elif node_type == "characterCue":
                    p = document.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = p.add_run(text.upper())
                    run.bold = True
                elif node_type == "dialogue":
                    p = document.add_paragraph()
                    p.paragraph_format.left_indent = Inches(1.5)
                    p.paragraph_format.right_indent = Inches(1.5)
                    p.add_run(text)
                elif node_type == "transition":
                    p = document.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                    run = p.add_run(text.upper())
                    run.bold = True
                else:
                    document.add_paragraph(text)

            buffer = io.BytesIO()
            document.save(buffer)
            docx_bytes = buffer.getvalue()

            return Response(
                content=docx_bytes,
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                headers={"Content-Disposition": 'attachment; filename="script.docx"'},
            )

        except ImportError:
            # Fallback: plain text
            lines = doc_to_lines(doc)
            text_parts = []
            for node_type, text in lines:
                if node_type == "sceneHeading":
                    text_parts.append(f"\n{text.upper()}\n")
                elif node_type == "characterCue":
                    text_parts.append(f"\n    {text.upper()}")
                elif node_type == "dialogue":
                    text_parts.append(f"        {text}")
                elif node_type == "transition":
                    text_parts.append(f"\n{'':>60}{text.upper()}")
                else:
                    text_parts.append(text)
            plain = "\n".join(text_parts)

            return Response(
                content=plain.encode("utf-8"),
                media_type="text/plain",
                headers={
                    "Content-Disposition": 'attachment; filename="script.txt"',
                    "X-Export-Fallback": "true",
                },
            )

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {fmt}")


# ═══════════════════════════════════════════════════════════════
# Script Editor - Derivation Sync & Pipeline Integration
# ═══════════════════════════════════════════════════════════════


class SyncDerivationRequest(BaseModel):
    scenes: List[Dict[str, Any]] = Field(default_factory=list)
    characters: List[Dict[str, Any]] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    estimated_duration: float = 0
    word_count: int = 0
    confidence_score: float = 0


class DeriveGapEntity(BaseModel):
    type: str  # 'character' | 'prop' | 'beat' | 'location'
    name: str
    description: Optional[str] = None
    confidence: float  # 0.0-1.0
    scene_index: Optional[int] = None  # 关联场景


class DeriveGapsResponse(BaseModel):
    entities: List[DeriveGapEntity]
    cached: bool = False  # 是否来自缓存


class DeriveGapsRequest(BaseModel):
    already_extracted: Optional[Dict[str, List[str]]] = None  # {"scenes": [...], "characters": [...]}
    gaps: List[str] = Field(default_factory=lambda: ["characters", "props", "beats", "locations"])
    raw_text_blocks: Optional[List[str]] = None  # 原始文本块（可选，否则从项目文档读取）


class ConfirmShotBlockRequest(BaseModel):
    shot_type: Optional[str] = None
    camera_movement: Optional[str] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    characters: List[str] = Field(default_factory=list)


@app.post("/projects/{project_id}/sync_derivation")
def sync_derivation(project_id: str, req: SyncDerivationRequest):
    """前端推送 L1 派生结果到后端存储"""
    project_dir = _get_project_dir(project_id)
    derivation_path = project_dir / "derivation.json"

    data = {
        "scenes": req.scenes,
        "characters": req.characters,
        "locations": req.locations,
        "estimated_duration": req.estimated_duration,
        "word_count": req.word_count,
        "confidence_score": req.confidence_score,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }

    derivation_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"status": "ok", "synced_at": data["synced_at"]}


# ── derive_gaps cache & helpers ──────────────────────────────────────────
_derive_cache: Dict[str, Tuple[float, List[dict]]] = {}
_DERIVE_CACHE_TTL = 6 * 3600  # 6 hours


def _derive_cache_key(text_blocks: List[str], gaps: List[str]) -> str:
    content = "".join(text_blocks) + "|" + "|".join(sorted(gaps))
    return hashlib.md5(content.encode()).hexdigest()


def _derive_cache_get(key: str) -> Optional[List[dict]]:
    if key in _derive_cache:
        timestamp, result = _derive_cache[key]
        if time.time() - timestamp < _DERIVE_CACHE_TTL:
            return result
        del _derive_cache[key]
    return None


def _build_derive_gaps_prompt(
    text_blocks: List[str],
    gaps: List[str],
    already_extracted: Dict[str, List[str]],
) -> str:
    """Construct the LLM prompt for incremental gap extraction."""
    text_content = "\n---\n".join(text_blocks)

    already_section = ""
    if already_extracted:
        parts = []
        for k, v in already_extracted.items():
            parts.append(f"  - {k}: {', '.join(v)}")
        already_section = (
            "\n\n以下内容已被提取，请勿重复输出：\n" + "\n".join(parts)
        )

    gap_descriptions = {
        "characters": "角色（人物名称、简短描述）",
        "props": "道具（从动作描述中识别关键道具）",
        "beats": "节拍（场景中的情感转折点或关键节奏）",
        "locations": "地点（从场景描述中提取具体地点）",
    }
    requested = ", ".join(gap_descriptions.get(g, g) for g in gaps)

    return f"""你是一名专业的剧本分析助手。请从以下文本中提取缺失的结构化信息。

需要提取的类型：{requested}
{already_section}

请以 JSON 数组格式返回结果，每个元素包含：
- type: 类型（"character" | "prop" | "beat" | "location"）
- name: 名称
- description: 简短描述（可选）
- confidence: 置信度 0.0-1.0
- scene_index: 关联场景序号（从 0 开始，可选）

仅返回 JSON 数组，不要包含其他文字。

# 文本内容
{text_content}"""


def _call_llm_for_gaps(
    text_blocks: List[str],
    gaps: List[str],
    already_extracted: Dict[str, List[str]],
) -> List[DeriveGapEntity]:
    """Call LLM (Qwen) for incremental gap extraction with 2s timeout."""
    from .llm_adapter import LLMAdapter
    from .llm import _strip_markdown_json

    adapter = LLMAdapter()
    if not adapter.is_configured:
        logger.warning("derive_gaps: LLM not configured, returning empty")
        return []

    prompt = _build_derive_gaps_prompt(text_blocks, gaps, already_extracted)
    messages = [{"role": "user", "content": prompt}]

    def _do_call():
        return adapter.chat(
            messages=messages,
            response_format={"type": "json_object"},
        )

    # Timeout control: 2 seconds
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_do_call)
            raw = future.result(timeout=2)
    except concurrent.futures.TimeoutError:
        logger.warning("derive_gaps: LLM call timed out (2s), returning empty")
        return []
    except Exception as e:
        logger.error(f"derive_gaps: LLM call failed: {e}")
        return []

    # Parse response
    try:
        raw = _strip_markdown_json(raw)
        data = json.loads(raw)
        # Handle both top-level array and {"entities": [...]}
        if isinstance(data, dict):
            data = data.get("entities", data.get("items", []))
        if not isinstance(data, list):
            data = []
    except (json.JSONDecodeError, TypeError):
        logger.warning("derive_gaps: failed to parse LLM JSON response")
        return []

    entities = []
    for item in data:
        if not isinstance(item, dict):
            continue
        entity_type = item.get("type", "")
        name = item.get("name", "")
        if not entity_type or not name:
            continue
        entities.append(DeriveGapEntity(
            type=entity_type,
            name=name,
            description=item.get("description"),
            confidence=max(0.0, min(1.0, float(item.get("confidence", 0.5)))),
            scene_index=item.get("scene_index"),
        ))
    return entities


@app.post("/projects/{project_id}/derive_gaps")
def derive_gaps(project_id: str, req: DeriveGapsRequest):
    """L3 LLM 增量补全：支持缓存、超时降级、增量去重。"""
    project_dir = _get_project_dir(project_id)

    # 1. Resolve text blocks
    text_blocks = req.raw_text_blocks
    if not text_blocks:
        # Fallback: try to read project script file
        script_path = project_dir / "script.json"
        if script_path.exists():
            try:
                script_data = json.loads(script_path.read_text(encoding="utf-8"))
                scenes = script_data.get("scenes", [])
                text_blocks = [s.get("description", "") or s.get("name", "") for s in scenes if isinstance(s, dict)]
            except Exception:
                text_blocks = []
        if not text_blocks:
            return DeriveGapsResponse(entities=[], cached=False)

    # 2. Check cache
    cache_key = _derive_cache_key(text_blocks, req.gaps)
    cached_result = _derive_cache_get(cache_key)
    if cached_result is not None:
        entities = [DeriveGapEntity(**e) for e in cached_result]
        # Filter against already_extracted even for cached results
        if req.already_extracted:
            entities = _filter_already_extracted(entities, req.already_extracted)
        return DeriveGapsResponse(entities=entities, cached=True)

    # 3. Call LLM
    already = req.already_extracted or {}
    entities = _call_llm_for_gaps(text_blocks, req.gaps, already)

    # 4. Filter duplicates against already_extracted
    if req.already_extracted:
        entities = _filter_already_extracted(entities, req.already_extracted)

    # 5. Store in cache
    _derive_cache[cache_key] = (time.time(), [e.dict() for e in entities])

    return DeriveGapsResponse(entities=entities, cached=False)


def _filter_already_extracted(
    entities: List[DeriveGapEntity],
    already_extracted: Dict[str, List[str]],
) -> List[DeriveGapEntity]:
    """Remove entities whose name already appears in already_extracted."""
    # Build a set of known names (normalized)
    known_names: set = set()
    for names_list in already_extracted.values():
        for n in names_list:
            known_names.add(n.strip().lower())
    return [e for e in entities if e.name.strip().lower() not in known_names]


@app.post("/projects/{project_id}/shot_blocks/{shot_id}/confirm")
def confirm_shot_block(project_id: str, shot_id: str, req: ConfirmShotBlockRequest):
    """确认 ShotBlock，更新状态为 confirmed"""
    project_dir = _get_project_dir(project_id)
    shot_blocks_path = project_dir / "shot_blocks.json"

    # Load existing shot_blocks or create empty dict
    if shot_blocks_path.exists():
        shot_blocks = json.loads(shot_blocks_path.read_text(encoding="utf-8"))
    else:
        shot_blocks = {}

    # Build the confirmed shot block entry
    confirmed = {
        "shot_id": shot_id,
        "status": "confirmed",
        "shot_type": req.shot_type,
        "camera_movement": req.camera_movement,
        "duration": req.duration,
        "description": req.description,
        "characters": req.characters,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
    }

    shot_blocks[shot_id] = confirmed

    shot_blocks_path.write_text(
        json.dumps(shot_blocks, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return confirmed
