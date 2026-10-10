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
