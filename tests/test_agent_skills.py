import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import Mock
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps import agent_api as agent, agent_skills as skills
from src.apps.identity import UserContext, require_user_context
from src.apps.comic_gen.extraction_jobs import ExtractionJobs


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.sqlite3'))
    return UserContext('user', 'profile', 'name', 'token')


def run_reviewed_character_draft(body, ctx):
    preview = agent.preview_character_design_draft(body, ctx)
    return agent.character_design_draft(body.model_copy(update={
        'reviewed_messages': preview['messages'], 'review_token': preview['review_token'],
    }), ctx)


def test_character_design_job_returns_before_model_and_is_owner_scoped(ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    entered, release = Event(), Event()

    def slow_model(*_args):
        entered.set()
        assert release.wait(3)
        return json.dumps({
            'identity': {'visual_notes': '清瘦中年男子'},
            'look': {'visual_notes': '黑色短衣'},
            'review_items': [],
        })

    monkeypatch.setattr(agent, 'complete', slow_model)
    body = agent.CharacterDesignRequest(model='qwen', character_name='探子', profile='中年男子', project_id='project')
    preview = agent.preview_character_design_draft(body, ctx)
    reviewed = body.model_copy(update={
        'reviewed_messages': preview['messages'], 'review_token': preview['review_token'],
    })
    with ThreadPoolExecutor(max_workers=1) as executor:
        monkeypatch.setattr(agent, 'character_design_jobs', ExtractionJobs(tmp_path / 'jobs.sqlite3', executor=executor))
        try:
            started = agent.start_character_design_draft_job(reviewed, ctx)
            assert started['status'] == 'running'
            assert entered.wait(2)
            assert agent.get_character_design_draft_job(started['id'], ctx)['status'] == 'running'
            with pytest.raises(HTTPException) as denied:
                agent.get_character_design_draft_job(started['id'], UserContext('other', 'other', '', ''))
            assert denied.value.status_code == 404
        finally:
            release.set()
        deadline = time.monotonic() + 3
        while True:
            result = agent.get_character_design_draft_job(started['id'], ctx)
            if result['status'] == 'completed':
                break
            assert time.monotonic() < deadline
            time.sleep(.01)
        assert result['result']['identity']['visual_notes'] == '清瘦中年男子'


def test_character_design_job_rejects_stale_preview_before_start(ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'character_design_jobs', ExtractionJobs(tmp_path / 'jobs.sqlite3'))
    body = agent.CharacterDesignRequest(model='qwen', character_name='探子', profile='中年男子')
    preview = agent.preview_character_design_draft(body, ctx)
    changed = body.model_copy(update={
        'profile': '老年男子', 'reviewed_messages': preview['messages'], 'review_token': preview['review_token'],
    })
    with pytest.raises(HTTPException) as rejected:
        agent.start_character_design_draft_job(changed, ctx)
    assert rejected.value.status_code == 409


def test_asset_image_prompt_refine_returns_reviewable_suggestion(ctx, monkeypatch):
    calls = []
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda _ctx, _model, messages: (
        calls.append(messages) or '{"prompt":"黄昏粮铺门前，青石板反射暖光"}'
    ))
    body = agent.AssetImagePromptRequest(
        model='qwen', asset_type='scene', asset_name='粮铺门前', description='青石板街道',
        current_prompt='粮铺', plan_context=['第一集黄昏，粮铺门前'],
    )

    preview = agent.preview_asset_image_prompt_refine(body, ctx)
    reviewed = body.model_copy(update={"reviewed_messages": preview["messages"], "review_token": preview["review_token"]})
    assert agent.refine_asset_image_prompt(reviewed, ctx) == {'prompt': '黄昏粮铺门前，青石板反射暖光'}
    assert '第一集黄昏，粮铺门前' in calls[0][1]['content']


def test_asset_image_prompt_refine_rejects_empty_suggestion(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '{"prompt":"  "}')
    body = agent.AssetImagePromptRequest(
        model='qwen', asset_type='prop', asset_name='双手剑', description='长柄双手剑',
    )

    preview = agent.preview_asset_image_prompt_refine(body, ctx)
    with pytest.raises(HTTPException) as exc:
        agent.refine_asset_image_prompt(body.model_copy(update={
            "reviewed_messages": preview["messages"], "review_token": preview["review_token"]}), ctx)
    assert exc.value.status_code == 502


