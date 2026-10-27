from types import SimpleNamespace

import pytest

from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_character_design_draft_and_confirmed_revisions_are_separate():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id="project")
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    saved = []
    pipeline._save_after_asset_mutation = lambda source: saved.append(source)

    draft = {"route": "historical-costume", "identity": {"visual_notes": "深棕眼，黑发束起"}, "confirmed": False}
    pipeline.update_asset_attributes("project", "character", "character", {"character_design": draft})
    assert character.character_design["design_draft"] == draft
    assert "design_revisions" not in character.character_design

    confirmed = {**draft, "confirmed": True}
    pipeline.update_asset_attributes("project", "character", "character", {"character_design": confirmed})
    pipeline.update_asset_attributes("project", "character", "character", {"character_design": confirmed})
    assert [item["revision"] for item in character.character_design["design_revisions"]] == [1, 2]
    assert character.character_design["design_revisions"][0]["design"]["identity"]["visual_notes"] == "深棕眼，黑发束起"
    assert len(saved) == 3


def test_character_design_confirmation_requires_concrete_visual_value():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id="project")
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None

    with pytest.raises(ValueError, match="concrete visual design"):
        pipeline.update_asset_attributes("project", "character", "character", {
            "character_design": {"route": "anime-stylized", "identity": {}, "confirmed": True},
        })
    assert character.character_design == {}


def test_character_design_accepts_structured_identity_and_rejects_invalid_features():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id="project")
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None

    design = {"identity": {"features": {"face": "窄长脸", "height": "身高约178厘米"}}, "look": {"features": {"clothing": "深蓝劲装"}},
              "reference_assets": [{"asset_type": "scene", "asset_id": "street", "variant_id": "blue"}], "confirmed": True}
    pipeline.update_asset_attributes("project", "character", "character", {"character_design": design})
    revision = character.character_design["design_revisions"][0]
    assert revision["design"]["identity"]["features"] == {"face": "窄长脸", "height": "身高约178厘米"}
    assert revision["design"]["reference_assets"] == design["reference_assets"]

    for bad in ({"face": 42}, {"camera_angle": "俯拍"}, {"face": "x" * 501}):
        with pytest.raises(ValueError, match="features"):
            pipeline.update_asset_attributes("project", "character", "character", {
                "character_design": {**design, "identity": {"features": bad}},
            })
    assert len(character.character_design["design_revisions"]) == 1


def test_character_design_editor_mode_preserves_both_drafts_but_confirms_active_value():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id="project")
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None

    identity = {"visual_notes": "自然面部不对称", "features": {"face": "窄长脸"}, "editor_mode": "notes"}
    pipeline.update_asset_attributes("project", "character", "character", {
        "character_design": {"identity": identity, "confirmed": True},
    })
    assert character.character_design["design_revisions"][0]["design"]["identity"] == identity

    with pytest.raises(ValueError, match="concrete visual design"):
        pipeline.update_asset_attributes("project", "character", "character", {
            "character_design": {"identity": {**identity, "visual_notes": ""}, "confirmed": True},
        })
    with pytest.raises(ValueError, match="editor mode"):
        pipeline.update_asset_attributes("project", "character", "character", {
            "character_design": {"identity": {**identity, "editor_mode": "hidden"}, "confirmed": False},
        })


def test_expanded_face_and_wardrobe_fields_survive_confirmation():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id='project')
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None
    fields = {'face_shape': '圆脸', 'forehead': '额头饱满', 'cheekbones': '颧骨平缓', 'jaw': '下颌轮廓分明', 'chin': '下巴圆润', 'gender': '女性', 'age': '约72岁', 'eyebrows': '柳叶眉', 'eye_detail': '浅细纹', 'skin_tone': '中性肤色', 'skin_texture': '干燥纹理'}
    look = {'footwear': '布靴', 'jewelry': '无首饰'}
    design = {'identity': {'features': fields, 'editor_mode': 'fields'}, 'look': {'features': look, 'editor_mode': 'fields'}, 'confirmed': True}
    pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': design})
    saved = character.character_design['design_revisions'][0]['design']
    assert saved['identity']['features'] == fields
    assert saved['look']['features'] == look


