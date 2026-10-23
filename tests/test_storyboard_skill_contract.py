from unittest.mock import Mock
from types import SimpleNamespace
import pytest
from src.apps.comic_gen import api
from src.apps.comic_gen.models import AssetImageSubmissionSnapshot


def _confirmed_video(request):
    preview = api.preview_video_polish_prompt(request)
    return api.polish_video_prompt(request.model_copy(update={
        'review_token': preview['review_token'],
        'reviewed_messages': preview['messages'],
    }))


def _confirmed_r2v(request):
    preview = api.preview_r2v_polish_prompt(request)
    return api.polish_r2v_prompt(request.model_copy(update={
        'review_token': preview['review_token'],
        'reviewed_messages': preview['messages'],
    }))


@pytest.mark.parametrize('model,label', [('uniart/minimax-h3-vip', 'MiniMax H3'), ('uniart/seedance-2.5-vip', 'Seedance')])
def test_skill_loads_outside_repo_and_preserves_editor_contract(monkeypatch, tmp_path, model, label):
    monkeypatch.chdir(tmp_path)
    text = api._storyboard_polish_contract(model, '', '')
    assert label in text
    assert 'prompt_cn' in text and '[characterN:name]' in text
    assert 'replacement' in text


def test_explicit_skill_must_match_target_model():
    with pytest.raises(api.HTTPException) as exc_info:
        api._storyboard_polish_contract(
            'uniart/minimax-h3-vip', '', '', optimization_skills=['seedance-camera']
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail['reason'] == 'incompatible_optimization_skill'


def test_unrelated_h3_workflow_cannot_load_as_shot_polish_skill():
    with pytest.raises(api.HTTPException) as exc_info:
        api._storyboard_polish_contract(
            'uniart/minimax-h3-vip', '', '', optimization_skills=['h3-product-recreation']
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail['reason'] == 'ineligible_optimization_skill'


def test_legacy_model_guidance_loads_only_the_model_adapter():
    h3 = api._target_model_guidance('uniart/minimax-h3-vip')
    seedance = api._target_model_guidance('uniart/seedance-2.5-vip')
    assert '基础／关键帧输出' in h3
    assert '商品替换' not in h3
    assert '多镜头、续拍、长故事' not in h3
    assert '按参考素材及用途' in seedance
    assert '多镜头、续拍、长故事' not in seedance


def test_empty_explicit_skill_selection_disables_legacy_target_guidance():
    text = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', optimization_skills=[]
    )
    assert 'SELECTED OPTIMIZATION SKILLS' not in text
    assert 'MiniMax H3 分段导演' not in text


def test_unknown_explicit_skill_is_rejected():
    with pytest.raises(api.HTTPException) as exc_info:
        api._storyboard_polish_contract(
            'uniart/minimax-h3-vip', '', '', optimization_skills=['not-installed']
        )
    assert exc_info.value.status_code == 422


@pytest.mark.parametrize('provider,expected', [
    ('gpt', 'minimax-h3-director'),
    ('qwen', 'minimax-h3-director'),
    ('deepseek', 'minimax-h3-director'),
    ('glm', 'minimax-h3-director'),
])
def test_non_ir_optimizer_defaults_to_h3_director_skill(provider, expected):
    request = api.PolishVideoPromptRequest(draft_prompt='动作', optimizer_provider=provider, target_video_model='uniart/minimax-h3-vip')
    assert api._effective_optimization_skills(request) == [expected]


def test_seedance_optimizer_defaults_to_seedance_prompt():
    request = api.PolishVideoPromptRequest(draft_prompt='动作', optimizer_provider='qwen', target_video_model='uniart/seedance-2.5-vip')
    assert api._effective_optimization_skills(request) == ['seedance-prompt']


def test_ir_preview_contains_selected_skill_text():
    request = api.PolishVideoPromptRequest(
        draft_prompt='动作', target_video_model='uniart/minimax-h3-vip',
        optimizer_provider='minimax_context_ir', optimization_skills=['minimax-h3-director'],
    )
    preview = api.preview_video_polish_prompt(request)
    assert '[minimax-h3-director' in preview['messages']['user']
    assert '基础／关键帧输出' in preview['messages']['user']
    assert 'a slow Push In or Zoom In does not make a' in preview['messages']['user']


@pytest.mark.parametrize('reference_mode', [False, True])
def test_shot_polish_separates_action_rhythm_from_camera_speed(reference_mode):
    text = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', target_duration=6,
        optimization_skills=['minimax-h3-director'], reference_mode=reference_mode,
    )
    assert 'initiating movement, immediate reaction' in text
    assert 'a slow Push In or Zoom In does not make a' in text
    assert 'Push In moves the camera; Zoom In changes' in text
    assert 'do not invent an action sequence' in text
    assert 'without adding a new output field' in text


