from src.apps.comic_gen.models import DialogueStructured, StoryboardFrame
from src.apps.comic_gen.prompt_assembly import enrich_prompt_with_dialogue


def _frame(line: str) -> StoryboardFrame:
    return StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        dialogue_structured=DialogueStructured(speaker="女主播", line=line),
    )


def test_dialogue_enrichment_does_not_repeat_structured_provider_prompt():
    line = "今天这款药，我们决定给大家随机立减！"
    prompt = f"女主播 says: <d>[Mandarin] {line}</d>"

    result = enrich_prompt_with_dialogue(prompt, _frame(line))

    assert result == prompt
    assert result.count(line) == 1


def test_dialogue_enrichment_keeps_mouth_cue_without_repeating_plain_line():
    line = "欢迎来到直播间。"
    prompt = f"画面中出现对白：{line}"

    result = enrich_prompt_with_dialogue(prompt, _frame(line))

    assert result.count(line) == 1
    assert "张嘴说话" in result
    assert "台词：「" not in result
