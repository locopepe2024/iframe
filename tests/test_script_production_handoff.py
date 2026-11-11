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
    monkeypatch.setattr(api.pipeline, 'series_store', {})
    monkeypatch.setattr(api.pipeline, '_save_data', lambda: None)
    monkeypatch.setattr(api.pipeline, '_save_series_data_unlocked', lambda: None)
    monkeypatch.setattr(api, 'signed_response', lambda value: value)
    owner = UserContext('user-a', 'profile-a', 'A', '')
    episode = api.create_script_document(api.CreateScriptDocumentRequest(
        title='第1集', content=doc('第一集正文')), owner)
    return owner, episode


@pytest.fixture
def planned_episodes(workspace):
    from src.apps.comic_gen.models import ScriptWritingPlanDraft

    owner, root = workspace
    store = api._authoring_store(owner)
    current = store.workspace(root['id'])
    result = store.confirm(root['id'], ScriptWritingPlanDraft(
        background='背景', style='悬疑', point_of_view='第一视角',
        characters='主角', constraints='',
        episodes=[{'number': number, 'title': f'第{number}集', 'outline': '事件'}
                  for number in range(1, 4)],
    ), None, current['source_hash'])
    episodes = [api.save_script_document(episode['document_id'],
                api.UpdateScriptDocumentRequest(content=doc(f"第{episode['number']}集正文")), owner)
                for episode in result['plan']['episodes']]
    return owner, root, episodes


def test_planned_episodes_share_one_series_in_confirmed_order(planned_episodes):
    owner, root, episodes = planned_episodes
    second = asyncio.run(create(owner, episodes[1]))
    first = asyncio.run(create(owner, episodes[0]))
    assert first.series_id == second.series_id and first.series_id
    assert (first.episode_number, second.episode_number) == (1, 2)
    series = api.pipeline.get_series(first.series_id, owner.owner_profile_id)
    assert series.source_script_document_id == root['id']
    assert series.title == root['title']
    assert series.episode_ids == [first.id, second.id]
    assert not api.get_script_document_project(episodes[2]['id'], owner)['project_id']
    assert asyncio.run(create(owner, episodes[0])).id == first.id
    assert len(api.pipeline.series_store) == 1
    assert len(api.pipeline.scripts) == 2


def test_reentry_repairs_existing_standalone_siblings_without_rewriting_them(planned_episodes):
    owner, root, episodes = planned_episodes
    existing = [api.pipeline.create_project(
        episode['title'], '制作端正文', True, 'r2v', None, owner.user_id,
        owner.owner_profile_id, source_script_document_id=episode['id'])
        for episode in episodes[:2]]
    for project in existing:
        api.save_document(project.id, api.SaveDocumentRequest(content=doc('制作端编辑稿')))
    # Lookup stays read-only. The explicit handoff repairs all existing siblings.
    assert api.get_script_document_project(episodes[0]['id'], owner)['project_id'] == existing[0].id
    assert not api.pipeline.series_store
    result = asyncio.run(create(owner, episodes[1]))
    assert result.id == existing[1].id
    assert existing[0].series_id == result.series_id and result.series_id
    for project in existing:
        assert project.original_text == '制作端正文'
        assert api.load_document(project.id)['content'] == doc('制作端编辑稿')
    assert api.pipeline.get_series(result.series_id, owner.owner_profile_id).episode_ids == [p.id for p in existing]


def test_concurrent_sibling_handoffs_create_one_series(planned_episodes):
    owner, _, episodes = planned_episodes

    async def concurrent():
        return await asyncio.gather(*(create(owner, e) for _ in range(3) for e in reversed(episodes)))

    projects = asyncio.run(concurrent())
    assert len({project.id for project in projects}) == 3
    assert len({project.series_id for project in projects}) == 1
    assert all(project.series_id for project in projects)
    assert len(api.pipeline.series_store) == 1
    assert len(api.pipeline.scripts) == 3


def test_unrelated_series_binding_is_not_silently_replaced(planned_episodes):
    owner, _, episodes = planned_episodes
    series = api.pipeline.create_series('手工系列', owner_user_id=owner.user_id,
                                        owner_profile_id=owner.owner_profile_id)
    project = api.pipeline.create_project('手工归属', '制作正文', True, 'r2v', series.id,
        owner.user_id, owner.owner_profile_id, source_script_document_id=episodes[0]['id'])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create(owner, episodes[1]))
    assert exc.value.status_code == 409
    assert project.series_id == series.id
    assert len(api.pipeline.scripts) == len(api.pipeline.series_store) == 1


def test_series_identity_survives_renames_and_deleted_episodes(planned_episodes):
    from src.apps.comic_gen.models import Series

    owner, root, episodes = planned_episodes
    first = asyncio.run(create(owner, episodes[0]))
    series = api.pipeline.get_series(first.series_id, owner.owner_profile_id)
    series.title = '制作系列自定义标题'
    # A persisted and reloaded Series must retain the authoring association.
    api.pipeline.series_store[series.id] = Series.model_validate_json(series.model_dump_json())
    api.save_script_document(root['id'], api.UpdateScriptDocumentRequest(title='总纲新标题'), owner)
    api.pipeline.remove_episode_from_series(series.id, first.id)
    del api.pipeline.scripts[first.id]
    replacement = asyncio.run(create(owner, episodes[0]))
    assert replacement.id != first.id and replacement.series_id == series.id
    assert replacement.episode_number == 1
    assert api.pipeline.get_series(series.id, owner.owner_profile_id).title == '制作系列自定义标题'
    assert len(api.pipeline.series_store) == 1


def test_handoff_ignores_foreign_series_and_project_links(planned_episodes):
    owner, root, episodes = planned_episodes
    foreign = api.pipeline.create_series('foreign', owner_user_id='other',
        owner_profile_id='other', source_script_document_id=root['id'])
    foreign_project = api.pipeline.create_project('foreign', 'private', True, 'r2v', foreign.id,
        'other', 'other', source_script_document_id=episodes[0]['id'])
    own = asyncio.run(create(owner, episodes[0]))
    assert own.id != foreign_project.id and own.series_id != foreign.id
    assert foreign.episode_ids == [foreign_project.id]
    assert own.owner_profile_id == owner.owner_profile_id
    assert api.pipeline.get_series(own.series_id, owner.owner_profile_id).source_script_document_id == root['id']


def test_empty_planned_episode_does_not_create_empty_series(planned_episodes):
    owner, _, episodes = planned_episodes
    api.save_script_document(episodes[0]['id'], api.UpdateScriptDocumentRequest(content=doc(' ')), owner)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create(owner, episodes[0]))
    assert exc.value.status_code == 422
    assert not api.pipeline.series_store and not api.pipeline.scripts


def test_deleted_series_is_recreated_without_duplicating_episodes(planned_episodes):
    owner, _, episodes = planned_episodes
    first = asyncio.run(create(owner, episodes[0]))
    old_series_id = first.series_id
    api.pipeline.delete_series(old_series_id)
    second = asyncio.run(create(owner, episodes[1]))
    assert first.series_id == second.series_id and first.series_id != old_series_id
    assert (first.episode_number, second.episode_number) == (1, 2)
    assert len(api.pipeline.series_store) == 1 and len(api.pipeline.scripts) == 2


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