def test_unselected_model_skill_keeps_action_rhythm_guidance():
    text = api._storyboard_polish_contract(
        'other-video-model', '', 'existing prompt', optimization_skills=[],
    )
    assert text.startswith('existing prompt')
    assert 'a slow Push In or Zoom In does not make a' in text


def test_minimax_ir_does_not_force_local_director_skill():
    request = api.PolishVideoPromptRequest(draft_prompt='动作', optimizer_provider='minimax_context_ir')
    assert api._effective_optimization_skills(request) is None


def test_named_optimizer_selects_its_model_and_director_skill(monkeypatch):
    processor = Mock()
    structured = 'integrated_multimodal_description: value\noverall_soundscape: N/A\nnon_diegetic_music: N/A'
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    _confirmed_video(api.PolishVideoPromptRequest(
        draft_prompt='动作', target_video_model='uniart/minimax-h3-vip', optimizer_provider='qwen'
    ))
    assert processor.polish_video_prompt.call_args.kwargs['polish_model'] == 'qwen3.8-flash'
    assert 'minimax-h3-director' in processor.polish_video_prompt.call_args.args[2]


def test_h3_polish_contract_forbids_text_overlays():
    text = api._storyboard_polish_contract('uniart/minimax-h3-vip', '', '')
    assert 'HARD H3 TEXT-OVERLAY PROHIBITION' in text
    assert 'subtitles' in text
    assert 'Dialogue, if\nrequested, is audio only' in text
    assert 'FINAL H3 ENFORCEMENT (highest priority)' in text
    assert 'Do not return a standalone sentence' in text
    assert 'integrated_multimodal_description:' in text
    assert 'non_diegetic_music:' in text


def test_first_last_polish_contract_aligns_both_images_without_new_h3_fields():
    text = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', target_duration=8,
        generation_mode='first_last_frame', optimization_skills=['minimax-h3-director'],
    )
    assert 'image 1 is the actual first frame at 0.00 seconds' in text
    assert 'image 2 is the actual last frame at 8.00 seconds' in text
    assert 'ending pose has no clear motion' in text
    assert 'integrated_multimodal_description:' in text
    assert 'Do not add a new body heading' in text


def test_first_last_polish_requires_two_selected_images_before_model_call(monkeypatch):
    processor = Mock()
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    for images in ([], ['first'], ['same', 'same']):
        with pytest.raises(api.HTTPException) as exc:
            _confirmed_video(api.PolishVideoPromptRequest(
                draft_prompt='action', generation_mode='first_last_frame', image_urls=images,
            ))
        assert exc.value.status_code == 422
        assert '两张不同' in exc.value.detail
    processor.polish_video_prompt.assert_not_called()


def test_first_last_polish_passes_mode_and_two_images_to_processor(monkeypatch):
    processor = Mock()
    result = '首帧图像在0.00秒，尾帧图像在8.00秒。\nintegrated_multimodal_description: opening to ending\noverall_soundscape: N/A\nnon_diegetic_music: N/A'
    processor.polish_video_prompt.return_value = {'prompt_cn': result, 'prompt_en': result}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    monkeypatch.setattr(api, '_polish_image_urls', lambda values: values)
    _confirmed_video(api.PolishVideoPromptRequest(
        draft_prompt='street scene', target_video_model='uniart/minimax-h3-vip',
        generation_mode='first_last_frame', target_duration=8,
        image_urls=['first', 'last'], optimizer_provider='qwen',
    ))
    call = processor.polish_video_prompt.call_args
    assert call.kwargs['image_urls'] == ['first', 'last']
    assert call.kwargs['generation_mode'] == 'first_last_frame'
    assert 'last frame at 8.00 seconds' in call.args[2]


