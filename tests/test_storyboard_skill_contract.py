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
    processor.polish_video_prompt.return_value = {'prompt_cn': '中文', 'prompt_en': 'English'}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_polish_model_for_project', lambda *a: '')
    api.polish_video_prompt(api.PolishVideoPromptRequest(draft_prompt='replace character', target_video_model='uniart/minimax-h3-vip'))
    from src.apps.comic_gen.llm import DEFAULT_VIDEO_POLISH_PROMPT
    prompt = processor.polish_video_prompt.call_args.args[2]
    assert not prompt.startswith(DEFAULT_VIDEO_POLISH_PROMPT)
    assert "integrated_multimodal_description" in prompt
    assert 'MiniMax H3' in prompt


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
