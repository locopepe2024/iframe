from src.apps.comic_gen.llm import DEFAULT_ENTITY_EXTRACTION_PROMPT, ScriptProcessor, entity_extraction_prompt_revision
from unittest.mock import Mock
import json
import pytest


def test_temporal_character_variants_share_persona_with_full_width_parentheses():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    script = processor._create_script_from_data(
        "测试剧本",
        "周涵在大学时期认识沈夏。",
        {
            "characters": [
                {"id": "char_zhou", "name": "周涵", "description": "外观：青年；性格：谨慎"},
                {"id": "char_zhou_college", "name": "周涵（大学时期）", "description": "外观：学生装"},
                {"id": "char_zhou_work", "name": "周涵 (职场时期)", "description": "外观：西装"},
            ],
            "scenes": [],
            "props": [],
        },
    )

    base = next(character for character in script.characters if character.name == "周涵")
    college = next(character for character in script.characters if character.name == "周涵（大学时期）")
    work = next(character for character in script.characters if character.name == "周涵 (职场时期)")

    assert college.base_character_id == base.id
    assert work.base_character_id == base.id
    assert base.persona == college.persona == work.persona == "周涵"


def test_entity_prompt_requires_separate_visual_variants_for_temporal_states():
    assert "周涵（大学时期）" in DEFAULT_ENTITY_EXTRACTION_PROMPT
    assert "分别生成和绑定不同的角色设计" in DEFAULT_ENTITY_EXTRACTION_PROMPT


def test_scene_extraction_skill_applies_to_custom_prompt_and_persists_draft():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    baseline = {
        "scene_identity": "青溪镇长街中段粮铺", "location_type": "粮铺",
        "fixed_geometry": ["临街木质铺面", "柜台"], "fixed_landmarks": ["粮袋", "竹筐"],
        "materials": ["旧木", "石板"], "environment": ["长街纵深"],
        "time_baseline": "黄昏", "lighting_baseline": "与青溪镇长街一致的光影",
        "composition_tendency": "", "reusable_constraints": [], "basis": ["observed"],
    }
    scene = {"name": "粮铺", "description": "流民匪寇正在劫掠，百姓退后",
             "asset_baseline": baseline,
             "shot_only_content": ["流民匪寇劫掠", "百姓退让", "近中远景人物分配"],
             "uncertainties": []}
    processor.llm.chat.return_value = json.dumps({"characters": [], "scenes": [scene], "props": []}, ensure_ascii=False)

    script = processor.parse_novel("测试", "长街中段粮铺，匪寇劫掠，百姓退让，黄昏", "请提取：{text}")
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "scene-asset-extraction" in prompt
    assert "<performer_tier_skill>" in prompt
    assert "固定群演" in prompt
    assert "shot_only_content" in prompt
    assert "匪寇劫掠" not in script.scenes[0].description
    assert script.scenes[0].asset_design["design_draft"]["asset_baseline"] == baseline
    assert script.scenes[0].asset_design["design_draft"]["shot_only_content"] == scene["shot_only_content"]
    assert script.scenes[0].asset_design["design_revisions"] == []

    reviewed = script.scenes[0].model_dump()
    applied = processor._create_script_from_data("测试", "原文", {"characters": [], "scenes": [reviewed], "props": []})
    assert applied.scenes[0].asset_design["design_draft"]["asset_baseline"] == baseline
    assert applied.scenes[0].asset_design["design_revisions"] == []


def test_live_scene_extraction_rejects_missing_baseline():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps({"characters": [], "scenes": [{"name": "粮铺", "description": "匪寇劫掠"}], "props": []}, ensure_ascii=False)
    with pytest.raises(ValueError, match="缺少可复用资产基线"):
        processor.parse_novel("测试", "匪寇劫掠粮铺")


def test_scene_extraction_guidance_keeps_distinct_street_corners():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    prompt = processor._construct_prompt(
        "苏砚在梧桐树街角；另一处街角，江灼惩戒欺凌卖艺少女的打手。"
    )
    assert "<script_analysis_skill>" in prompt
    assert "两个同名地点不能仅凭名称合并" in prompt
    assert "人物交集只是证据线索" in prompt
    assert "梧桐树街角" in prompt
    assert "另一处街角" in prompt
    assert "不编造建筑或摊位" in prompt
    assert "<scene_asset_extraction_skill>" in prompt
    assert "本 Skill 只记录可确认的固定结构" in prompt
    assert "从粮铺门前朝阁楼方向可见屋檐" in prompt
    assert "从阁楼望见粮铺门前" in prompt
    assert "潜伏、围堵等当前事件" in prompt


def test_script_skill_changes_entity_extraction_revision(monkeypatch):
    import src.apps.comic_gen.llm as llm

    current = entity_extraction_prompt_revision()
    monkeypatch.setattr(llm, "_load_script_analysis_skill", lambda: "updated script analysis")
    assert entity_extraction_prompt_revision() != current


def test_performer_skill_changes_entity_extraction_revision(monkeypatch):
    import src.apps.comic_gen.llm as llm

    current = entity_extraction_prompt_revision()
    monkeypatch.setattr(llm, "_load_performer_tier_skill", lambda: "updated performer tiers")
    assert entity_extraction_prompt_revision() != current


def test_entity_extraction_preserves_crowd_group_candidates():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    scene = {
        "id": "scene-1", "name": "长街", "description": "青石板长街",
        "asset_baseline": {
            "scene_identity": "长街", "location_type": "街道", "fixed_geometry": [],
            "fixed_landmarks": [], "materials": [], "environment": [], "time_baseline": "黄昏",
            "lighting_baseline": "", "composition_tendency": "", "reusable_constraints": [],
            "basis": ["observed"],
        },
    }
    script = processor._create_script_from_data(
        "测试", "长街上百姓避让",
        {"characters": [], "crowd_groups": [{"extra_id": "crowd-town", "label": "青溪镇市井百姓"}], "scenes": [scene], "props": []},
    )
    assert [item.label for item in script.crowd_group_candidates] == ["青溪镇市井百姓"]
    assert script.crowd_group_candidates[0].kind == "extra_template"