def test_first_last_polish_rejects_ordinary_i2v_result():
    from src.apps.comic_gen.llm import PolishError

    body = '首帧图像在0.00秒。\nintegrated_multimodal_description: people walk\noverall_soundscape: N/A\nnon_diegetic_music: N/A'
    with pytest.raises(PolishError) as error:
        api._validate_storyboard_polish_result(
            'uniart/minimax-h3-vip', {'prompt_cn': body, 'prompt_en': body},
            reference_mode=False, generation_mode='first_last_frame',
        )
    assert error.value.reason == 'model_contract_mismatch'


def test_h3_final_contract_matches_base_or_reference_mode():
    base = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', optimization_skills=['minimax-h3-director'])
    reference = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', optimization_skills=['minimax-h3-director'],
        reference_mode=True)
    base_final = base.split('FINAL H3 ENFORCEMENT', 1)[1]
    reference_final = reference.split('FINAL H3 ENFORCEMENT', 1)[1]
    assert 'integrated_multimodal_description:' in base_final
    assert 'subject_definitions:' not in base_final
    assert 'subject_definitions:' in reference_final
    assert 'detailed_description:' in reference_final
    assert 'integrated_multimodal_description:' not in reference_final


def test_seedance_polish_contract_does_not_demand_h3_fields():
    text = api._storyboard_polish_contract(
        'uniart/seedance-2.5-vip', '', '', optimization_skills=['seedance-prompt'], generate_audio=False)
    assert 'FINAL H3 ENFORCEMENT' not in text
    assert 'H3 base:' not in text
    assert 'H3 reference mode:' not in text
    assert 'integrated_multimodal_description' not in text
    assert 'overall_soundscape' not in text
    assert 'non_diegetic_music' not in text


def test_h3_contract_mismatch_logs_headings_without_model_text(caplog):
    from src.apps.comic_gen.llm import PolishError

    with pytest.raises(PolishError):
        api._validate_storyboard_polish_result(
            'uniart/minimax-h3-vip',
            {'prompt_cn': 'private scene text', 'prompt_en': 'private scene text'},
            reference_mode=False,
        )
    assert 'integrated_multimodal_description' in caplog.text
    assert 'private scene text' not in caplog.text


def test_polish_keeps_default_contract_with_model_skill(monkeypatch):
    processor = Mock()
    structured = '\n'.join([
        'integrated_multimodal_description: value',
        'overall_soundscape: N/A',
        'non_diegetic_music: N/A',
    ])
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    monkeypatch.setattr(api, '_get_director_prompt_context', lambda *a: 'Director profile revision: 3; keep Chinese setting')
    _confirmed_video(api.PolishVideoPromptRequest(draft_prompt='replace character', target_video_model='uniart/minimax-h3-vip'))
    from src.apps.comic_gen.llm import DEFAULT_VIDEO_POLISH_PROMPT
    prompt = processor.polish_video_prompt.call_args.args[2]
    assert not prompt.startswith(DEFAULT_VIDEO_POLISH_PROMPT)
    assert "integrated_multimodal_description" in prompt
    assert 'MiniMax H3' in prompt
    assert 'Director profile revision: 3' in prompt


@pytest.mark.parametrize('r2v', [False, True])
def test_h3_polish_rejects_plain_prompt_response(monkeypatch, r2v):
    processor = Mock()
    processor.polish_video_prompt.return_value = {
        'prompt_cn': '场景设定：直播间。角色动作：主播举起药盒。镜头运动：缓慢推进。',
        'prompt_en': 'A presenter raises the product while the camera slowly pushes in.',
    }
    processor.polish_r2v_prompt.return_value = processor.polish_video_prompt.return_value
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    request = dict(draft_prompt='主播举起药盒', target_video_model='uniart/minimax-h3-vip')

    with pytest.raises(api.HTTPException) as exc_info:
        if r2v:
            _confirmed_r2v(api.PolishR2VPromptRequest(slots=[], **request))
        else:
            _confirmed_video(api.PolishVideoPromptRequest(**request))

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail['reason'] == 'model_contract_mismatch'


