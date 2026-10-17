from unittest.mock import Mock
import pytest
from src.apps.comic_gen import api


@pytest.mark.parametrize('model,label', [('uniart/minimax-h3-vip', 'MiniMax H3'), ('uniart/seedance-2.5-vip', 'Seedance')])
def test_skill_loads_outside_repo_and_preserves_editor_contract(monkeypatch, tmp_path, model, label):
    monkeypatch.chdir(tmp_path)
    text = api._storyboard_polish_contract(model, '', '')
    assert label in text
    assert 'prompt_cn' in text and '[characterN:name]' in text
    assert 'replacement' in text


def test_explicit_skill_selection_is_independent_from_target_model():
    text = api._storyboard_polish_contract(
        'uniart/minimax-h3-vip', '', '', optimization_skills=['seedance-camera']
    )
    assert 'SELECTED OPTIMIZATION SKILLS' in text
    assert 'seedance-camera' in text
    assert 'MiniMax H3 分段导演' not in text


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
    request = api.PolishVideoPromptRequest(draft_prompt='动作', optimizer_provider=provider)
    assert api._effective_optimization_skills(request) == [expected]


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
    api.polish_video_prompt(api.PolishVideoPromptRequest(
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
            api.polish_video_prompt(api.PolishVideoPromptRequest(
                draft_prompt='action', generation_mode='first_last_frame', image_urls=images,
            ))
        assert exc.value.status_code == 502
        assert '两张不同' in exc.value.detail['message_zh']
    processor.polish_video_prompt.assert_not_called()


def test_first_last_polish_passes_mode_and_two_images_to_processor(monkeypatch):
    processor = Mock()
    result = '首帧图像在0.00秒，尾帧图像在8.00秒。\nintegrated_multimodal_description: opening to ending\noverall_soundscape: N/A\nnon_diegetic_music: N/A'
    processor.polish_video_prompt.return_value = {'prompt_cn': result, 'prompt_en': result}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    monkeypatch.setattr(api, '_polish_image_urls', lambda values: values)
    api.polish_video_prompt(api.PolishVideoPromptRequest(
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
        'uniart/seedance-2.5-vip', '', '', optimization_skills=['seedance-camera'])
    assert 'FINAL H3 ENFORCEMENT' not in text


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
    api.polish_video_prompt(api.PolishVideoPromptRequest(draft_prompt='replace character', target_video_model='uniart/minimax-h3-vip'))
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
            api.polish_r2v_prompt(api.PolishR2VPromptRequest(slots=[], **request))
        else:
            api.polish_video_prompt(api.PolishVideoPromptRequest(**request))

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
        result = api.polish_r2v_prompt(api.PolishR2VPromptRequest(slots=[], **request))
    else:
        result = api.polish_video_prompt(api.PolishVideoPromptRequest(**request))

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

    result = api.polish_r2v_prompt(api.PolishR2VPromptRequest(
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

    result = api.polish_r2v_prompt(api.PolishR2VPromptRequest(
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

    response = api.polish_video_prompt(api.PolishVideoPromptRequest(
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
        api.polish_video_prompt(api.PolishVideoPromptRequest(
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

    result = api.polish_video_prompt(api.PolishVideoPromptRequest(
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
            api.polish_r2v_prompt(api.PolishR2VPromptRequest(slots=[], **request))
        else:
            api.polish_video_prompt(api.PolishVideoPromptRequest(**request))

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
        result = api.polish_r2v_prompt(api.PolishR2VPromptRequest(slots=[], **request))
    else:
        result = api.polish_video_prompt(api.PolishVideoPromptRequest(**request))

    assert result == {'prompt_cn': structured, 'prompt_en': structured}


def test_seedance_polish_does_not_require_h3_fields(monkeypatch):
    processor = Mock()
    result = {'prompt_cn': '场景与动作描述', 'prompt_en': 'Scene and action description'}
    processor.polish_video_prompt.return_value = result
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')

    response = api.polish_video_prompt(api.PolishVideoPromptRequest(
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


def test_non_h3_submission_strips_semantic_editor_tags():
    from src.apps.comic_gen.reference_prompt import bind_storyboard_prompt
    prompt = '[character:主播] holds [prop:药盒] in [scene:直播间]'
    assert bind_storyboard_prompt(prompt, 'uniart/seedance-2.5-vip', 3).strip() == 'holds  in'
