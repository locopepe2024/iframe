from src.apps.comic_gen.llm import DEFAULT_ENTITY_EXTRACTION_PROMPT, ScriptProcessor


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