@pytest.mark.parametrize('r2v,fields', [
    (False, ('integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music')),
    (True, ('subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music')),
])
def test_h3_polish_accepts_required_structure(monkeypatch, r2v, fields):
    structured = '\n'.join(f'{field}: value' for field in fields)
    processor = Mock()
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    processor.polish_r2v_prompt.return_value = processor.polish_video_prompt.return_value
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    request = dict(draft_prompt='主播举起药盒', target_video_model='uniart/minimax-h3-vip')

    if r2v:
        result = _confirmed_r2v(api.PolishR2VPromptRequest(slots=[], **request))
    else:
        result = _confirmed_video(api.PolishVideoPromptRequest(**request))

    assert result == {'prompt_cn': structured, 'prompt_en': structured}


def test_h3_polish_accepts_markdown_field_headings(monkeypatch):
    structured = '\n'.join([
        '1. **subject_definitions:** value',
        '2. **summary:** value',
        '3. **retention_analysis:** value',
        '4. **detailed_description:** value',
        '5. **overall_soundscape:** N/A',
        '6. **non_diegetic_music:** N/A',
    ])
    processor = Mock()
    processor.polish_r2v_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    result = _confirmed_r2v(api.PolishR2VPromptRequest(
        draft_prompt='主播举起药盒',
        slots=[],
        target_video_model='uniart/minimax-h3-vip',
    ))

    assert result == {'prompt_cn': structured, 'prompt_en': structured}


def test_r2v_polish_accepts_minimax_ir_base_h3_contract(monkeypatch):
    structured = '\n'.join([
        'integrated_multimodal_description: [Shot 1] Su Yan draws his sword.',
        'overall_soundscape: Metal collision and wind.',
        'non_diegetic_music: N/A',
    ])
    processor = Mock()
    processor.polish_r2v_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    result = _confirmed_r2v(api.PolishR2VPromptRequest(
        draft_prompt='苏砚拔剑横掠',
        slots=[],
        target_video_model='uniart/minimax-h3-vip',
    ))

    assert result == {'prompt_cn': structured, 'prompt_en': structured}


def test_seedance_polish_does_not_require_h3_fields(monkeypatch):
    processor = Mock()
    result = {'prompt_cn': '场景与动作描述', 'prompt_en': 'Scene and action description'}
    processor.polish_video_prompt.return_value = result
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    response = _confirmed_video(api.PolishVideoPromptRequest(
        draft_prompt='主播举起药盒',
        target_video_model='uniart/seedance-2.5-vip',
    ))

    assert response == result


def test_h3_audio_polish_rejects_result_that_drops_explicit_dialogue(monkeypatch):
    structured = '\n'.join([
        'integrated_multimodal_description: 主播举起药盒。',
        'overall_soundscape: 环境声；未提供明确台词，因此不生成对白。',
        'non_diegetic_music: N/A',
    ])
    processor = Mock()
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    with pytest.raises(api.HTTPException) as exc_info:
        _confirmed_video(api.PolishVideoPromptRequest(
            draft_prompt='主播举起药盒',
            target_video_model='uniart/minimax-h3-vip',
            generate_audio=True,
            dialogue_speaker='女主播',
            dialogue_line='今天这款穿心莲分散片，我们决定给大家随机立减！',
        ))

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail['reason'] == 'model_contract_mismatch'


def test_h3_audio_polish_passes_exact_dialogue_to_skill_and_accepts_it(monkeypatch):
    line = '今天这款穿心莲分散片，我们决定给大家随机立减！'
    structured = '\n'.join([
        f'integrated_multimodal_description: 女主播 says: <d>[Mandarin] {line}</d>',
        f'overall_soundscape: 女主播清晰说出：{line}',
        'non_diegetic_music: N/A',
    ])
    processor = Mock()
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    result = _confirmed_video(api.PolishVideoPromptRequest(
        draft_prompt='主播举起药盒',
        target_video_model='uniart/minimax-h3-vip',
        generate_audio=True,
        dialogue_speaker='女主播',
        dialogue_line=line,
    ))

    system_prompt = processor.polish_video_prompt.call_args.args[2]
    assert f'女主播: {line}' in system_prompt
    assert result['prompt_en'].count(line) == 2


@pytest.mark.parametrize('r2v', [False, True])
def test_h3_polish_rejects_plain_prompt_response(monkeypatch, r2v):
    processor = Mock()
    processor.polish_video_prompt.return_value = {
        'prompt_cn': '场景设定：直播间。角色动作：主播举起药盒。镜头运动：缓慢推进。',
        'prompt_en': 'A presenter raises the product while the camera slowly pushes in.',
    }
    processor.polish_r2v_prompt.return_value = processor.polish_video_prompt.return_value
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    request = dict(draft_prompt='主播举起药盒', target_video_model='uniart/minimax-h3-vip')

    with pytest.raises(api.HTTPException) as exc_info:
        if r2v:
            _confirmed_r2v(api.PolishR2VPromptRequest(slots=[], **request))
        else:
            _confirmed_video(api.PolishVideoPromptRequest(**request))

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail['reason'] == 'model_contract_mismatch'


