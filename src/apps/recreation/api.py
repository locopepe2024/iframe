"""Authenticated recreation APIs. Processing stays in the backend's FFmpeg runtime."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, Query, Form
from pydantic import BaseModel, Field, StrictInt

from ..identity import UserContext
from ..studio_access import require_studio_user, sign_studio_media_paths
from .service import RecreationService

router = APIRouter(prefix="/recreation", tags=["recreation"])


class AnalyzeRequest(BaseModel):
    revision: int = Field(ge=0)

class GenerationPlanRequest(AnalyzeRequest):
    model: str = Field(default="uniart/minimax-h3-vip", min_length=1, max_length=120)


class ConfirmRequest(AnalyzeRequest):
    analysis_id: str
    cut_pts: list[StrictInt] = Field(max_length=120)


class EvidenceRequest(BaseModel):
    analysis_id: str
    pts: StrictInt


def public(record, user):
    return sign_studio_media_paths(record, user.owner_profile_id)


@router.get("/projects")
def projects(user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).list(), user)


@router.get("/media")
def media(q: str = "", kind: str | None = None, project_id: str | None = None,
         limit: int = Query(50, ge=1, le=100), cursor: int = Query(0, ge=0),
         user: UserContext = Depends(require_studio_user)):
    result = RecreationService(user).search_media(query=q, kind=kind, project_id=project_id, limit=limit, cursor=cursor)
    result["items"] = public(result["items"], user)
    return result


@router.post("/projects", status_code=201)
def register(file: UploadFile = File(...), user: UserContext = Depends(require_studio_user)):
    try:
        return public(RecreationService(user).register(file.file, file.filename or "source.mp4"), user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/projects/{project_id}")
def project(project_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).get(project_id), user)


@router.post("/projects/{project_id}/reindex")
def reindex(project_id: str, user: UserContext = Depends(require_studio_user)):
    try:
        return public(RecreationService(user).reindex(project_id), user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/projects/{project_id}/analyze", status_code=202)
def start(project_id: str, request: AnalyzeRequest, background: BackgroundTasks,
          user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    record = service.start(project_id, request.revision)
    background.add_task(service.process, project_id, record["analysis_id"])
    return public(record, user)


@router.put("/projects/{project_id}/timeline")
def confirm(project_id: str, request: ConfirmRequest, user: UserContext = Depends(require_studio_user)):
    try:
        record = RecreationService(user).confirm(project_id, request.revision, request.analysis_id, request.cut_pts)
        return public(record, user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/projects/{project_id}/evidence")
def evidence(project_id: str, request: EvidenceRequest, user: UserContext = Depends(require_studio_user)):
    try:
        return public(RecreationService(user).evidence(project_id, request.analysis_id, request.pts), user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class ShotReferencesRequest(AnalyzeRequest):
    analysis_id: str
    reference_media_id: str | None = Field(default=None, min_length=1, max_length=64)
    replacement_media_id: str | None = Field(default=None, min_length=1, max_length=64)
    instruction: str = Field(default="", max_length=4000)
    description: str | None = Field(default=None, max_length=6000)
    instruction_refs: list[dict] = Field(default_factory=list, max_length=4)


@router.get("/media/{media_id}")
def get_media(media_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).media(media_id), user)


@router.post("/projects/{project_id}/images", status_code=201)
def upload_image(project_id: str, file: UploadFile = File(...), kind: str = Form(...),
                 parent_media_id: str | None = Form(None), user: UserContext = Depends(require_studio_user)):
    try:
        return public(RecreationService(user).upload_image(project_id, file.file, file.filename or "image", kind, parent_media_id), user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.put("/projects/{project_id}/shots/{shot_id}/references")
def bind_shot(project_id: str, shot_id: str, request: ShotReferencesRequest,
              user: UserContext = Depends(require_studio_user)):
    try:
        return public(RecreationService(user).bind_shot(project_id, shot_id, request.revision, request.analysis_id,
                      request.reference_media_id, request.replacement_media_id, request.instruction, request.description, request.instruction_refs), user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/projects/{project_id}/generation-plan")
def generation_plan(project_id: str, request: GenerationPlanRequest, user: UserContext = Depends(require_studio_user)):
    try:
        return RecreationService(user).generation_plan(project_id, request.revision, request.model)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