def test_asset_refine_sends_only_reviewed_text_and_rejects_stale_source(ctx, monkeypatch):
    calls = []
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda _ctx, _model, messages: (
        calls.append(messages) or '{"prompt":"冷灰蓝长街"}'
    ))
    body = agent.AssetImagePromptRequest(model='qwen', asset_type='scene', asset_name='长街',
                                         description='残阳如血', current_prompt='残阳染红全街')
    with pytest.raises(HTTPException) as unreviewed:
        agent.refine_asset_image_prompt(body, ctx)
    assert unreviewed.value.status_code == 409
    assert calls == []
    preview = agent.preview_asset_image_prompt_refine(body, ctx)
    edited = {**preview['messages'], 'user': '{"current_prompt":"冷灰蓝长街"}'}
    reviewed = body.model_copy(update={'reviewed_messages': edited, 'review_token': preview['review_token']})
    assert agent.refine_asset_image_prompt(reviewed, ctx)['prompt'] == '冷灰蓝长街'
    assert calls[0][1]['content'] == edited['user']
    assert '残阳染红全街' not in str(calls)
    reviewed.current_prompt = '另一条街'
    with pytest.raises(HTTPException) as stale:
        agent.refine_asset_image_prompt(reviewed, ctx)
    assert stale.value.status_code == 409
    assert len(calls) == 1


def test_asset_refine_rejects_removed_required_output_format(ctx, monkeypatch):
    complete = Mock()
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.AssetImagePromptRequest(model='qwen', asset_type='prop', asset_name='剑', description='旧剑')
    preview = agent.preview_asset_image_prompt_refine(body, ctx)
    body.review_token = preview['review_token']
    body.reviewed_messages = {'system': '只写散文', 'user': '旧剑'}
    with pytest.raises(HTTPException) as rejected:
        agent.refine_asset_image_prompt(body, ctx)
    assert rejected.value.status_code == 422
    complete.assert_not_called()


def test_asset_refine_rejects_changed_saved_asset_and_foreign_project(ctx, monkeypatch):
    from src.apps.comic_gen.api import pipeline
    asset = SimpleNamespace(name='长街', description='蓝调街道', image_prompt='蓝调', asset_design={'style': '写实'}, updated_at=1)
    monkeypatch.setattr(pipeline, 'get_script', lambda project_id, owner: SimpleNamespace(id=project_id) if owner == ctx.owner_profile_id else None)
    monkeypatch.setattr(pipeline, '_find_asset_with_source', lambda *_: (asset, 'script'))
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"prompt":"写实长街"}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.AssetImagePromptRequest(model='qwen', asset_type='scene', asset_name='长街',
        description='蓝调街道', project_id='episode-1', asset_id='scene-1')
    preview = agent.preview_asset_image_prompt_refine(body, ctx)
    reviewed = body.model_copy(update={'reviewed_messages': preview['messages'], 'review_token': preview['review_token']})
    asset.asset_design = {'style': '油画'}
    with pytest.raises(HTTPException) as changed:
        agent.refine_asset_image_prompt(reviewed, ctx)
    assert changed.value.status_code == 409
    complete.assert_not_called()
    foreign = UserContext('other', 'foreign-profile', 'name', 'token')
    with pytest.raises(HTTPException) as denied:
        agent.preview_asset_image_prompt_refine(body, foreign)
    assert denied.value.status_code == 404


def test_catalog_is_self_contained_and_attributed():
    packages = skills.catalog()
    assert len(packages) == len({p['id'] for p in packages}) == 12
    for p in packages:
        assert len(p['revision']) == 64
        assert len(p['source_revision']) == 40
        assert p['source_revision'] in p['source']
        assert p['source'].startswith('https://github.com/')
        assert p['license_text'] and p['adaptation'] and p['instructions']
        assert '[ref:' not in p['instructions']


def test_open_ai_canvas_cards_are_curated_as_scoped_skills():
    packages = {p['id']: p for p in skills.catalog()}
    image = packages['open-ai-canvas-freestyle-prompt-blocks']
    assert image['targets'] == ['Creative Agent']
    assert '图片生成' in image['instructions']
    assert '视频模型的专用提示词结构' in image['instructions']
    assert image['source_revision'] in image['source']