def test_distinct_condition_fields_survive_draft_snapshot_and_confirmation():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id='project')
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None
    look = {'clothing': '深蓝劲装', 'garment_condition': '衣物整洁', 'jewelry_condition': '首饰旧化'}
    snapshot = {'features': look, 'editor_mode': 'fields', 'basis': ['user_specified']}
    design = {
        'identity': {'features': {'face_shape': '圆脸'}, 'editor_mode': 'fields'},
        'look': {'features': look, 'editor_mode': 'fields'},
        'design_input': {'schema_version': 'iframe.character-design-input.v1', 'prompt': '造型设计',
                         'identity': {'features': {}}, 'look': snapshot},
        'design_result': {'schema_version': 'iframe.character-design-result.v1', 'prompt': '造型结果',
                          'identity': {'features': {}}, 'look': snapshot, 'source': 'panel'},
        'confirmed': True,
    }
    pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': design})
    draft = character.character_design['design_draft']
    revision = character.character_design['design_revisions'][0]['design']
    for saved in (draft, revision):
        assert saved['look']['features'] == look
        assert saved['design_input']['look']['features'] == look
        assert saved['design_result']['look']['features'] == look

    legacy = {'identity': {'features': {'face_shape': '圆脸'}, 'editor_mode': 'fields'},
              'look': {'features': {'condition': '衣物与首饰均有使用痕迹'}, 'editor_mode': 'fields'}, 'confirmed': True}
    pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': legacy})
    assert character.character_design['design_revisions'][1]['design']['look']['features'] == legacy['look']['features']


def test_character_constraints_round_trip_and_reject_invalid_values():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id='project')
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None
    constraints = {'must_keep': ['可见自然皮肤纹理'], 'negative_prompt': ['额外披风']}
    design = {'identity': {'features': {'face_shape': '圆脸'}}, 'constraints': constraints, 'confirmed': True}
    pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': design})
    assert character.character_design['design_revisions'][0]['design']['constraints'] == constraints
    for bad in ({'negative_prompt': '披风'}, {'negative_prompt': [42]}, {'negative_prompt': ['x' * 501]}, {'negative_prompt': ['x'] * 21}, {'unknown': []}, None):
        with pytest.raises(ValueError):
            pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': {**design, 'constraints': bad}})
    assert len(character.character_design['design_revisions']) == 1


def test_character_design_input_and_result_snapshots_round_trip_and_validate():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    character = SimpleNamespace(character_design={})
    script = SimpleNamespace(id='project')
    pipeline.scripts = {script.id: script}
    pipeline._find_asset_with_source = lambda *_: (character, script)
    pipeline._save_after_asset_mutation = lambda *_: None
    design = {
        'identity': {'features': {'face_shape': '圆脸'}, 'editor_mode': 'fields'},
        'look': {'features': {'clothing': '素黑劲装'}, 'editor_mode': 'fields'},
        'design_input': {
            'schema_version': 'iframe.character-design-input.v1',
            'prompt': '原始面板 Prompt',
            'identity': {'features': {'face_shape': '圆脸'}, 'editor_mode': 'fields', 'basis': ['user_specified']},
            'look': {'features': {'clothing': '素黑劲装'}, 'editor_mode': 'fields', 'basis': ['user_specified']},
            'supplemental_prompt': '用户补充', 'dictionary_configurations': [],
            'constraints': {'must_keep': ['圆脸'], 'negative_prompt': []},
        },
        'design_result': {
            'schema_version': 'iframe.character-design-result.v1',
            'prompt': 'AI 生成并手改的设计',
            'identity': {'visual_notes': '清晰面容', 'features': {}, 'editor_mode': 'notes', 'basis': ['user_specified']},
            'look': {'visual_notes': '黑色外套', 'features': {}, 'editor_mode': 'notes', 'basis': ['creative_choice']},
            'source': 'user-edited', 'skill_revision': 'sha256:test',
        },
        'confirmed': True,
        'active_design_source': 'panel',
    }
    pipeline.update_asset_attributes('project', 'character', 'character', {'character_design': design})
    saved = character.character_design['design_draft']
    assert saved['design_input']['prompt'] == '原始面板 Prompt'
    assert saved['design_input']['identity']['features'] == {'face_shape': '圆脸'}
    assert saved['design_result']['prompt'] == 'AI 生成并手改的设计'
    assert saved['active_design_source'] == 'panel'
    assert character.character_design['design_revisions'][0]['design']['active_design_source'] == 'panel'
    assert character.character_design['design_revisions'][0]['design']['design_input'] == saved['design_input']
    assert character.character_design['design_revisions'][0]['design']['design_result'] == saved['design_result']

    invalid_snapshots = (
        {'active_design_source': 'automatic'},
        {'design_input': {**design['design_input'], 'identity': {'features': {'camera_angle': '俯拍'}}}},
        {'design_input': {**design['design_input'], 'constraints': {'negative_prompt': ['x' * 501]}}},
        {'design_result': {**design['design_result'], 'source': 'unknown'}},
        {'design_result': {**design['design_result'], 'prompt': 'x' * 20001}},
        {'design_result': None},
        {'design_input': {key: value for key, value in design['design_input'].items() if key != 'schema_version'}},
    )
    for invalid in invalid_snapshots:
        with pytest.raises(ValueError):
            pipeline.update_asset_attributes('project', 'character', 'character', {
                'character_design': {**design, **invalid},
            })
    assert len(character.character_design['design_revisions']) == 1
