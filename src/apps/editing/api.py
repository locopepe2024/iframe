"""Owner-scoped independent editing endpoints."""
from fastapi import APIRouter, Depends, File, UploadFile, Query, HTTPException, Response
from pydantic import BaseModel, Field
from ..identity import UserContext
from ..studio_access import require_studio_user, sign_studio_media_paths
from ..comic_gen.models import AssemblyEditPlan
from ..comic_gen.assembly_subtitles import export_srt
from .service import EditingService

router = APIRouter(prefix='/editing', tags=['editing'])

class CreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)

class RevisionRequest(BaseModel):
    revision: int = Field(ge=0)

class SaveRequest(RevisionRequest):
    plan: AssemblyEditPlan

class RestoreRequest(RevisionRequest):
    target_revision: int = Field(ge=0)


def public(value, user):
    return sign_studio_media_paths(value, user.owner_profile_id)

@router.get('/projects')
def projects(user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).list(), user)

@router.post('/projects', status_code=201)
def create(body: CreateRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).create(body.title), user)

@router.get('/materials')
def materials(q: str = Query('', max_length=120), cursor: int = Query(0, ge=0), user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).materials(q, cursor), user)

@router.post('/materials', status_code=201)
def upload(file: UploadFile = File(...), user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).upload(file.file, file.filename or 'material.mp4'), user)

@router.get('/materials/{key}')
def material(key: str, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).resolve(key)[0], user)

@router.get('/projects/{edit_id}')
def project(edit_id: str, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).get(edit_id), user)

@router.put('/projects/{edit_id}/plan')
def save(edit_id: str, body: SaveRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).save(edit_id, body.revision, body.plan), user)

@router.get('/projects/{edit_id}/versions')
def versions(edit_id: str, user: UserContext = Depends(require_studio_user)):
    return EditingService(user).versions(edit_id)

@router.post('/projects/{edit_id}/restore')
def restore(edit_id: str, body: RestoreRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).restore(edit_id, body.revision, body.target_revision), user)

@router.post('/projects/{edit_id}/render')
def render(edit_id: str, body: RevisionRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).render(edit_id, body.revision), user)

@router.get('/projects/{edit_id}/subtitles/{lane_id}')
def subtitles(edit_id: str, lane_id: str, user: UserContext = Depends(require_studio_user)):
    record = EditingService(user).get(edit_id)
    if not record['plan']:
        raise HTTPException(409, 'Save timeline before exporting subtitles')
    try:
        text = export_srt(AssemblyEditPlan.model_validate(record['plan']), lane_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(text, media_type='application/x-subrip', headers={'Content-Disposition': 'attachment; filename="subtitles.srt"'})