@pytest.mark.parametrize('r2v,fields', [
    (False, ('integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music')),
    (True, ('subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music')),
])
def test_h3_polish_accepts_required_structure(monkeypatch, r2v, fields):
    structured = '\n'.join(f'{field}: value' for field in fields)
    processor = Mock()
    processor.polish_video_prompt.return_value = {'prompt_cn': structured, 'prompt_en': structured}
    processor.polish_r2v_prompt.return_value = processor.polish_video_prompt.return_value
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    request = dict(draft_prompt='主播举起药盒', target_video_model='uniart/minimax-h3-vip')

    if r2v:
        result = _confirmed_r2v(api.PolishR2VPromptRequest(slots=[], **request))
    else:
        result = _confirmed_video(api.PolishVideoPromptRequest(**request))

    assert result == {'prompt_cn': structured, 'prompt_en': structured}


def test_seedance_polish_does_not_require_h3_fields(monkeypatch):
    processor = Mock()
    result = {'prompt_cn': '场景与动作描述', 'prompt_en': 'Scene and action description'}
    processor.polish_video_prompt.return_value = result
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    response = _confirmed_video(api.PolishVideoPromptRequest(
        draft_prompt='主播举起药盒',
        target_video_model='uniart/seedance-2.5-vip',
    ))

    assert response == result


@pytest.mark.parametrize('r2v', [False, True])
def test_selected_images_reach_polish_model_in_order(r2v):
    from src.apps.comic_gen.llm import ScriptProcessor
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{"prompt_cn":"优化后的完整镜头", "prompt_en":"A detailed cinematic shot with the selected product."}'
    urls = ['https://example.test/person.png', 'https://example.test/product.png']
    if r2v:
        processor.polish_r2v_prompt('original', [], image_urls=urls)
    else:
        processor.polish_video_prompt('original', image_urls=urls)
    content = processor.llm.chat.call_args.kwargs['messages'][1]['content']
    assert [part['image_url']['url'] for part in content if part['type'] == 'image_url'] == urls


def test_unreadable_reference_does_not_silently_become_text_only():
    from src.apps.comic_gen.llm import ScriptProcessor, PolishError
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    with pytest.raises(PolishError):
        processor.polish_video_prompt('original', image_urls=['/files/nonexistent-reference.png'])
    processor.llm.chat.assert_not_called()


def test_signed_studio_reference_reaches_polish_as_owner_verified_local_image(monkeypatch, tmp_path):
    from src.apps.comic_gen.llm import ScriptProcessor
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user, studio_media_url, studio_owner_dir

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only")
    owner = "polish-owner"
    image = tmp_path / studio_owner_dir(owner) / "reference.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"test-image")
    signed = studio_media_url(owner, image.relative_to(tmp_path / "output").as_posix())
    token = set_studio_user(UserContext("user", owner, "User", "token"))
    try:
        processor = ScriptProcessor.__new__(ScriptProcessor)
        processor.llm = Mock(is_configured=True)
        processor.llm.chat.return_value = '{"prompt_cn":"中文镜头", "prompt_en":"English shot"}'
        processor.polish_video_prompt("original", image_urls=api._polish_image_urls([signed]))
        content = processor.llm.chat.call_args.kwargs["messages"][1]["content"]
        assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    finally:
        reset_studio_user(token)


def test_polish_rejects_foreign_studio_media_reference(monkeypatch, tmp_path):
    from src.apps.comic_gen.llm import PolishError
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user, studio_media_url, studio_owner_dir

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only")
    image = tmp_path / studio_owner_dir("other-owner") / "reference.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"test-image")
    signed = studio_media_url("other-owner", image.relative_to(tmp_path / "output").as_posix())
    token = set_studio_user(UserContext("user", "current-owner", "User", "token"))
    try:
        with pytest.raises(PolishError, match="Reference image could not be read"):
            api._polish_image_urls([signed])
    finally:
        reset_studio_user(token)


