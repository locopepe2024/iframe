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
