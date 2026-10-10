from threading import RLock
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import (
    ArtDirection, Character, DirectorProfile, DirectorProfileRevision,
    DirectorShootingPlan, DirectorShootingPlanRevision,
    DirectorStoryMap, Prop, Scene, Script, Series, StoryboardFrame,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline, LibraryAssetInUseError


def make_pipeline():
    series = Series(id="series", title="Series", characters=[Character(id="shared", name="Lead", description="Lead")],
                    episode_ids=["episode"], created_at=1, updated_at=1)
    episode = Script(id="episode", title="Episode", original_text="", series_id="series",
                     created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline._save_series_data_unlocked = Mock()
    pipeline.series_store = {series.id: series}
    pipeline.scripts = {episode.id: episode}
    return pipeline, series, episode


def test_delete_unreferenced_series_character():
    pipeline, series, _ = make_pipeline()
    pipeline.delete_series_asset(series.id, "character", "shared")
    assert series.characters == []
    pipeline._save_series_data_unlocked.assert_called_once()


def test_delete_referenced_series_character_is_rejected():
    pipeline, series, episode = make_pipeline()
    episode.frames.append(StoryboardFrame(id="frame", scene_id="scene", character_ids=["shared"],
                                          action_description="Lead enters"))
    with pytest.raises(LibraryAssetInUseError):
        pipeline.delete_series_asset(series.id, "character", "shared")
    assert len(series.characters) == 1
    pipeline._save_series_data_unlocked.assert_not_called()


def test_force_delete_removes_episode_references():
    pipeline, series, episode = make_pipeline()
    pipeline._save_data = Mock()
    episode.frames.append(StoryboardFrame(id="frame", scene_id="scene", character_ids=["shared"],
                                          action_description="Lead enters"))
    pipeline.delete_series_asset(series.id, "character", "shared", force=True)
    assert series.characters == []
    assert episode.frames[0].character_ids == []
    pipeline._save_data.assert_called_once()


def test_force_delete_clears_explicit_person_binding_without_changing_plan_history():
    pipeline, series, episode = make_pipeline()
    pipeline._save_data = Mock()
    episode.episode_person_asset_bindings = {"person": "shared"}
    plan = DirectorShootingPlan.model_validate({
        "source_revision": 1, "director_profile_revision": 1,
        "director_profile_hash": "profile", "effective_style_hash": "style",
        "scenes": [{"scene_id": "scene", "order": 0,
                    "beats": [{"beat_id": "beat", "order": 0,
                               "shots": [{"shot_id": "shot", "order": 0,
                                          "cast_bindings": [{"person_id": "person"}]}]}]}],
    })
    episode.director_shooting_plan_revisions = [
        DirectorShootingPlanRevision(revision=1, content_hash="plan", plan=plan, confirmed_at=1)]

    with pytest.raises(LibraryAssetInUseError):
        pipeline.delete_series_asset(series.id, "character", "shared")
    pipeline.delete_series_asset(series.id, "character", "shared", force=True)

    assert episode.episode_person_asset_bindings == {}
    assert episode.director_shooting_plan_revisions[0].plan == plan
    assert series.characters == []
    pipeline._save_data.assert_called_once()


def test_confirmed_shooting_plan_references_require_force_and_survive_deletion():
    pipeline, series, episode = make_pipeline()
    series.scenes.append(Scene(id="scene-shared", name="Room", description="Room"))
    series.props.append(Prop(id="prop-shared", name="Key", description="Key"))
    plan = DirectorShootingPlan.model_validate({
        "source_revision": 1, "director_profile_revision": 1,
        "director_profile_hash": "profile", "effective_style_hash": "style",
        "scenes": [{
            "scene_id": "plan-scene", "order": 0,
            "scene_asset_id": "scene-shared", "prop_ids": ["prop-shared"],
            "beats": [{"beat_id": "beat", "order": 0, "shots": [{
                "shot_id": "plan-shot", "order": 0, "character_ids": ["shared"],
                "cast_bindings": [{"person_id": "shared"}],
                "scene_binding": {"scene_asset_id": "scene-shared"},
                "prop_bindings": [{"prop_id": "prop-shared"}],
            }]}],
        }],
    })
    episode.director_shooting_plan_revisions = [
        DirectorShootingPlanRevision(revision=3, content_hash="old", plan=plan, confirmed_at=1),
        DirectorShootingPlanRevision(revision=4, content_hash="new", plan=plan.model_copy(update={"scenes": []}), confirmed_at=2),
    ]
    original_plan = plan.model_copy(deep=True)

    for asset_type, asset_id in (("character", "shared"), ("scene", "scene-shared"), ("prop", "prop-shared")):
        with pytest.raises(LibraryAssetInUseError) as exc_info:
            pipeline.delete_series_asset(series.id, asset_type, asset_id)
        assert any(ref.get("revision") == 3 for ref in exc_info.value.references)

    pipeline._save_data = Mock()
    for asset_type, asset_id in (("character", "shared"), ("scene", "scene-shared"), ("prop", "prop-shared")):
        pipeline.delete_series_asset(series.id, asset_type, asset_id, force=True)

    assert series.characters == []
    assert series.scenes == []
    assert series.props == []
    assert episode.director_shooting_plan_revisions[0].plan == original_plan
    assert pipeline._save_series_data_unlocked.call_count == 3


def test_cast_person_id_collision_does_not_reference_unrelated_character_asset():
    pipeline, series, episode = make_pipeline()
    series.characters.append(Character(id="visual", name="Visual", description="Visual"))
    episode.art_direction = ArtDirection(
        selected_style_id="test", style_config={},
        director_profile=DirectorProfile(
            revision=1, content_hash="profile",
            story_map=DirectorStoryMap(
                source_revision=1, source_revision_id="source-r1:test",
                people=[{"person_id": "shared", "display_name": "Lead",
                         "variant_character_ids": ["visual"]}],
            ),
        ),
    )
    plan = DirectorShootingPlan.model_validate({
        "source_revision": 1, "director_profile_revision": 1,
        "director_profile_hash": "profile", "effective_style_hash": "style",
        "scenes": [{"scene_id": "plan-scene", "order": 0,
                    "beats": [{"beat_id": "beat", "order": 0,
                               "shots": [{"shot_id": "shot", "order": 0,
                                          "cast_bindings": [{"person_id": "shared"}]}]}]}],
    })
    episode.director_shooting_plan_revisions = [
        DirectorShootingPlanRevision(revision=1, content_hash="plan", plan=plan, confirmed_at=1)]
    historical_profile = episode.art_direction.director_profile
    episode.director_profile_revisions = [DirectorProfileRevision(
        revision=1, content_hash="profile", profile=historical_profile.model_copy(deep=True),
        confirmed_at=1)]
    episode.art_direction.director_profile = DirectorProfile(
        revision=2, content_hash="current",
        story_map=DirectorStoryMap(
            source_revision=1, source_revision_id="source-r1:test",
            people=[{"person_id": "shared", "display_name": "Lead",
                     "variant_character_ids": ["shared"]}],
        ),
    )

    with pytest.raises(LibraryAssetInUseError):
        pipeline.delete_series_asset(series.id, "character", "visual")
    pipeline.delete_series_asset(series.id, "character", "shared")
    assert [character.id for character in series.characters] == ["visual"]