def test_h3_submission_maps_editor_tokens_to_submitted_picture_order():
    from src.apps.comic_gen.reference_prompt import bind_storyboard_prompt
    prompt = '[character2:产品] replaced by [character1:主播], @2'
    assert bind_storyboard_prompt(prompt, 'uniart/minimax-h3-vip', 2) == '<Picture 2> 产品 replaced by <Picture 1> 主播, <Picture 2>'


def test_h3_submission_rejects_mixed_unresolved_syntax():
    from src.apps.comic_gen.reference_prompt import bind_storyboard_prompt
    with pytest.raises(ValueError):
        bind_storyboard_prompt('use @product and [Picture 1]', 'uniart/minimax-h3-vip', 1)


def test_r2v_h3_contract_forbids_t2va_label():
    text = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', optimization_skills=['minimax-h3-director'],
        reference_mode=True,
    )
    assert 'R2V / REF2VA MODE' in text
    assert 'Never label the task' in text


def test_r2v_h3_result_rejects_t2va_label():
    from src.apps.comic_gen.llm import PolishError
    body = (
        'subject_definitions:\nS1: character\nsummary:\n[T2VA] scene\n'
        'retention_analysis:\nnone\ndetailed_description:\nscene\n'
        'overall_soundscape:\nN/A\nnon_diegetic_music:\nN/A'
    )
    with pytest.raises(PolishError) as error:
        api._validate_storyboard_polish_result(
            'uniart/minimax-h3-vip',
            {'prompt_cn': body, 'prompt_en': body},
            reference_mode=True,
        )
    assert "误标为 T2VA" in error.value.message_zh


def test_r2v_scene_lighting_reads_exact_selected_variant_lineage(monkeypatch):
    parent_variant = SimpleNamespace(id="street-final", scene_tool={
        "kind": "lighting", "light_side": "right", "color": "#f3f4f6",
        "brightness": 50, "rim_light": False,
    })
    parent = SimpleNamespace(id="street", name="长街", image_asset=SimpleNamespace(variants=[parent_variant]))
    snapshot = AssetImageSubmissionSnapshot(
        positive_prompt="Do not transfer this action or dialogue", selected_model_id="image",
        aspect_ratio="16:9", generation_type="all", image_generation_mode="reference",
        reference_inputs=[{"asset_type": "scene", "asset_id": "street", "variant_id": "street-final"}],
        visual_design={"ambient_lighting": "黄昏", "visual_notes": "前镜人物挥刀"},
        design_revision_at_submission=3,
    )
    shop_variant = SimpleNamespace(id="shop-final", submission_snapshot=snapshot, scene_tool=None)
    shop = SimpleNamespace(id="shop", name="粮铺门前", image_asset=SimpleNamespace(
        selected_id="shop-final", variants=[shop_variant],
    ))
    monkeypatch.setattr(api.pipeline, "resolve_project_assets", lambda script: {"scenes": [shop, parent]})
    frame = SimpleNamespace(scene_id="shop", workbench_reference_variant_ids={})
    lighting = api._r2v_scene_lighting(object(), frame, "[character2:粮铺门前]")
    assert lighting["variant_id"] == "shop-final"
    assert lighting["source_variant_id"] == "street-final"
    assert lighting["fields"] == {
        "ambient_lighting": "黄昏", "light_side": "right", "color": "#f3f4f6",
        "brightness": 50, "rim_light": False,
    }
    assert "挥刀" not in str(lighting)
    assert api._r2v_scene_lighting(object(), SimpleNamespace(
        scene_id="another-place", workbench_reference_variant_ids={},
    ), "[character2:粮铺门前]") is None
    shop.image_asset.variants.append(SimpleNamespace(id="shop-old", submission_snapshot=None, scene_tool=None))
    assert api._r2v_scene_lighting(object(), frame, "[character2:粮铺门前]",
                                   {"shop": ["shop-old"]}) is None
    shop_variant.submission_snapshot = None
    assert api._r2v_scene_lighting(object(), frame, "[character2:粮铺门前]") is None


