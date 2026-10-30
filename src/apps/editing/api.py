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

class FolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: str | None = Field(None, max_length=80)

class MaterialFolderRequest(BaseModel):
    folder_id: str | None = Field(None, max_length=80)


def public(value, user):
    return sign_studio_media_paths(value, user.owner_profile_id)

@router.get('/projects')
def projects(user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).list(), user)

@router.post('/projects', status_code=201)
def create(body: CreateRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).create(body.title), user)

@router.get('/folders')
def folders(user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).folders(), user)

@router.post('/folders', status_code=201)
def create_folder(body: FolderRequest, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).create_folder(body.name, body.parent_id), user)

@router.delete('/folders/{folder_id}')
def delete_folder(folder_id: str, user: UserContext = Depends(require_studio_user)):
    return EditingService(user).delete_folder(folder_id)

@router.patch('/folders/{folder_id}')
def rename_folder(folder_id: str, body: FolderRequest, user: UserContext = Depends(require_studio_user)):
    return EditingService(user).rename_folder(folder_id, body.name)

@router.get('/materials')
def materials(q: str = Query('', max_length=120), cursor: int = Query(0, ge=0), folder_id: str | None = Query(None), user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).materials_page(q, cursor, folder_id), user)

@router.post('/materials', status_code=201)
def upload(file: UploadFile = File(...), folder_id: str | None = Query(None), user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).upload(file.file, file.filename or 'material.mp4', folder_id), user)

@router.get('/materials/{key}')
def material(key: str, user: UserContext = Depends(require_studio_user)):
    return public(EditingService(user).resolve(key)[0], user)

@router.delete('/materials/{key}')
def delete_material(key: str, user: UserContext = Depends(require_studio_user)):
    return EditingService(user).delete_material(key)

@router.patch('/materials/{key}')
def move_material(key: str, body: MaterialFolderRequest, user: UserContext = Depends(require_studio_user)):
    return EditingService(user).assign_folder(key, body.folder_id)

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
