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
    assert not character.reference_sheet.image_variants[0].is_favorited
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
    pipeline.delete_asset_variant("episode", "hero", "character", "front")
    assert [item.id for item in character.reference_sheet.image_variants] == ["front-v2"]
    assert character.asset_pack.revisions[0].variant_id == "front"
    with pytest.raises(ValueError, match="cannot be removed"):
        pipeline.confirm_asset_revision(
            "episode", "hero", "character", character.asset_revision, [], None,
        )
    with pytest.raises(ValueError, match="reviewed anchor operations"):
        pipeline.update_asset_attributes("episode", "hero", "character", {"asset_pack": None})
    with pytest.raises(ValueError, match="changes confirmed character anchors"):
        pipeline.restore_asset_revision(
            "episode", "hero", "character", first["asset_revision"], character.asset_revision,
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


def test_anchor_favorite_can_be_cancelled_without_changing_reference_or_cover():
    character = _character()
    pipeline = _pipeline(_script(characters=[character]))
    current = pipeline.get_project_character_asset_pack("episode", "hero")
    pipeline.confirm_project_character_anchor("episode", "hero", "front", current["asset_revision"], 0, True)
    pipeline.set_asset_cover_variant("episode", "hero", "character", "front")
    pipeline.toggle_variant_favorite("episode", "hero", "character", "front", True)
    pipeline.toggle_variant_favorite("episode", "hero", "character", "front", False)
    assert not character.reference_sheet.image_variants[0].is_favorited
    assert character.cover_variant_id == "front"
    assert character.asset_pack.revisions[0].variant_id == "front"
    with pytest.raises(ValueError, match="不能删除"):
        pipeline.delete_asset_variant("episode", "hero", "character", "front")


def test_series_character_favorite_persists_to_series_owner():
    character = _character()
    series = Series(id="series", title="Series", owner_profile_id="owner", characters=[character], created_at=0, updated_at=0)
    pipeline = _pipeline(_script(series_id="series"), series)
    saved = []
    pipeline._save_after_asset_mutation = saved.append
    pipeline.toggle_variant_favorite("episode", "hero", "character", "front", True, "reference_sheet")
    assert character.reference_sheet.image_variants[0].is_favorited
    assert saved == ["series"]


def test_automatic_cleanup_retains_unfavorited_anchor_and_cover():
    from src.apps.comic_gen.assets import cleanup_old_variants
    from src.apps.comic_gen.models import ImageAsset, MAX_VARIANTS_PER_ASSET

    images = ImageAsset(variants=[
        ImageVariant(id=str(index), url=f"{index}.webp", created_at=index)
        for index in range(MAX_VARIANTS_PER_ASSET + 4)
    ])
    cleanup_old_variants(images, {"0", "1"})
    assert {"0", "1"}.issubset({item.id for item in images.variants})
    assert len(images.variants) == MAX_VARIANTS_PER_ASSET + 2
    assert all(not item.is_favorited for item in images.variants)


def test_old_anchor_used_in_another_episode_remains_protected():
    from src.apps.comic_gen.models import EpisodeCharacterUse
    character = _character()
    series = Series(id='series', title='Series', owner_profile_id='owner', characters=[character], created_at=0, updated_at=0)
    script = _script(series_id='series')
    pipeline = _pipeline(script, series)
    current = pipeline.get_project_character_asset_pack('episode', 'hero')
    pipeline.confirm_project_character_anchor('episode', 'hero', 'front', current['asset_revision'], 0, True)
    character.reference_sheet.image_variants.append(ImageVariant(id='new', url='new.webp'))
    current = pipeline.get_project_character_asset_pack('episode', 'hero')
    pipeline.confirm_project_character_anchor('episode', 'hero', 'new', current['asset_revision'], 1, True)
    other = _script(series_id='series')
    other.id = 'other'
    other.episode_character_uses = [EpisodeCharacterUse(
        use_id='look', project_character_id='hero', label='Look',
        source_pack_id='character-pack-hero', source_pack_revision=1, source_design_revision=1,
        source_anchor_variant_id='front', selected_asset_id='hero', selected_variant_id='front',
        selected_asset_revision=1, selected_source_scope='series', selected_source_container_id='series',
    )]
    pipeline.scripts[other.id] = other
    with pytest.raises(ValueError, match='剧集造型'):
        pipeline.delete_asset_variant('episode', 'hero', 'character', 'front')
    assert len(character.reference_sheet.image_variants) == 2