def test_r2v_character_design_resolves_selected_asset_id_and_image_revision(monkeypatch):
    old = {"revision": 1, "design": {"identity": {"visual_notes": "脸颊有浅细纹"},
                                     "look": {"features": {"衣服": "玄色短衣"}},
                                     "field_answers": {"action": "上一镜挥刀"}}}
    newer = {"revision": 2, "design": {"identity": {"visual_notes": "另一版容貌"}}}
    variant = SimpleNamespace(id="portrait-1", submission_snapshot=SimpleNamespace(
        design_revision_at_submission=1,
    ))
    character = SimpleNamespace(
        id="character-42", name="探子", character_design={"design_revisions": [old, newer]},
        asset_pack=None, reference_sheet=SimpleNamespace(image_variants=[variant]),
    )
    monkeypatch.setattr(api.pipeline, "resolve_project_assets", lambda script: {
        "characters": [character], "scenes": [], "props": [],
    })
    request = api.PolishR2VPromptRequest(
        draft_prompt="[character2:探子]走进房间", slots=[{
            "description": "探子", "slot": 2, "asset_id": "character-42", "asset_type": "character",
            "name": "探子", "variant_ids": ["portrait-1"],
        }], image_urls=["portrait-url"],
    )
    designs = api._r2v_reference_designs(object(), request)
    assert designs == [{"slot": 2, "name": "探子",
                        "design_revision": 1, "design": {
                            "identity": {"visual_notes": "脸颊有浅细纹"},
                            "look": {"features": {"衣服": "玄色短衣"}},
                        }}]
    assert "上一镜挥刀" not in str(designs)
    assert "另一版容貌" not in str(designs)
    with pytest.raises(api.HTTPException) as wrong_id:
        api._r2v_reference_designs(object(), request.model_copy(update={"slots": [
            api.RefSlot(description="探子", slot=2, asset_id="other", asset_type="character",
                        name="探子", variant_ids=["portrait-1"]),
        ]}))
    assert wrong_id.value.status_code == 422


def test_r2v_character_design_uses_current_confirmed_fields_without_image_constraints(monkeypatch):
    variant = SimpleNamespace(id="uploaded", submission_snapshot=None)
    character = SimpleNamespace(
        id="role", name="掌柜", character_design={"design_revisions": [{
            "revision": 3, "design": {"identity": {"visual_notes": "灰白发髻"}},
        }]}, asset_pack=None, reference_sheet=SimpleNamespace(image_variants=[variant]),
    )
    monkeypatch.setattr(api.pipeline, "resolve_project_assets", lambda script: {
        "characters": [character], "scenes": [], "props": [],
    })
    request = api.PolishR2VPromptRequest(
        draft_prompt="[character1:掌柜]", slots=[{
            "description": "掌柜", "slot": 1, "asset_id": "role", "asset_type": "character",
            "name": "掌柜", "variant_ids": ["uploaded"],
        }], image_urls=["uploaded-url"],
    )
    design = api._r2v_reference_designs(object(), request)[0]
    assert design == {"slot": 1, "name": "掌柜", "design_revision": 3,
                      "design": {"identity": {"visual_notes": "灰白发髻"}}}
    character.character_design = {"design_revisions": [{
        "revision": 4, "design": {"identity": {}, "look": {}},
    }]}
    assert api._r2v_reference_designs(object(), request) == []


def test_r2v_preview_uses_character_design_and_rejects_stale_review(monkeypatch):
    variant = SimpleNamespace(id="portrait", submission_snapshot=None)
    character = SimpleNamespace(
        id="role", name="掌柜", character_design={"design_revisions": [{
            "revision": 1, "design": {"identity": {"visual_notes": "灰白发髻"}},
        }]}, asset_pack=None, reference_sheet=SimpleNamespace(image_variants=[variant]),
    )
    frame = SimpleNamespace(id="shot", workbench_reference_variant_ids={})
    script = SimpleNamespace(frames=[frame])
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(owner_profile_id="owner"))
    monkeypatch.setattr(api.pipeline, "get_script", lambda *args: script)
    monkeypatch.setattr(api.pipeline, "resolve_project_assets", lambda script: {
        "characters": [character], "scenes": [], "props": [],
    })
    monkeypatch.setattr(api.pipeline, "storyboard_continuity_sheet", lambda *args: {"rows": []})
    monkeypatch.setattr(api, "_r2v_scene_lighting", lambda *args: None)
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "")
    request = api.PolishR2VPromptRequest(
        draft_prompt="[character1:掌柜]", script_id="project", frame_id="shot",
        slots=[{"description": "掌柜", "slot": 1, "asset_id": "role",
                "asset_type": "character", "name": "掌柜", "variant_ids": ["portrait"]}],
        image_urls=["portrait-url"], optimization_skills=[],
    )
    reviewed = api.preview_r2v_polish_prompt(request)
    assert "灰白发髻" in reviewed["messages"]["system"]
    assert "CHARACTER ASSET IDENTITY AND LOOK" in reviewed["messages"]["system"]
    assert "legacy_image" not in reviewed["messages"]["system"]
    assert "submission_snapshot" not in reviewed["messages"]["system"]
    assert "design_revision" not in reviewed["messages"]["system"]
    character.character_design["design_revisions"].append({
        "revision": 2, "design": {"identity": {"visual_notes": "黑发"}},
    })
    with pytest.raises(api.HTTPException) as stale:
        api._require_video_polish_review(request.model_copy(update={
            "review_token": reviewed["review_token"], "reviewed_messages": reviewed["messages"],
        }), True)
    assert stale.value.status_code == 409