def test_h3_skill_keeps_ethnicity_skin_tone_and_skin_condition_independent():
    instructions = next(p['instructions'] for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    assert '国籍和族裔是身份信息，不是固定的五官模板' in instructions
    assert '单数人物定义只建立一个人物身份' in instructions
    assert '它本身不等于活动性痤疮，也不等于大面积重度凹坑' in instructions
    assert 'No skin smoothing, beauty filter, airbrushing, skin lightening, or skin darkening.' in instructions


def test_character_identity_skill_designs_fields_before_prompt_compilation():
    package = next(p for p in skills.catalog() if p['id'] == 'character-identity-design')
    assert package['version'] == '1.2.1'
    assert '角色档案' in package['instructions']
    assert '`identity`' in package['instructions']
    assert '`look`' in package['instructions']
    assert '`unresolved`' in package['instructions']
    assert '保存为项目角色资产的 design revision' in package['instructions']
    assert '不要把创意选择写成剧本事实' in package['instructions']
    assert '领型、袖型、腰线、面料、鞋履、发式和固定配饰' in package['instructions']


def test_character_style_routes_keep_confirmation_and_anchor_rules():
    package = next(p for p in skills.catalog() if p['id'] == 'character-style-routes')
    assert package['version'] == '1.1.1'
    assert 'stated' in package['instructions']
    assert 'inferred' in package['instructions']
    assert '正面全身的身份锚点' in package['instructions']
    assert 'design_revision' in package['instructions']
    assert '不能覆盖历史图片' in package['instructions']
    assert '不是用户必须逐项填写的空白' in package['instructions']


def test_character_design_draft_uses_curated_skills_without_saving(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"深棕眼，黑发束起"},"look":{"visual_notes":"黑色劲装"},"unresolved":[]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客，沉静', route='historical-costume')
    result = run_reviewed_character_draft(body, ctx)
    assert result['identity']['visual_notes'] == '深棕眼，黑发束起'
    assert len(result['skill_revision']) == 64
    system = complete.call_args.args[2][0]['content']
    assert 'Character identity design skill' in system
    assert 'Character style routes' in system
    assert result['look']['visual_notes'] == '黑色劲装'


def test_character_design_draft_rejects_incomplete_model_result(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '{"identity":{},"look":{}}')
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume')
    with pytest.raises(HTTPException) as exc:
        run_reviewed_character_draft(body, ctx)
    assert exc.value.status_code == 502


def test_character_design_draft_sends_only_reviewed_text_and_rejects_stale_source(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"蓝灰服装"},"look":{"visual_notes":"窄袖布袍"},"review_items":[]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客',
                                        route='historical-costume', style='残阳如血')
    with pytest.raises(HTTPException) as unreviewed:
        agent.character_design_draft(body, ctx)
    assert unreviewed.value.status_code == 409
    complete.assert_not_called()
    preview = agent.preview_character_design_draft(body, ctx)
    edited = {**preview['messages'], 'user': '{"style":"仅远处落日暖红"}'}
    reviewed = body.model_copy(update={'reviewed_messages': edited, 'review_token': preview['review_token']})
    agent.character_design_draft(reviewed, ctx)
    assert complete.call_args.args[2][1]['content'] == edited['user']
    assert '残阳如血' not in str(complete.call_args)
    reviewed.style = '另一个场景'
    with pytest.raises(HTTPException) as stale:
        agent.character_design_draft(reviewed, ctx)
    assert stale.value.status_code == 409
    assert complete.call_count == 1


def test_asset_design_draft_returns_editable_scene_or_prop_visual_notes(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='```json\n{"visual_notes":"青石板长街，灰青木构粮铺，暮秋残阳从右后方斜照，空间开阔，保留人物动作区域","unresolved":[]}\n```')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.AssetDesignRequest(
        model='qwen', asset_type='scene', asset_name='粮铺门前',
        description='青溪镇街边粮铺', user_requirements='南北要道，黄昏，写实电影质感',
    )
    preview = agent.preview_asset_design_draft(body, ctx)
    reviewed = body.model_copy(update={'reviewed_messages': preview['messages'], 'review_token': preview['review_token']})
    result = agent.asset_design_draft(reviewed, ctx)
    assert '青石板长街' in result['visual_notes']
    assert result['unresolved'] == []
    assert '南北要道' in complete.call_args.args[2][1]['content']


