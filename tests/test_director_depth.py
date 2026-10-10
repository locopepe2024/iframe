from copy import deepcopy
import json
from pathlib import Path
import subprocess

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps import director_depth as depth
from src.apps.identity import UserContext, require_user_context


def snapshot():
    return dict(frame=1, fps=24, cameraLabel='test', nearM=0, farM=10, width=64, height=64,
        camera=dict(type='ORTHO', matrixWorld=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
                    near=0.1, far=100, aspect=1, verticalFovDeg=42, orthoHeight=2),
        meshes=[dict(positions=[[-2,-2,-2],[2,-2,-2],[2,2,-2],[-2,2,-2]], triangles=[[0,1,2],[0,2,3]])])


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    app = FastAPI(); app.include_router(depth.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext('a','a','','')
    return TestClient(app), app


def test_bounds():
    depth.Snapshot(**snapshot())
    for changes in ({'farM':0}, {'width':1}, {'frame':0}, {'camera':{**snapshot()['camera'], 'far':0.01}}):
        with pytest.raises(ValueError): depth.Snapshot(**{**snapshot(), **changes})
    bad = snapshot(); bad['meshes'][0]['triangles'] = [[0,1,9]]
    with pytest.raises(ValueError): depth.Snapshot(**bad)


def test_runtime_unavailable(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(depth.shutil, 'which', lambda _: None)
    monkeypatch.delenv('DIRECTOR_DEPTH_BLENDER_BIN', raising=False)
    assert not c.get('/director3d/depth-capability').json()['available']
    assert c.post('/director3d/depth-tasks', json=snapshot()).status_code == 503


def test_failure_persistence_and_owner_isolation(client, monkeypatch):
    c, app = client
    monkeypatch.setattr(depth, 'runtime', lambda: 'test-blender')
    def failed(*args, **kwargs): raise subprocess.TimeoutExpired('test-blender', 120)
    monkeypatch.setattr(depth.subprocess, 'run', failed)
    response = c.post('/director3d/depth-tasks', json=snapshot())
    assert response.status_code == 202
    task_id = response.json()['id']
    result = c.get(f'/director3d/depth-tasks/{task_id}').json()
    assert result['status'] == 'failed' and '超时' in result['error']
    app.dependency_overrides[require_user_context] = lambda: UserContext('b','b','','')
    assert c.get('/director3d/depth-tasks').json() == []
    assert c.get(f'/director3d/depth-tasks/{task_id}').status_code == 404
    assert c.get(f'/director3d/depth-tasks/{task_id}/outputs/preview').status_code == 404


def test_real_blender_snapshot(client, monkeypatch):
    binary = Path('/Applications/Blender.app/Contents/MacOS/Blender')
    if not binary.exists(): pytest.skip('local Blender unavailable')
    monkeypatch.setenv('DIRECTOR_DEPTH_BLENDER_BIN', str(binary))
    c, app = client
    response = c.post('/director3d/depth-tasks', json=snapshot())
    assert response.status_code == 202, response.text
    task_id = response.json()['id']
    result = c.get(f'/director3d/depth-tasks/{task_id}').json()
    assert result['status'] == 'completed', result
    manifest = c.get(f'/director3d/depth-tasks/{task_id}/outputs/manifest').json()
    assert manifest['unit'] == 'meter' and manifest['resolution'] == [64,64]
    preview = c.get(f'/director3d/depth-tasks/{task_id}/outputs/preview')
    assert preview.content.startswith(b'\x89PNG')
    from PIL import Image
    from io import BytesIO
    image = Image.open(BytesIO(preview.content))
    assert abs(image.getpixel((32,32)) / 65535 - .2) < .01
    assert c.get(f'/director3d/depth-tasks/{task_id}/outputs/meters').status_code == 200
