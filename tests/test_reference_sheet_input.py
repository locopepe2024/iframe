from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import AssetUnit, Character, ImageAsset, ImageVariant


@pytest.mark.parametrize("reference", ["users/owner/ref.png", "https://example.test/ref.png"])
def test_selected_reference_reaches_every_candidate(tmp_path, monkeypatch, reference):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    monkeypatch.setattr("src.apps.comic_gen.assets.time.sleep", lambda _: None)
    character = Character(id="c", name="Test", description="Test", reference_sheet=AssetUnit(
        image_variants=[ImageVariant(id="old", url="old.png"), ImageVariant(id="chosen", url=reference)],
        selected_image_id="chosen"))
    generator.generate_character(character, generation_type="reference_sheet", model_name="uniart/gpt-image-2", batch_size=2)
    expected = reference if reference.startswith("https:") else "output/" + reference
    assert model.generate.call_count == 2
    assert all(call.kwargs.get("ref_image_path") == expected for call in model.generate.call_args_list)


def test_selected_reference_is_bound_to_character_identity_in_prompt(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    character = Character(id="c", name="Test", description="Test")

    generator.generate_character(
        character,
        generation_type="reference_sheet",
        prompt="角色设定参考图。构图：左侧头像，右侧正侧背全身视图。",
        positive_prompt="写实电影质感",
        model_name="uniart/gpt-image-2",
        reference_image_url="https://example.test/reference.png",
        batch_size=1,
    )

    sent_prompt = model.generate.call_args.args[0]
    assert sent_prompt.startswith("以输入的参考图作为角色身份依据")
    assert "严格保持其脸型、五官、发型、肤色、服装和体态特征" in sent_prompt
    assert "仅按后续要求调整构图、视角、姿势和背景" in sent_prompt
    assert "构图：左侧头像，右侧正侧背全身视图" in sent_prompt
    assert sent_prompt.endswith("写实电影质感")


def test_text_only_reference_sheet_does_not_claim_an_input_reference(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    character = Character(id="c", name="Test", description="Test")

    generator.generate_character(
        character,
        generation_type="reference_sheet",
        prompt="角色设定参考图。",
        model_name="uniart/gpt-image-2",
        use_reference_image=False,
    )

    assert "以输入的参考图作为角色身份依据" not in model.generate.call_args.args[0]


def test_missing_selected_reference_does_not_silently_generate_text_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    generator._get_model_for = Mock()
    character = Character(id="c", name="Test", description="Test", reference_sheet=AssetUnit(
        image_variants=[ImageVariant(id="one", url="one.png")], selected_image_id="missing"))
    with pytest.raises(ValueError, match="Selected reference"):
        generator.generate_character(character, generation_type="reference_sheet", model_name="uniart/gpt-image-2")
    generator._get_model_for.assert_not_called()


def test_unselected_uploaded_reference_is_not_sent_when_generation_opts_out(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    monkeypatch.setattr("src.apps.comic_gen.assets.time.sleep", lambda _: None)
    character = Character(
        id="c",
        name="Test",
        description="Test",
        image_url="uploaded.png",
        reference_sheet=AssetUnit(
            image_variants=[ImageVariant(id="chosen", url="uploaded.png")],
            selected_image_id="chosen",
        ),
    )

    generator.generate_character(
        character,
        generation_type="reference_sheet",
        model_name="uniart/gpt-image-2.5-flare-discount",
        use_reference_image=False,
    )

    assert model.generate.call_count == 1
    assert model.generate.call_args.kwargs.get("ref_image_path") is None


def test_text_mode_does_not_attach_uploaded_character_reference_implicitly(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = "output/assets"
    model = Mock()
    generator._get_model_for = Mock(return_value=model)
    character = Character(
        id="c",
        name="Test",
        description="Test",
        three_view_asset=ImageAsset(
            variants=[ImageVariant(id="upload", url="uploaded.png", is_uploaded_source=True)]
        ),
    )

    generator.generate_character(
        character,
        generation_type="full_body",
        model_name="gpt-image-2",
        use_reference_image=False,
        image_generation_mode="text",
    )

    assert model.generate.call_count == 1
    assert model.generate.call_args.kwargs.get("ref_image_path") is None
    assert model.generate.call_args.kwargs.get("ref_image_paths") == []


@pytest.mark.parametrize('prefix', ['comic_gen', 'lumenx'])
@pytest.mark.parametrize('signed', [True, False])
def test_stored_reference_reaches_real_uniart_edit_adapter(tmp_path, monkeypatch, prefix, signed):
    import base64
    from src.models import uniart
    from src.utils import oss_utils
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('OSS_BASE_PATH', 'comic_gen')
    monkeypatch.setenv('LUMENX_COS_KEY_PREFIX', 'lumenx')
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: prefix == 'lumenx')
    key = f'{prefix}/assets/characters/chosen.png'
    url = 'https://storage.example/chosen.png?signature=test'
    storage = Mock(is_configured=True)
    storage.sign_url_for_api.return_value = url if signed else ''
    storage.upload_file.return_value = None
    monkeypatch.setattr(oss_utils, 'OSSImageUploader', lambda: storage)
    generator = AssetGenerator.__new__(AssetGenerator)
    generator.output_dir = 'output/assets'
    monkeypatch.setattr('src.apps.comic_gen.assets.studio_uniart_config', lambda: {})
    monkeypatch.setattr('src.apps.comic_gen.assets.time.sleep', lambda _: None)
    character = Character(id='c', name='Test', description='Test', image_url='old.png',
        reference_sheet=AssetUnit(image_variants=[ImageVariant(id='chosen', url=key)], selected_image_id='chosen'))
    def post(config, endpoint, body):
        assert endpoint == '/images/edits'
        assert body['images'] == [url]
        assert body['prompt'].startswith('以输入的参考图作为角色身份依据')
        return {'data': [{'b64_json': base64.b64encode(b'generated').decode()}]}
    submit = Mock(side_effect=post)
    monkeypatch.setattr(uniart, '_post', submit)
    if not signed:
        with pytest.raises(RuntimeError, match='Could not create image edit material URL'):
            generator.generate_character(character, generation_type='reference_sheet', model_name='uniart/gpt-image-2')
        submit.assert_not_called()
        storage.upload_file.assert_not_called()
    else:
        generator.generate_character(character, generation_type='reference_sheet', model_name='uniart/gpt-image-2', batch_size=2)
        assert submit.call_count == 2
        assert len(character.reference_sheet.image_variants) == 3
        assert character.reference_sheet.selected_image_id == 'chosen'
    assert all(call.args == (key,) for call in storage.sign_url_for_api.call_args_list)
