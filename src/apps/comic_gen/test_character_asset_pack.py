"""Project character anchors are explicit, versioned, and owner-scoped."""

import os
import sys
import threading

import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from src.apps.comic_gen.models import AssetUnit, Character, ImageVariant, Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _character(variant_id: str = "front") -> Character:
    return Character(
        id="hero", name="Hero", description="Hero",
        character_design={"design_revisions": [{"revision": 1, "design": {"identity": {}}}]},
        reference_sheet=AssetUnit(image_variants=[
            ImageVariant(id=variant_id, url=f"{variant_id}.webp", media_id=f"media-{variant_id}"),
        ]),
    )


def _pipeline(script: Script, series: Series | None = None) -> ComicGenPipeline:
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series} if series else {}
    pipeline._save_lock = threading.RLock()
    pipeline._save_after_asset_mutation = lambda source: None
    return pipeline


def _script(*, series_id: str | None = None, characters=None) -> Script:
    return Script(
        id="episode", title="Episode", original_text="text", series_id=series_id,
        owner_profile_id="owner", characters=characters or [], created_at=0, updated_at=0,
    )


def test_anchor_requires_review_and_preserves_versions():
    character = _character()
    pipeline = _pipeline(_script(characters=[character]))
    first = pipeline.get_project_character_asset_pack("episode", "hero")
    assert first["pack"] is None
    with pytest.raises(ValueError, match="front full-body"):
        pipeline.confirm_project_character_anchor(
            "episode", "hero", "front", first["asset_revision"], 0, False,
        )
    confirmed = pipeline.confirm_project_character_anchor(
        "episode", "hero", "front", first["asset_revision"], 0, True,
    )
    assert confirmed["pack"]["current_revision"] == 1
    assert confirmed["pack"]["revisions"][0]["source_design_revision"] == 1
    assert confirmed["pack"]["revisions"][0]["media_id"] == "media-front"
    assert character.reference_sheet.image_variants[0].is_favorited
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.confirm_project_character_anchor("episode", "hero", "front", first["asset_revision"], 0, True)

    character.reference_sheet.image_variants.append(
        ImageVariant(id="front-v2", url="front-v2.webp", media_id="media-front-v2"),
    )
    latest = pipeline.get_project_character_asset_pack("episode", "hero")
    replaced = pipeline.confirm_project_character_anchor(
        "episode", "hero", "front-v2", latest["asset_revision"], 1, True,
    )
    assert [item["variant_id"] for item in replaced["pack"]["revisions"]] == ["front", "front-v2"]
    reloaded = Character.model_validate(character.model_dump())
    assert reloaded.asset_pack and reloaded.asset_pack.current_revision == 2
    with pytest.raises(ValueError, match="cannot be deleted"):
        pipeline.delete_asset_variant("episode", "hero", "character", "front")
    with pytest.raises(ValueError, match="cannot be removed"):
        pipeline.confirm_asset_revision(
            "episode", "hero", "character", replaced["asset_revision"], ["front-v2"], "front-v2",
        )
    with pytest.raises(ValueError, match="reviewed anchor operations"):
        pipeline.update_asset_attributes("episode", "hero", "character", {"asset_pack": None})
    with pytest.raises(ValueError, match="changes confirmed character anchors"):
        pipeline.restore_asset_revision(
            "episode", "hero", "character", first["asset_revision"], replaced["asset_revision"],
        )


def test_series_project_pack_uses_series_character_not_episode_override():
    shared = _character("series-front")
    local = _character("episode-front")
    series = Series(
        id="series", title="Series", owner_profile_id="owner", characters=[shared],
        created_at=0, updated_at=0,
    )
    pipeline = _pipeline(_script(series_id="series", characters=[local]), series)
    current = pipeline.get_project_character_asset_pack("episode", "hero")
    assert current["source_scope"] == "series"
    assert current["source_container_id"] == "series"
    with pytest.raises(ValueError, match="reference sheet"):
        pipeline.confirm_project_character_anchor(
            "episode", "hero", "episode-front", current["asset_revision"], 0, True,
        )
    result = pipeline.confirm_project_character_anchor(
        "episode", "hero", "series-front", current["asset_revision"], 0, True,
    )
    assert result["pack"]["revisions"][0]["variant_id"] == "series-front"
    assert local.asset_pack is None


def test_anchor_rejects_unconfirmed_design_and_unowned_asset():
    character = _character()
    character.character_design = {}
    pipeline = _pipeline(_script(characters=[character]))
    current = pipeline.get_project_character_asset_pack("episode", "hero")
    with pytest.raises(ValueError, match="visual design"):
        pipeline.confirm_project_character_anchor(
            "episode", "hero", "front", current["asset_revision"], 0, True,
        )
    with pytest.raises(ValueError, match="Project character not found"):
        pipeline.get_project_character_asset_pack("episode", "other")
