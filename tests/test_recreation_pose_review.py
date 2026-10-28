"""Real source-frame extraction and owner/version checked annotation persistence."""
import pytest
from fastapi import HTTPException
from src.apps.recreation import pose_review
from src.apps.recreation.service import RecreationService
from src.apps.identity import UserContext
from tests.test_recreation import service, video, completed


def payload(frame):
    return {**frame,'status':'reviewed','contact':'left','depth_order':'right_front',
            'joints':{name:{'xy':[20,30],'visibility':'uncertain'} for name in pose_review.JOINTS}}


def test_extract_save_restore_without_timeline_revision_change(service,video):
    project=completed(service,video);pts=project['analysis']['frame_pts'][0]
    frame=pose_review.prepare(service,project['id'],project['analysis_id'],pts)
    assert frame['source_frame']==1 and max(frame['width'],frame['height'])==960
    assert frame['revision']==0 and frame['joints']=={}
    assert pose_review.prepare(service,project['id'],project['analysis_id'],pts)['media_id']==frame['media_id']
    saved=pose_review.save(service,project['id'],payload(frame))
    assert saved['revision']==1 and saved['depth_order']=='right_front'
    assert pose_review.reviews(service,project['id'])['frames']==[saved]
    assert service.get(project['id'])['revision']==project['revision']
    with pytest.raises(HTTPException) as exc:pose_review.save(service,project['id'],payload(frame))
    assert exc.value.status_code==409


def test_invalid_points_source_identity_and_owner_rejected(service,video):
    project=completed(service,video);frame=pose_review.prepare(service,project['id'],project['analysis_id'],project['analysis']['frame_pts'][0])
    for key,value in [('analysis_id','stale'),('image_sha256','wrong'),('pts',-1),('depth_order','madeup')]:
        bad=payload(frame);bad[key]=value
        with pytest.raises(HTTPException):pose_review.save(service,project['id'],bad)
    for xy in [[-1,0],[float('nan'),2],[0,frame['height']+1]]:
        bad=payload(frame);bad['joints']['left_knee']['xy']=xy
        with pytest.raises(HTTPException):pose_review.save(service,project['id'],bad)
    bad=payload(frame);bad['joints'].pop('right_knee')
    with pytest.raises(HTTPException):pose_review.save(service,project['id'],bad)
    bad['status']='draft';assert pose_review.save(service,project['id'],bad)['status']=='draft'
    other=RecreationService(UserContext('other','other','Other',''))
    with pytest.raises(HTTPException) as exc:pose_review.reviews(other,project['id'])
    assert exc.value.status_code==404
    with pytest.raises(HTTPException):pose_review.prepare(service,project['id'],project['analysis_id'],-1)


def test_changed_image_and_analysis_are_not_reused(service,video):
    project=completed(service,video);frame=pose_review.prepare(service,project['id'],project['analysis_id'],project['analysis']['frame_pts'][0])
    saved=pose_review.save(service,project['id'],payload(frame))
    with service.db() as db:
        record=service._get(db,project['id']);record['analysis_id']='next-analysis';service._save(db,record)
    assert pose_review.reviews(service,project['id'])['frames']==[]
    with pytest.raises(HTTPException):pose_review.save(service,project['id'],payload(saved))
    with service.db() as db:
        record=service._get(db,project['id']);record['analysis_id']=project['analysis_id'];service._save(db,record)
    service._path(frame['image_url']).write_bytes(b'changed')
    with pytest.raises(HTTPException) as exc:pose_review.save(service,project['id'],payload(saved))
    assert exc.value.status_code==409


def test_authenticated_api_roundtrip_and_request_validation(service, video, monkeypatch):
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only-signing-key")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.recreation.api import router
    from src.apps.studio_access import require_studio_user
    project = completed(service, video)
    app = FastAPI(); app.include_router(router)
    app.dependency_overrides[require_studio_user] = lambda: service.user
    client = TestClient(app)
    url = f"/recreation/projects/{project['id']}/pose-review"
    result = client.post(url+'/frame', json={'analysis_id':project['analysis_id'],'pts':project['analysis']['frame_pts'][0]})
    assert result.status_code == 200, result.text
    frame = result.json()
    assert frame['image_url'] != '' and frame['image_sha256']
    result = client.put(url+'/frame', json=payload(frame))
    assert result.status_code == 200, result.text
    assert client.get(url).json()['frames'][0]['depth_order'] == 'right_front'
    assert client.post(url+'/frame',json={'analysis_id':project['analysis_id'],'pts':1.5}).status_code == 422
    app.dependency_overrides[require_studio_user] = lambda: UserContext('foreign','foreign','Foreign','')
    assert client.get(url).status_code == 404


def test_point_semantics_are_preserved_and_legacy_is_uncertain(service,video):
    project=completed(service,video)
    frame=pose_review.prepare(service,project['id'],project['analysis_id'],project['analysis']['frame_pts'][0])
    data=payload(frame)
    data['joints']['left_hip']['semantic']='body_contour'
    data['joints']['left_knee']['semantic']='joint'
    saved=pose_review.save(service,project['id'],data)
    restored=pose_review.prepare(service,project['id'],project['analysis_id'],frame['pts'])
    assert restored['joints']['left_hip']['semantic']=='body_contour'
    assert restored['joints']['left_knee']['semantic']=='joint'
    assert restored['joints']['right_hip']['semantic']=='uncertain'
    assert restored['joints']['left_hip']['xy']==data['joints']['left_hip']['xy']
    bad=payload(saved);bad['joints']['left_hip']['semantic']='waist-is-bone'
    with pytest.raises(HTTPException):pose_review.save(service,project['id'],bad)
