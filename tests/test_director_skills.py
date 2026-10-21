import json
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from src.apps import director_skills as skills
from src.apps.comic_gen.llm import ScriptProcessor


def selection(stage, task_id):
    task = next(t for t in skills.catalog(stage) if t['id'] == task_id)
    return skills.SkillSelection(id=task['id'], revision=task['revision'])


def test_explicit_selection_stage_version_and_duplicates():
    item = selection('shooting_plan', 'opening-hook')
    assert skills.freeze('shooting_plan', []) == []
    assert skills.guidance([]) == ''
    with pytest.raises(ValueError, match='unavailable'):
        skills.freeze('episode', [item])
    with pytest.raises(ValueError, match='Duplicate'):
        skills.freeze('shooting_plan', [item, item])
    with pytest.raises(ValueError, match='revision changed'):
        skills.freeze('shooting_plan', [item.model_copy(update={'revision': '0' * 64})])
    frozen = skills.freeze('shooting_plan', [item])
    assert [t['id'] for t in frozen] == ['opening-hook']
    assert skills.provenance(frozen)[0]['revision'] == item.revision
    assert len({t['category'] for t in skills.catalog('shooting_plan')}) == 3
    assert '故事与人物分析' in {t['category'] for t in skills.catalog('episode')}


def test_frozen_content_survives_catalog_change(monkeypatch):
    snapshot = skills.freeze('shooting_plan', [selection('shooting_plan', 'opening-hook')])
    before = skills.guidance(snapshot)
    monkeypatch.setattr(skills, 'catalog', lambda stage: [])
    assert skills.guidance(snapshot) == before
    assert 'information-suspense' not in before


def test_preferences_owner_scope_stage_and_clear(tmp_path, monkeypatch):
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'skills.sqlite3'))
    item = selection('episode', 'people-relations')
    assert skills.preferences('one', 'project:x', 'episode') == []
    skills.preferences('one', 'project:x', 'episode', [item])
    assert skills.preferences('one', 'project:x', 'episode') == [item.model_dump()]
    assert skills.preferences('two', 'project:x', 'episode') == []
    assert skills.preferences('one', 'project:y', 'episode') == []
    assert skills.preferences('one', 'project:x', 'shooting_plan') == []
    assert skills.preferences('one', 'project:x', 'episode', []) == []


def test_actual_analysis_prompt_only_selected_method():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{}'
    processor.analyze_director_profile('原文', {'scope': 'episode'}, {})
    prompt = processor.llm.chat.call_args.kwargs['messages'][0]['content']
    assert '<selected_creative_methods>' not in prompt
    snapshot = skills.freeze('episode', [selection('episode', 'people-relations')])
    processor.analyze_director_profile('原文', {'scope': 'episode', 'selected_creative_methods': snapshot}, {})
    prompt = processor.llm.chat.call_args.kwargs['messages'][0]['content']
    assert prompt.count(snapshot[0]['instructions']) == 1
    assert '[people-relations ' in prompt
    assert '[story-causality ' not in prompt


def test_request_queue_freezes_selection_and_cache_identity(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    captured = []
    monkeypatch.setattr(api, '_director_profile_fingerprint', lambda project: 'source')
    monkeypatch.setattr(api.extraction_jobs, 'start', lambda *args, **kwargs: captured.append(args) or {})
    monkeypatch.setattr(api.pipeline, 'preview_director_profile', lambda project, **kwargs: {'creative_skill_run': skills.provenance(kwargs['skill_snapshot'])})
    owner = UserContext('u', 'o', '', '')
    api.start_director_profile_analysis('x', skills.DirectorSkillsRequest(), owner)
    item = selection('episode', 'people-relations')
    api.start_director_profile_analysis('x', skills.DirectorSkillsRequest(skills=[item]), owner)
    assert captured[0][2] != captured[1][2]
    monkeypatch.setattr(skills, 'catalog', lambda stage: [])
    result = captured[1][3]()
    assert result['profile']['creative_skill_run'][0]['id'] == item.id


def test_api_rejects_invalid_stage_before_queue():
    from src.apps.comic_gen import api
    with pytest.raises(HTTPException) as err:
        api._freeze_director_skills('episode', skills.DirectorSkillsRequest(skills=[selection('shooting_plan', 'opening-hook')]))
    assert err.value.status_code == 422


def test_actual_plan_prompt_includes_only_requested_hook():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps({'scenes': [], 'unresolved_questions': []})
    snapshot = skills.freeze('shooting_plan', [selection('shooting_plan', 'opening-hook')])
    with pytest.raises(RuntimeError, match='至少一个 scene'):
        processor.plan_director_shooting_chunk('原文', {'selected_creative_methods': snapshot}, {}, {})
    prompt = processor.llm.chat.call_args.kwargs['messages'][0]['content']
    assert prompt.count(snapshot[0]['instructions']) == 1
    assert '[opening-hook ' in prompt
    assert '[information-suspense ' not in prompt


def test_information_design_projects_and_compiles_without_methods():
    from src.apps.comic_gen.models import DirectorInformationDesign
    from src.apps.comic_gen.shot_context_projection import project_shot_context
    from src.apps.comic_gen.prompt_assembly import append_projected_shot_context
    information = DirectorInformationDesign(
        audience_question='信物属于谁？', audience_knows='角色发现信物',
        character_knows='角色知道归属', withhold='信物上的姓名',
        presentation='先表现角色反应', source_event_ids=['event-1'], reveal_event_ids=['event-2'],
    ).model_dump()
    context = {'shot': {'shot_id': 'shot-1', 'information_design': information}, 'scene': {}}
    projected = json.loads(project_shot_context(context, 'shot-1', 'saved'))
    assert projected['shot']['information_design']['withhold'] == '信物上的姓名'
    compiled = append_projected_shot_context('', context)
    assert '当前镜头不得提前展示：信物上的姓名' in compiled
    assert 'selected_creative_methods' not in compiled


def test_information_boundary_survives_context_budget_reduction():
    from src.apps.comic_gen.shot_context_projection import project_shot_context
    from src.apps.comic_gen.models import DirectorInformationDesign
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match='requires source_event_ids'):
        DirectorInformationDesign(evidence_status='source_linked')
    data = {'shot': {'shot_id': 's', 'visual_intent': '内容' * 4000,
                     'information_design': {'withhold': '不得展示信物姓名' * 30}},
            'scene': {'location': '场景' * 4000}}
    result = json.loads(project_shot_context(data, 's', 'saved'))
    assert result['shot']['information_design']['withhold'] == data['shot']['information_design']['withhold']
