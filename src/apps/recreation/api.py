"""Authenticated recreation APIs. Processing stays in the backend's FFmpeg runtime."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, Query, Form
from pydantic import BaseModel, Field, StrictInt

from ..identity import UserContext
from ..studio_access import require_studio_user, sign_studio_media_paths
from .service import (
    DEFAULT_KEYFRAME_IMAGE_MODEL,
    DEFAULT_RECREATION_VIDEO_MODEL,
    RecreationService,
)

router = APIRouter(prefix="/recreation", tags=["recreation"])


class AnalyzeRequest(BaseModel):
    revision: int = Field(ge=0)

class GenerationPlanRequest(AnalyzeRequest):
    model: str = Field(default=DEFAULT_RECREATION_VIDEO_MODEL, min_length=1, max_length=120)
    audio_policy: str = "silent"
    soundscape: str = Field(default="", max_length=2000)
    generation_durations: dict[str, int] = Field(default_factory=dict)


class GenerationSubmitRequest(GenerationPlanRequest):
    accept_cost: bool = False
    seed: int | None = None


class GenerationRetryRequest(BaseModel):
    accept_cost: bool = False


class AssemblySubmitRequest(AnalyzeRequest):
    generation_id: str = Field(min_length=1, max_length=64)


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
    service = RecreationService(user)
    service.recover_generation_tasks()
    return public(service.list(), user)


@router.get("/models")
def models(user: UserContext = Depends(require_studio_user)):
    """Return the owner catalog filtered to verified recreation contracts."""
    return RecreationService(user).model_options()


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
    service = RecreationService(user)
    service.recover_generation_tasks()
    return public(service.get(project_id), user)


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


@router.post("/projects/{project_id}/analyze/{analysis_id}/cancel")
def cancel_analysis(project_id: str, analysis_id: str, request: AnalyzeRequest,
                    user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).cancel_analysis(project_id, request.revision, analysis_id), user)


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


class KeyframeTaskRequest(AnalyzeRequest):
    analysis_id: str
    reference_media_id: str = Field(min_length=1, max_length=64)
    replacement_media_id: str = Field(min_length=1, max_length=64)
    instruction: str = Field(default="", max_length=2000)
    model: str = Field(default=DEFAULT_KEYFRAME_IMAGE_MODEL, min_length=1, max_length=120)
    accept_cost: bool = False


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


@router.post("/projects/{project_id}/shots/{shot_id}/keyframe-tasks", status_code=202)
def create_keyframe_task(project_id: str, shot_id: str, request: KeyframeTaskRequest,
                         background: BackgroundTasks, user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    try:
        task = service.create_keyframe_task(
            project_id, shot_id, request.revision, request.analysis_id,
            request.reference_media_id, request.replacement_media_id,
            request.instruction, request.accept_cost, request.model,
        )
        background.add_task(service.process_keyframe_task, task["task_id"])
        return public(task, user)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/keyframe-tasks/{task_id}")
def keyframe_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).keyframe_task(task_id), user)


@router.get("/projects/{project_id}/keyframe-tasks")
def keyframe_tasks(project_id: str, shot_id: str | None = None,
                   user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).keyframe_tasks(project_id, shot_id), user)


@router.post("/keyframe-tasks/{task_id}/cancel")
def cancel_keyframe_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).cancel_keyframe_task(task_id), user)


@router.post("/projects/{project_id}/generation-plan")
def generation_plan(project_id: str, request: GenerationPlanRequest, user: UserContext = Depends(require_studio_user)):
    try:
        return RecreationService(user).generation_plan(project_id, request.revision, request.model,
                   request.audio_policy, request.soundscape, request.generation_durations)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/projects/{project_id}/generation-tasks", status_code=202)
def submit_generation(project_id: str, request: GenerationSubmitRequest, background: BackgroundTasks,
                      user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    result = service.submit_generation(project_id, request.revision, request.model, request.audio_policy,
                                       request.soundscape, request.generation_durations, request.accept_cost, request.seed)
    for task in result["tasks"]:
        background.add_task(service.process_generation_task, task["task_id"])
    return public(result, user)


@router.get("/projects/{project_id}/generation-tasks")
def generation_tasks(project_id: str, generation_id: str | None = None,
                     user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    service.recover_generation_tasks()
    return public(service.generation_tasks(project_id, generation_id), user)


@router.get("/generation-tasks/{task_id}")
def generation_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).generation_task(task_id), user)


@router.post("/generation-tasks/{task_id}/cancel")
def cancel_generation_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).cancel_generation_task(task_id), user)


@router.post("/generation-tasks/{task_id}/retry", status_code=202)
def retry_generation_task(task_id: str, request: GenerationRetryRequest, background: BackgroundTasks,
                         user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    task = service.retry_generation_task(task_id, request.accept_cost)
    background.add_task(service.process_generation_task, task_id)
    return public(task, user)


@router.post("/projects/{project_id}/assembly-tasks", status_code=202)
def submit_assembly(project_id: str, request: AssemblySubmitRequest, background: BackgroundTasks,
                    user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    try:
        task = service.submit_assembly(project_id, request.revision, request.generation_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    background.add_task(service.process_assembly_task, task["task_id"])
    return public(task, user)


@router.get("/projects/{project_id}/assembly-tasks")
def assembly_tasks(project_id: str, generation_id: str | None = None,
                   user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).assembly_tasks(project_id, generation_id), user)


@router.get("/assembly-tasks/{task_id}")
def assembly_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).assembly_task(task_id), user)


@router.post("/assembly-tasks/{task_id}/cancel")
def cancel_assembly_task(task_id: str, user: UserContext = Depends(require_studio_user)):
    return public(RecreationService(user).cancel_assembly_task(task_id), user)


@router.post("/assembly-tasks/{task_id}/retry", status_code=202)
def retry_assembly_task(task_id: str, background: BackgroundTasks,
                        user: UserContext = Depends(require_studio_user)):
    service = RecreationService(user)
    task = service.retry_assembly_task(task_id)
    background.add_task(service.process_assembly_task, task_id)
    return public(task, user)
