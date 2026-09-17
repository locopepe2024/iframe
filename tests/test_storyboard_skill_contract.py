from unittest.mock import Mock
import pytest
from src.apps.comic_gen import api


@pytest.mark.parametrize('model,label', [('uniart/minimax-h3-vip', 'MiniMax H3'), ('uniart/seedance-2.5-vip', 'Seedance')])
def test_skill_loads_outside_repo_and_preserves_editor_contract(monkeypatch, tmp_path, model, label):
    monkeypatch.chdir(tmp_path)
    text = api._target_model_guidance(model)
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
    assert prompt.startswith(DEFAULT_VIDEO_POLISH_PROMPT)
    assert 'MiniMax H3' in prompt
