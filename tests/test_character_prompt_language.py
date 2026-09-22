from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.character_prompts import (
    DEFAULT_CHARACTER_STYLE_SUFFIX,
    append_style_suffix,
    build_character_image_prompt,
    build_reference_sheet_prompt,
)
from src.apps.comic_gen.models import Character


def test_character_prompt_defaults_are_chinese_and_normalize_punctuation():
    prompt = build_character_image_prompt(
        "full_body",
        "周涵（大学时期）",
        "黑色短发，五官端正，身材高挑匀称，外形阳光帅气，具有年轻大学生的清爽气质。",
    )

    assert "全身角色设计：周涵（大学时期）" in prompt
    assert "Full body" not in prompt
    assert "concept art" not in prompt
    assert "。." not in prompt


def test_reference_sheet_default_is_chinese():
    prompt = build_reference_sheet_prompt("周涵（大学时期）", "黑色短发。")

    assert prompt.startswith("角色设定参考图：周涵（大学时期）")
    assert "多视角展示：正面、侧面和背面" in prompt
    assert "Character reference sheet" not in prompt


def test_style_suffix_is_appended_without_duplicate_terminal_punctuation():
    prompt = append_style_suffix("角色描述。", "电影感光线，写实")
    english_style = append_style_suffix("角色描述。", "Japanese live-action film look")

    assert prompt == "角色描述。电影感光线，写实"
    assert english_style == "角色描述。 Japanese live-action film look"
    assert "。." not in prompt


@pytest.mark.parametrize("generation_type, english_marker", [
    ("full_body", "Full body character design"),
    ("three_view", "Character Reference Sheet"),
    ("headshot", "Close-up portrait"),
])
def test_asset_generator_uses_chinese_fallback_prompt(tmp_path, monkeypatch, generation_type, english_marker):
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = str(tmp_path / "output" / "assets")
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    monkeypatch.setattr("src.apps.comic_gen.assets.time.sleep", lambda _: None)

    character = Character(
        id="char",
        name="周涵（大学时期）",
        description="黑色短发。",
        full_body_image_url="characters/base.png" if generation_type != "full_body" else None,
    )
    generator.generate_character(character, generation_type=generation_type, batch_size=1)

    generated_prompt = model.generate.call_args.args[0]
    assert english_marker not in generated_prompt
    assert "电影感光线，电影剧照，8K，细节丰富，写实" == DEFAULT_CHARACTER_STYLE_SUFFIX
    assert DEFAULT_CHARACTER_STYLE_SUFFIX in generated_prompt
    assert "黑色短发。" in generated_prompt
