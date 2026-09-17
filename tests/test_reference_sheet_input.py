from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import AssetUnit, Character, ImageVariant


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
