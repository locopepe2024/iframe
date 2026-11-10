"""A screenplay episode creates one production project, then reopens it."""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api
from src.apps.identity import UserContext


def doc(text):
    return {'type': 'doc', 'content': [
        {'type': 'action', 'content': [{'type': 'text', 'text': text}]}]}


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_TRON_SCRIPT_DOCUMENTS_DIR', Path(tmp_path) / 'scripts')
    monkeypatch.setattr(api, '_TRON_PROJECTS_DIR', Path(tmp_path) / 'projects')
    monkeypatch.setattr(api.pipeline, 'scripts', {})
    monkeypatch.setattr(api.pipeline, '_save_data', lambda: None)
    monkeypatch.setattr(api, 'signed_response', lambda value: value)
    owner = UserContext('user-a', 'profile-a', 'A', '')
    episode = api.create_script_document(api.CreateScriptDocumentRequest(
        title='第1集', content=doc('第一集正文')), owner)
    return owner, episode


def create(owner, episode):
    return api.create_project(api.CreateProjectRequest(
        title=episode['title'], text='ignored client text',
        source_script_document_id=episode['id']), skip_analysis=True, user=owner)


def test_reentry_reuses_project_and_preserves_production_changes(workspace):
    owner, episode = workspace
    assert api.get_script_document_project(episode['id'], owner) == {'project_id': None}
    first = asyncio.run(create(owner, episode))
    assert first.original_text == '第一集正文'
    assert first.source_script_document_id == episode['id']
    assert not first.characters and not first.frames
    api.save_document(first.id, api.SaveDocumentRequest(content=doc('制作端编辑稿')))
    api.pipeline.update_script_text(first.id, '制作端正文')
    api.save_script_document(episode['id'], api.UpdateScriptDocumentRequest(content=doc('新的创作稿')), owner)

    second = asyncio.run(create(owner, episode))
    assert second.id == first.id
    assert second.original_text == '制作端正文'
    assert api.load_document(first.id)['content'] == doc('制作端编辑稿')
    assert api.get_script_document_project(episode['id'], owner) == {'project_id': first.id}
    assert len(api.pipeline.scripts) == 1


def test_concurrent_requests_create_only_one_project(workspace):
    owner, episode = workspace

    async def concurrent():
        return await asyncio.gather(*(create(owner, episode) for _ in range(8)))

    projects = asyncio.run(concurrent())
    assert len({project.id for project in projects}) == 1
    assert len(api.pipeline.scripts) == 1
    assert api.load_document(projects[0].id)['content'] == episode['content']
    assert len(api.list_document_snapshots(projects[0].id)) == 1


def test_each_episode_gets_its_own_project_and_deleted_project_can_be_recreated(workspace):
    owner, first = workspace
    second = api.create_script_document(api.CreateScriptDocumentRequest(
        title='第2集', content=doc('第二集正文')), owner)
    a = asyncio.run(create(owner, first))
    b = asyncio.run(create(owner, second))
    assert a.id != b.id
    assert api.get_script_document_project(second['id'], owner) == {'project_id': b.id}
    del api.pipeline.scripts[a.id]
    replacement = asyncio.run(create(owner, first))
    assert replacement.id not in {a.id, b.id}


def test_owner_boundary_and_empty_source(workspace):
    owner, episode = workspace
    other = UserContext('user-b', 'profile-b', 'B', '')
    for operation in [lambda: api.get_script_document_project(episode['id'], other),
                      lambda: asyncio.run(create(other, episode))]:
        with pytest.raises(HTTPException) as exc:
            operation()
        assert exc.value.status_code == 404
    empty = api.create_script_document(api.CreateScriptDocumentRequest(content=doc(' ')), owner)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create(owner, empty))
    assert exc.value.status_code == 422
    assert not api.pipeline.scripts


def test_lookup_never_returns_a_foreign_project(workspace):
    owner, episode = workspace
    project = asyncio.run(create(owner, episode))
    project.owner_user_id = 'user-b'
    project.owner_profile_id = 'profile-b'
    assert api.get_script_document_project(episode['id'], owner) == {'project_id': None}
    own_project = asyncio.run(create(owner, episode))
    assert own_project.id != project.id
    assert own_project.owner_profile_id == owner.owner_profile_id


def test_http_create_and_lookup_are_owner_scoped(workspace, monkeypatch):
    from fastapi.testclient import TestClient

    owner, episode = workspace
    other = UserContext('user-b', 'profile-b', 'B', '')
    monkeypatch.setattr(api, '_resolve_request_context',
                        lambda authorization, _cookie, _identity:
                        (other if authorization == 'Bearer other' else owner, False))
    client = TestClient(api.app)
    path = f"/script-documents/{episode['id']}/production-project"
    assert client.get(path).json() == {'project_id': None}
    request = {'title': episode['title'], 'text': 'ignored', 'source_script_document_id': episode['id']}
    first = client.post('/projects?skip_analysis=true', json=request)
    assert first.status_code == 200
    second = client.post('/projects?skip_analysis=true', json=request)
    assert second.status_code == 200
    assert second.json()['id'] == first.json()['id']
    assert client.get(path).json() == {'project_id': first.json()['id']}
    headers = {'Authorization': 'Bearer other'}
    assert client.get(path, headers=headers).status_code == 404
    assert client.post('/projects?skip_analysis=true', json=request, headers=headers).status_code == 404