def test_asset_design_draft_requires_review_and_sends_only_reviewed_text(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"visual_notes":"蓝灰长街","unresolved":[]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.AssetDesignRequest(model='qwen', asset_type='scene', asset_name='长街',
                                    description='残阳如血', user_requirements='不要全画面染红')
    with pytest.raises(HTTPException) as unreviewed:
        agent.asset_design_draft(body, ctx)
    assert unreviewed.value.status_code == 409
    complete.assert_not_called()
    preview = agent.preview_asset_design_draft(body, ctx)
    reviewed = body.model_copy(update={'reviewed_messages': {
        **preview['messages'], 'user': '{"user_requirements":"仅远处落日暖红"}'},
        'review_token': preview['review_token']})
    assert agent.asset_design_draft(reviewed, ctx)['visual_notes'] == '蓝灰长街'
    assert complete.call_args.args[2][1]['content'] == reviewed.reviewed_messages['user']
    reviewed.user_requirements = '另一版要求'
    with pytest.raises(HTTPException) as changed:
        agent.asset_design_draft(reviewed, ctx)
    assert changed.value.status_code == 409
    assert complete.call_count == 1


def test_character_design_draft_accepts_skill_field_output(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '''```json
{"identity":{"hair":{"value":"黑发束起","basis":"剧本事实"},"face_shape":{"value":"清瘦脸型","basis":"创意设计选择"}},"look":{"costume":{"value":"素黑劲装","basis":"剧本事实"}},"review_items":[]}
```''')
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume')
    result = run_reviewed_character_draft(body, ctx)
    assert result['identity']['visual_notes'] == '黑发束起；清瘦脸型'
    assert result['look']['visual_notes'] == '素黑劲装'


def test_character_design_draft_accepts_annotated_visual_notes(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '{"identity":{"visual_notes":{"value":"黑发束起","basis":"创意设计选择"}},"look":{"visual_notes":""},"review_items":[]}')
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume')
    result = run_reviewed_character_draft(body, ctx)
    assert result['identity']['visual_notes'] == '黑发束起'


def test_character_design_draft_returns_bounded_visual_features(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '{"identity":{"features":{"face":"窄长脸","hair":"黑发束起","height":"身高约178厘米"}},"look":{"features":{"clothing":"深蓝劲装"}},"review_items":[]}')
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume')
    result = run_reviewed_character_draft(body, ctx)
    assert result['identity']['features'] == {'face': '窄长脸', 'hair': '黑发束起', 'height': '身高约178厘米'}
    assert result['identity']['visual_notes'] == '窄长脸；黑发束起；身高约178厘米'
    assert result['look']['features'] == {'clothing': '深蓝劲装'}


def test_character_design_draft_returns_actionable_review_suggestions(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"少年感面容，短黑发","basis":["creative_choice"]},"look":{"visual_notes":"窄袖黑色劲装，哑光布面，布靴","basis":["creative_choice"]},"review_items":[{"question":"剧本要求写实，但用户指定动漫风格，两者冲突","suggestion":"写实真人，低饱和国风摄影质感","suggested_route":"realistic-modern"}]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客，素黑劲装', route='historical-costume')

    result = run_reviewed_character_draft(body, ctx)

    question = '剧本要求写实，但用户指定动漫风格，两者冲突'
    assert result['unresolved'] == [question]
    assert result['field_suggestions'] == {question: '写实真人，低饱和国风摄影质感'}
    assert result['field_suggestion_choices'] == {question: {'route': 'realistic-modern'}}
    system = complete.call_args.args[2][0]['content']
    assert '不是列出待办清单' in system
    assert '不要把常规的造型细节放入 review_items' in system
    assert '可直接加入图片 Prompt 的视觉值' in system
    assert 'suggested_age_stage 或 suggested_route' in system


def test_character_design_draft_does_not_silently_retry_missing_detail_checklist(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    old_questions = [
        '“少年”外观与 young-adult 年龄阶段的具体年龄表现需确认',
        '写实真人、国风动漫或其他画面风格尚未指定',
        '脸型、五官比例、眼睛与眉形、鼻唇特征、肤色肤质、基础发型和发色缺少依据',
        '身高感、肩宽、体型比例及可稳定识别的外貌锚点缺少依据',
        '素黑劲装的时代背景、领型、袖型、腰线、层次、面料、鞋履和固定配饰需确认',
    ]
    first = json.dumps({
        'identity': {'visual_notes': '少年剑客'},
        'look': {'visual_notes': '素黑劲装'},
        'unresolved': old_questions,
    }, ensure_ascii=False)
    complete = Mock(return_value=first)
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客，素黑劲装', route='historical-costume')

    with pytest.raises(HTTPException) as exc:
        run_reviewed_character_draft(body, ctx)
    assert exc.value.status_code == 502
    assert complete.call_count == 1


def test_character_design_draft_rejects_repeated_empty_review(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    answer = '{"identity":{"visual_notes":"少年剑客"},"look":{"visual_notes":"素黑劲装"},"review_items":[{"question":"服装细节尚未指定","suggestion":"窄袖黑衣"}]}'
    complete = Mock(return_value=answer)
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume')

    with pytest.raises(HTTPException) as exc:
        run_reviewed_character_draft(body, ctx)

    assert exc.value.status_code == 502
    assert complete.call_count == 1


def test_character_design_draft_keeps_previous_ai_draft_separate_from_profile(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"少年感面容"},"look":{"visual_notes":"黑色窄袖劲装"},"review_items":[]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(
        model='qwen', character_name='苏砚', profile='剧本写少年剑客',
        current_draft='上一轮 AI 草稿：深棕眼', user_answers={'年龄表现': '十七八岁少年感'},
        route='historical-costume',
    )

    run_reviewed_character_draft(body, ctx)

    user_data = complete.call_args.args[2][1]['content']
    assert '"profile": "剧本写少年剑客"' in user_data
    assert '"current_draft": "上一轮 AI 草稿：深棕眼"' in user_data
    assert '"user_answers": {"年龄表现": "十七八岁少年感"}' in user_data
    assert 'current_draft 是用户当前编辑的角色视觉要求' in complete.call_args.args[2][0]['content']


def test_character_design_draft_receives_user_visual_requirements_separately(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"日晒肤色，挺拔身形"},"look":{"visual_notes":"宋风窄袖短袍，软底布靴"},"review_items":[]}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(
        model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume',
        current_draft='上一轮提案：白色长袍',
        user_visual_requirements={
            'identity': '日晒肤色，宽肩长腿',
            'look': '宋代服装，长柄双手剑',
        },
    )

    run_reviewed_character_draft(body, ctx)

    user_data = complete.call_args.args[2][1]['content']
    assert '"user_visual_requirements": {"identity": "日晒肤色，宽肩长腿", "look": "宋代服装，长柄双手剑"}' in user_data
    assert '"current_draft": "上一轮提案：白色长袍"' in user_data
    assert 'user_visual_requirements.identity 和 .look 是用户在生成前明确填写的视觉约束' in complete.call_args.args[2][0]['content']


def test_character_design_draft_sends_owner_resolved_images_as_visual_evidence(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{"identity":{"visual_notes":"按参考图保留深棕眼和短发"},"look":{"visual_notes":"黑色劲装"},"unresolved":[]}')
    monkeypatch.setattr(agent, 'complete', complete)

    from src.apps.comic_gen import api as studio_api
    from src.models import uniart

    calls = {}
    class Pipeline:
        def get_script(self, project_id, owner_profile_id):
            calls['scope'] = (project_id, owner_profile_id)
            return SimpleNamespace(id=project_id)

        def _resolve_asset_library_reference(self, script, reference):
            calls['reference'] = reference
            return 'output/users/profile/reference.png', reference

        def _find_asset_with_source(self, script, asset_id, asset_type):
            return SimpleNamespace(name='苏砚参考图'), 'episode'

    monkeypatch.setattr(studio_api, 'pipeline', Pipeline())
    monkeypatch.setattr(uniart, '_image_reference_url', lambda path: f'https://media.example/{path.rsplit("/", 1)[-1]}')
    body = agent.CharacterDesignRequest(
        model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume',
        project_id='project-1', reference_assets=[{
            'asset_type': 'character', 'asset_id': 'reference-character', 'variant_id': 'variant-1',
        }],
    )

    result = run_reviewed_character_draft(body, ctx)

    assert result['identity']['visual_notes'] == '按参考图保留深棕眼和短发'
    assert calls['scope'] == ('project-1', ctx.owner_profile_id)
    assert calls['reference'] == {'asset_type': 'character', 'asset_id': 'reference-character', 'variant_id': 'variant-1'}
    user_content = complete.call_args.args[2][1]['content']
    assert isinstance(user_content, list)
    assert '苏砚参考图' in user_content[0]['text']
    assert user_content[1] == {'type': 'image_url', 'image_url': {'url': 'https://media.example/reference.png'}}
    assert 'https://media.example/reference.png' not in user_content[0]['text']


def test_character_design_reference_requires_current_project(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    complete = Mock(return_value='{}')
    monkeypatch.setattr(agent, 'complete', complete)
    body = agent.CharacterDesignRequest(
        model='qwen', character_name='苏砚', profile='少年剑客', route='historical-costume',
        reference_assets=[{'asset_type': 'character', 'asset_id': 'reference-character', 'variant_id': 'variant-1'}],
    )

    with pytest.raises(HTTPException) as exc:
        run_reviewed_character_draft(body, ctx)

    assert exc.value.status_code == 422
    complete.assert_not_called()


def test_install_update_toggle_uninstall_owner_isolation(ctx, monkeypatch):
    p = skills.catalog()[0]
    other = UserContext('other', 'other-profile', 'other', 'token')
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    assert len(skills.installed(ctx.owner_profile_id)) == 1
    assert skills.installed(other.owner_profile_id) == []
    with pytest.raises(HTTPException) as exc:
        skills.patch(p['id'], skills.SkillPatch(enabled=False), other)
    assert exc.value.status_code == 404
    skills.uninstall(p['id'], other)
    assert p['instructions'] in skills.creative_guidance(ctx.owner_profile_id)
    skills.patch(p['id'], skills.SkillPatch(enabled=False), ctx)
    assert skills.creative_guidance(ctx.owner_profile_id) == ''
    updated = {**p, 'revision': 'a' * 64, 'instructions': 'New instructions', 'version': '1.1.0'}
    monkeypatch.setattr(skills, 'catalog', lambda: [updated])
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == p['instructions']
    skills.install(p['id'], skills.InstallRequest(revision=updated['revision']), ctx)
    assert skills.installed(ctx.owner_profile_id)[0]['enabled'] is False
    skills.patch(p['id'], skills.SkillPatch(enabled=True), ctx)
    assert 'New instructions' in skills.creative_guidance(ctx.owner_profile_id)
    skills.uninstall(p['id'], ctx)
    assert skills.installed(ctx.owner_profile_id) == []


def test_invalid_packages_revision_and_budget_fail_closed(ctx, monkeypatch):
    p = skills.catalog()[0]
    for skill_id, revision, status in [('not-found', p['revision'], 404), (p['id'], 'b' * 64, 409)]:
        with pytest.raises(HTTPException) as exc:
            skills.install(skill_id, skills.InstallRequest(revision=revision), ctx)
        assert exc.value.status_code == status
    monkeypatch.setattr(skills, 'MAX_GUIDANCE_CHARS', 1)
    with pytest.raises(HTTPException) as exc:
        skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    assert exc.value.status_code == 400
    assert skills.installed(ctx.owner_profile_id) == []


def test_enabled_skills_reach_agent_completion_and_disable_takes_effect(ctx, monkeypatch):
    p = skills.catalog()[0]
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    completion = Mock(return_value='导演方案')
    monkeypatch.setattr(agent, 'complete', completion)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    agent.send(sid, agent.MessageCreate(content='设计镜头'), ctx)
    assert p['instructions'] in completion.call_args.args[2][0]['content']
    assert '你不能执行生成' in completion.call_args.args[2][0]['content']
    skills.patch(p['id'], skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='继续'), ctx)
    assert p['instructions'] not in completion.call_args.args[2][0]['content']


def test_http_endpoints_require_identity_and_persist(ctx):
    app = FastAPI()
    app.include_router(agent.router)
    def denied():
        raise HTTPException(401, 'Login required')
    app.dependency_overrides[require_user_context] = denied
    with TestClient(app) as client:
        assert client.get('/agent/skills').status_code == 401
        app.dependency_overrides[require_user_context] = lambda: ctx
        p = client.get('/agent/skills').json()['catalog'][0]
        path = '/agent/skills/' + p['id']
        assert client.post(path, json={'revision': p['revision']}).status_code == 200
        assert client.get('/agent/skills').json()['installed'][0]['enabled'] is True
        assert client.patch(path, json={'enabled': False}).status_code == 200
        assert client.get('/agent/skills').json()['installed'][0]['enabled'] is False
        assert client.delete(path).status_code == 200
        assert client.get('/agent/skills').json()['installed'] == []


def test_skill_changes_apply_across_sessions_without_crossing_owners(ctx, monkeypatch):
    package = skills.catalog()[0]
    other = UserContext('other', 'other-profile', 'name', 'token')
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    complete = Mock(return_value='Creative plan')
    monkeypatch.setattr(agent, 'complete', complete)
    first = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    second = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    foreign = agent.create(agent.SessionCreate(model='qwen'), other)['session']['id']
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    for sid in (first, second):
        agent.send(sid, agent.MessageCreate(content='Director plan'), ctx)
        assert package['instructions'] in complete.call_args.args[2][0]['content']
    agent.send(foreign, agent.MessageCreate(content='Director plan'), other)
    assert package['instructions'] not in complete.call_args.args[2][0]['content']
    skills.uninstall(package['id'], ctx)
    for sid in (first, second):
        agent.send(sid, agent.MessageCreate(content='Continue'), ctx)
        assert package['instructions'] not in complete.call_args.args[2][0]['content']


def test_shared_contract_applies_to_pinned_install_without_replacing_it(ctx, monkeypatch, tmp_path):
    package = next(p for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    saved = skills.installed(ctx.owner_profile_id)[0]
    contract = tmp_path / 'creative-contract.md'
    contract.write_text('Current request defines the creative task.', encoding='utf-8')
    monkeypatch.setattr(skills, 'CATALOG_DIR', tmp_path)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='优化稿')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    agent.send(sid, agent.MessageCreate(content='为H3优化10秒单镜头走秀'), ctx)
    assert contract.read_text() in call.call_args.args[2][0]['content']
    assert saved['instructions'] in call.call_args.args[2][0]['content']
    assert skills.installed(ctx.owner_profile_id)[0] == saved
    skills.patch(package['id'], skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='继续'), ctx)
    assert contract.read_text() not in call.call_args.args[2][0]['content']


def test_file_backed_skill_revision_and_installed_snapshot(ctx, monkeypatch, tmp_path):
    import json
    package = dict(skills.catalog()[-1])
    package['instructions_file'] = 'guide.md'
    (tmp_path / 'catalog.json').write_text(json.dumps({'skills': [package]}))
    (tmp_path / package['license_file']).write_text(package['license_text'])
    guide = tmp_path / 'guide.md'
    guide.write_text('First pinned guide')
    monkeypatch.setattr(skills, 'CATALOG_DIR', tmp_path)
    first = skills.catalog()[0]
    skills.install(first['id'], skills.InstallRequest(revision=first['revision']), ctx)
    guide.write_text('Revised official guide')
    second = skills.catalog()[0]
    assert first['revision'] != second['revision']
    assert second['instructions'] == 'Revised official guide'
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == 'First pinned guide'
    skills.install(second['id'], skills.InstallRequest(revision=second['revision']), ctx)
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == 'Revised official guide'


def test_explicit_h3_request_selects_only_h3_and_continue_retains_target(ctx, monkeypatch):
    packages = skills.catalog()
    for package in packages:
        skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='H3 prompt')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    for request in ('将以下提示词优化适合minima H3：仙侠侧踢', '继续'):
        agent.send(sid, agent.MessageCreate(content=request), ctx)
        system = call.call_args.args[2][0]['content']
        for package in packages:
            assert (package['instructions'] in system) == (package['id'] in {'minimax-h3-director', 'h3-product-recreation'})
    agent.send(sid, agent.MessageCreate(content='为Seedance设计镜头'), ctx)
    assert next(p['instructions'] for p in packages if p['id'] == 'minimax-h3-director') not in call.call_args.args[2][0]['content']
    skills.patch('minimax-h3-director', skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='为H3优化'), ctx)
    assert next(p['instructions'] for p in packages if p['id'] == 'minimax-h3-director') not in call.call_args.args[2][0]['content']