def test_r2v_scene_lighting_conflict_requires_review_and_changes_model_input(monkeypatch):
    frame = SimpleNamespace(id="shot", workbench_reference_variant_ids={})
    script = SimpleNamespace(frames=[frame])
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(owner_profile_id="owner"))
    monkeypatch.setattr(api.pipeline, "get_script", lambda *args: script)
    monkeypatch.setattr(api.pipeline, "storyboard_continuity_sheet", lambda *args: {"rows": [{
        "frame_id": "shot", "fields": {"direction": {
            "value": "左后侧", "source_kind": "frame", "source_revision": None,
        }},
    }]})
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "")
    monkeypatch.setattr(api, "_r2v_scene_lighting", lambda *args: {
        "scene_name": "粮铺门前", "scene_id": "shop", "variant_id": "shop-final",
        "source_variant_id": "street-final", "design_revision": 3,
        "fields": {"light_side": "right", "brightness": 50},
    })
    request = api.PolishR2VPromptRequest(
        draft_prompt="[character2:粮铺门前]", slots=[], script_id="project", frame_id="shot",
        image_urls=["signed-shop-image"], target_video_model="uniart/minimax-h3-vip",
        optimization_skills=[],
    )
    pending = api.preview_r2v_polish_prompt(request)
    assert pending["review_context"]["scene_lighting"]["requires_decision"] is True
    with pytest.raises(api.HTTPException) as error:
        api._require_video_polish_review(request.model_copy(update={
            "review_token": pending["review_token"], "reviewed_messages": pending["messages"],
        }), True)
    assert error.value.status_code == 422

    reference_request = request.model_copy(update={"reference_lighting_choice": "reference"})
    reference = api.preview_r2v_polish_prompt(reference_request)
    assert "Use these frozen reference lighting fields" in reference["messages"]["system"]
    assert '"direction":' not in reference["messages"]["system"]
    assert reference["review_token"] != pending["review_token"]
    assert api._require_video_polish_review(reference_request.model_copy(update={
        "review_token": reference["review_token"], "reviewed_messages": reference["messages"],
    }), True) == reference["messages"]
    shot = api.preview_r2v_polish_prompt(request.model_copy(update={"reference_lighting_choice": "shot"}))
    assert "Keep this shot's lighting values" in shot["messages"]["system"]
    assert '"direction":' in shot["messages"]["system"]
    monkeypatch.setattr(api, "_r2v_scene_lighting", lambda *args: {
        "scene_name": "粮铺门前", "scene_id": "shop", "variant_id": "shop-new",
        "source_variant_id": "street-new", "design_revision": 4,
        "fields": {"light_side": "left", "brightness": 40},
    })
    with pytest.raises(api.HTTPException) as stale:
        api._require_video_polish_review(reference_request.model_copy(update={
            "review_token": reference["review_token"], "reviewed_messages": reference["messages"],
        }), True)
    assert stale.value.status_code == 409


def test_non_h3_submission_strips_semantic_editor_tags():
    from src.apps.comic_gen.reference_prompt import bind_storyboard_prompt
    prompt = '[character:主播] holds [prop:药盒] in [scene:直播间]'
    assert bind_storyboard_prompt(prompt, 'uniart/seedance-2.5-vip', 3).strip() == 'holds  in'