def test_h3_clarification_keeps_skill_without_overriding_explicit_new_target(ctx):
    for package in skills.catalog():
        skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    history = [
        {'role': 'user', 'content': '将仙侠侧踢优化适合minima H3'},
        {'role': 'assistant', 'content': '为了按 MiniMax H3 编排，请补充视频总时长和是否允许切镜。'},
    ]
    guidance = skills.creative_guidance(ctx.owner_profile_id, '1. **视频总时长15 秒 2、允许切镜。', history)
    h3 = next(p for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    assert h3['instructions'] in guidance
    assert '[Seedance' not in guidance
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '改为Seedance，15秒允许切镜', history)
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '帮我写一封邮件', history)
    skills.patch(h3['id'], skills.SkillPatch(enabled=False), ctx)
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '15秒允许切镜', history)


def test_product_recreation_installs_alone_reaches_chat_and_respects_target(ctx, monkeypatch):
    package = next(p for p in skills.catalog() if p['id'] == 'h3-product-recreation')
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='参考再生成提示词')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    for request in ('用H3参考视频，把商品换成图片中的商品，口播名称换为新商品名', '继续'):
        agent.send(sid, agent.MessageCreate(content=request), ctx)
        assert package['instructions'] in call.call_args.args[2][0]['content']
    assert package['instructions'] in skills.creative_guidance(ctx.owner_profile_id, '参考原片重新生成并替换商品')
    assert package['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '改为Seedance复刻视频')
    assert package['instructions'] not in skills.creative_guidance('other-owner', '用H3换商品')
    skills.patch(package['id'], skills.SkillPatch(enabled=False), ctx)
    assert package['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '用H3换商品')


def test_character_design_unifies_completion_and_polish_while_preserving_constraints(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='成年剑客',
        current_draft='身高178厘米，肤色小麦色，上身仅两件衣物', route='historical-costume')
    preview = agent.preview_character_design_draft(body, ctx)
    assert '一次完成当前草稿的表达整理与缺失细节提案' in preview['messages']['system']
    assert '不得为了丰富细节擅自改写' in preview['messages']['system']
    assert '不得由单张参考图推断精确厘米数' in preview['messages']['system']
    assert '身高178厘米，肤色小麦色，上身仅两件衣物' in preview['messages']['user']


def test_character_design_accepts_profile_and_current_details_without_an_implicit_style_route(ctx, monkeypatch):
    calls = []
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda _ctx, _model, messages: (
        calls.append(messages) or json.dumps({
            'identity': {'features': {'face': '眉目清冽', 'height': '身姿挺拔'}},
            'look': {'features': {'clothing': '素黑劲装', 'accessories': '窄红发带'}},
            'review_items': [],
        })
    ))
    profile = '外观：少年，身姿挺拔；性格：沉静淡漠，坚守本心。'
    details = '里衣一件、素黑外衣一件，布靴，无额外披风。'
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile=profile, current_draft=details)
    result = run_reviewed_character_draft(body, ctx)
    assert len(calls) == 1
    data = json.loads(calls[0][1]['content'])
    assert data['profile'] == profile
    assert data['current_draft'] == details
    assert data['route'] == ''
    assert '不默认补成现代写实' in calls[0][0]['content']
    assert '资产出图指令不写入 identity 或 look' in calls[0][0]['content']
    assert result['look']['features']['clothing'] == '素黑劲装'


def test_character_design_still_rejects_an_unknown_explicit_style_route(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年剑客', route='invented-route')
    with pytest.raises(HTTPException) as exc:
        agent.preview_character_design_draft(body, ctx)
    assert exc.value.status_code == 422


def test_character_design_output_contract_defines_types_bounds_and_current_details(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    body = agent.CharacterDesignRequest(model='qwen', character_name='角色', profile='少年，素黑劲装',
        current_draft='靛蓝色交领长袍，米白里衣，上身仅两件，身高约180厘米')
    system = agent.preview_character_design_draft(body, ctx)['messages']['system']
    assert '每个 features 值最多 500 个字符' in system
    assert '"review_items": []' in system
    assert '当前由用户编辑的角色细节' in system
    assert '不得将缺失字段写成 null' in system
    assert '每个非空字段附 `basis`' not in system
    assert '每个非空字段带 `basis`' not in system
    assert '来源依据统一放在 `identity.basis` 和 `look.basis`' in system


def test_character_design_rejection_has_safe_reason_and_reference(ctx, monkeypatch, caplog):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: '{"identity":{"features":{"height":180}},"look":{},"review_items":[]}')
    body = agent.CharacterDesignRequest(model='qwen', character_name='角色', profile='PRIVATE_PROFILE')
    with pytest.raises(HTTPException) as exc:
        run_reviewed_character_draft(body, ctx)
    assert exc.value.status_code == 502
    assert '视觉字段的类型或长度不符合要求' in exc.value.detail
    assert '诊断编号' in exc.value.detail
    assert 'reason=invalid_feature_value' in caplog.text
    assert 'PRIVATE_PROFILE' not in caplog.text
    assert '"height":180' not in caplog.text


def test_character_design_distinguishes_missing_object_from_review_failure(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    body = agent.CharacterDesignRequest(model='qwen', character_name='角色', profile='少年')
    for answer, reason in [
        ('设计：黑发少年。', '未返回包含 identity 和 look 的 JSON 对象'),
        ('{"identity":{"visual_notes":"黑发"},"look":{},"review_items":[{"question":"发型未指定","suggestion":"长发"}]}', '返回了待办问题或不完整的冲突建议'),
    ]:
        complete = Mock(return_value=answer)
        monkeypatch.setattr(agent, 'complete', complete)
        with pytest.raises(HTTPException) as exc:
            run_reviewed_character_draft(body, ctx)
        assert reason in exc.value.detail
        assert complete.call_count == 1


def test_character_design_contract_preserves_realistic_prompt_baseline(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='雪痕客', current_draft='圆脸；自然皮肤纹理；纯白背景；真人写实')
    system = agent.preview_character_design_draft(body, ctx)['messages']['system']
    assert 'AI 完善是保守编辑，不是重写或概念设计改编' in system
    assert '禁止新增概念设计、插画、动漫' in system
    assert '不得用‘概念设计’作为开头' in system


def test_character_design_result_restores_realism_guard(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: (
        '{"identity":{"visual_notes":"圆脸；概念设计；自然米色肤色；高质量；杰作级细节；自然皮肤纹理",'
        '"features":{"skin":"自然米色肤色；磨皮"}},"look":{"visual_notes":"靛蓝长袍"},"review_items":[]}'
    ))
    body = agent.CharacterDesignRequest(
        model='qwen', character_name='苏砚', profile='雪痕客',
        current_draft='圆脸；自然米色肤色；保留可见的自然皮肤纹理；真人写实',
    )
    result = run_reviewed_character_draft(body, ctx)
    combined = result['identity']['visual_notes'] + result['identity']['features']['skin']
    assert '概念设计' not in combined
    assert '杰作级细节' not in combined
    assert '；磨皮' not in combined
    assert '不磨皮' in combined
    assert '可见毛孔' in combined


def test_structured_panel_choices_override_ai_proposals(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: json.dumps({
        'identity': {'visual_notes': '模型面容', 'features': {'gender': '男性', 'age': '青年', 'eyebrows': '浓眉', 'skin_texture': '光滑皮肤', 'hair': '黑色长发'}},
        'look': {'visual_notes': '服装', 'features': {'footwear': '皮靴'}}, 'review_items': [],
    }))
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年',
        structured_identity={'face_shape': '圆脸', 'forehead': '额头饱满', 'cheekbones': '颧骨平缓', 'jaw': '下颌轮廓分明', 'chin': '下巴圆润', 'gender': '女性', 'age': '约72岁', 'eyebrows': '柳叶眉', 'skin_texture': '面颊略干，保留干燥纹理'},
        structured_look={'footwear': '素面布靴'})
    result = run_reviewed_character_draft(body, ctx)
    for key, value in body.structured_identity.items():
        assert result['identity']['features'][key] == value
    assert result['identity']['features']['gender'] == '女性'
    assert result['identity']['features']['age'] == '约72岁'
    assert result['identity']['features']['eyebrows'] == '柳叶眉'
    assert result['identity']['features']['skin_texture'] == '面颊略干，保留干燥纹理'
    assert result['identity']['features']['hair'] == '黑色长发'
    assert result['look']['features']['footwear'] == '素面布靴'


def test_character_constraints_are_authored_not_model_proposals(ctx, monkeypatch):
    monkeypatch.setattr(agent, 'validate_model', lambda *_: None)
    monkeypatch.setattr(agent, 'complete', lambda *_: json.dumps({
        'identity': {'visual_notes': '圆脸', 'features': {'face_shape': '圆脸'}},
        'look': {'visual_notes': '布衣', 'features': {'clothing': '布衣'}},
        'constraints': {'must_keep': ['光滑肌肤'], 'negative_prompt': []}, 'review_items': [],
    }))
    constraints = {'must_keep': ['自然皮肤纹理'], 'negative_prompt': ['额外披风']}
    body = agent.CharacterDesignRequest(model='qwen', character_name='苏砚', profile='少年', constraints=constraints)
    preview = agent.preview_character_design_draft(body, ctx)
    assert json.loads(preview['messages']['user'])['constraints'] == constraints
    assert run_reviewed_character_draft(body, ctx)['constraints'] == constraints
