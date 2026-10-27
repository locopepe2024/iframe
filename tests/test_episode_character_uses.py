"""A reviewed project anchor and an episode look can serve different shots."""

from threading import RLock
from pathlib import Path
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import AssetUnit, Character, GlobalAssetLibrary, ImageVariant, Script, Series, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.storyboard import StoryboardGenerator


def make_pipeline():
    hero = Character(
        id="hero", name="Hero", description="Base look",
        character_design={"design_revisions": [{"revision": 1, "design": {"identity": {}}}]},
        reference_sheet=AssetUnit(image_variants=[
            ImageVariant(id="normal", url="normal.webp", media_id="media-normal"),
        ]),
    )
    injured = Character(
        id="hero-injured", name="Hero injured", description="Injured look",
        base_character_id="hero",
        reference_sheet=AssetUnit(image_variants=[
            ImageVariant(id="injured", url="injured.webp", media_id="media-injured"),
        ]),
    )
    series = Series(
        id="series", title="Series", owner_profile_id="owner", characters=[hero],
        created_at=0, updated_at=0,
    )
    script = Script(
        id="episode", title="Episode", original_text="text", owner_profile_id="owner",
        series_id="series", characters=[injured],
        frames=[
            StoryboardFrame(id="before", scene_id="", character_ids=["hero"]),
            StoryboardFrame(id="after", scene_id="", character_ids=["hero"]),
        ], created_at=0, updated_at=0,
    )
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._save_lock = RLock()
    pipeline._save_data = lambda: None
    pipeline._save_after_asset_mutation = lambda source: None
    first = pipeline.get_project_character_asset_pack("episode", "hero")
    pipeline.confirm_project_character_anchor(
        "episode", "hero", "normal", first["asset_revision"], 0, True)
    return pipeline, script


def test_two_reviewed_looks_select_distinct_shot_media_and_pins():
    pipeline, script = make_pipeline()
    normal = pipeline.confirm_episode_character_use(
        "episode", "hero", "normal", "Normal", "", "hero", "normal", 1, True)
    injured = pipeline.confirm_episode_character_use(
        "episode", "hero", "injured", "Injured", "wound visible",
        "hero-injured", "injured", 1, True)

    preview_before = pipeline.storyboard_render_context_token("episode", "before")
    pipeline.select_frame_character_use("episode", "before", "hero", normal.use_id, 1)
    pipeline.select_frame_character_use("episode", "after", "hero", injured.use_id, 1)
    assert pipeline.storyboard_render_context_token("episode", "before") != preview_before

    before, after = script.frames
    assert before.character_ids == ["hero"]
    assert after.character_ids == ["hero-injured"]
    assert before.character_use_ids == {"hero": normal.use_id}
    assert after.character_use_ids == {"hero": injured.use_id}
    assert pipeline.resolve_storyboard_asset_selection("episode", "before")["assets"][0]["variant_id"] == "normal"
    assert pipeline.resolve_storyboard_asset_selection("episode", "after")["assets"][0]["variant_id"] == "injured"
    assert pipeline._pin_frame_assets(script, before)[0].source_scope == "series"
    after_pin = pipeline._pin_frame_assets(script, after)[0]
    assert (after_pin.source_scope, after_pin.variant_id, after_pin.media_id) == (
        "project", "injured", "media-injured")
    assert injured.source_anchor_variant_id == "normal"
    assert injured.selected_source_scope == "episode"

    # Later asset edits cannot rewrite the reviewed look's pin.
    script.characters[0].description = "Updated asset description"
    from src.apps.comic_gen.asset_revisions import commit_asset_revision
    commit_asset_revision(script.characters[0], "user_confirmed")
    assert pipeline._pin_frame_assets(script, after)[0].revision == injured.selected_asset_revision
    with pytest.raises(ValueError, match="confirmed episode look"):
        pipeline.update_frame_workbench(
            "episode", "after", workbench_reference_variant_ids={"hero-injured": ["other"]})
    with pytest.raises(ValueError, match="confirmed episode look"):
        pipeline.delete_asset_variant("episode", "hero-injured", "character", "injured")
    with pytest.raises(ValueError, match="confirmed episode look"):
        pipeline.confirm_asset_revision(
            "episode", "hero-injured", "character", script.characters[0].asset_revision,
            active_variant_ids=[])


def test_episode_look_confirmation_rejects_wrong_owner_revision_and_unreviewed_media():
    pipeline, script = make_pipeline()
    with pytest.raises(ValueError, match="Review"):
        pipeline.confirm_episode_character_use(
            "episode", "hero", "draft", "Draft", "", "hero", "normal", 1, False)
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.confirm_episode_character_use(
            "episode", "hero", "stale", "Stale", "", "hero", "normal", 2, True)
    other = Character(id="other", name="Other", description="Other", base_character_id="other",
                      reference_sheet=AssetUnit(image_variants=[ImageVariant(id="other-v", url="other.webp")]))
    script.characters.append(other)
    with pytest.raises(ValueError, match="same project character"):
        pipeline.confirm_episode_character_use(
            "episode", "hero", "other", "Other", "", "other", "other-v", 1, True)


def test_shot_selection_rejects_use_from_another_episode_and_invalidates_old_confirmation():
    pipeline, script = make_pipeline()
    use = pipeline.confirm_episode_character_use(
        "episode", "hero", "normal", "Normal", "", "hero", "normal", 1, True)
    frame = script.frames[0]
    frame.reference_package.confirmed = True
    frame.reference_package.asset_revision_pins = pipeline._pin_frame_assets(script, frame)
    old_revision = frame.reference_package.revision
    with pytest.raises(ValueError, match="not available in this episode"):
        pipeline.select_frame_character_use("episode", "before", "hero", "other-episode-use", old_revision)
    assert frame.reference_package.confirmed

    pipeline.select_frame_character_use("episode", "before", "hero", use.use_id, old_revision)
    assert not frame.reference_package.confirmed
    assert frame.reference_package.asset_revision_pins == []
    assert frame.reference_package.revision == old_revision + 1
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.select_frame_character_use("episode", "before", "hero", use.use_id, old_revision)


def test_direct_character_change_clears_former_use_binding():
    pipeline, script = make_pipeline()
    use = pipeline.confirm_episode_character_use(
        "episode", "hero", "injured", "Injured", "", "hero-injured", "injured", 1, True)
    pipeline.select_frame_character_use("episode", "after", "hero", use.use_id, 1)
    pipeline.update_frame("episode", "after", character_ids=["hero"])
    assert script.frames[1].character_use_ids == {}
    assert "hero-injured" not in script.frames[1].workbench_reference_variant_ids


def test_confirmed_look_blocks_whole_character_deletion():
    pipeline, _ = make_pipeline()
    pipeline.confirm_episode_character_use(
        "episode", "hero", "injured", "Injured", "wound visible",
        "hero-injured", "injured", 1, True)
    with pytest.raises(ValueError, match="confirmed episode look"):
        pipeline.delete_character("episode", "hero-injured")
    with pytest.raises(ValueError, match="confirmed episode look"):
        pipeline.delete_series_asset("series", "character", "hero", owner_profile_id="owner", force=True)


def test_first_frame_generator_uses_exact_selected_episode_look(tmp_path):
    pipeline, script = make_pipeline()
    use = pipeline.confirm_episode_character_use(
        "episode", "hero", "injured", "Injured", "", "hero-injured", "injured", 1, True)
    frame = pipeline.select_frame_character_use("episode", "after", "hero", use.use_id, 1)
    (tmp_path / "injured.webp").write_bytes(b"reference")
    generator = StoryboardGenerator(output_root=tmp_path)
    model = Mock()
    model.generate.side_effect = lambda prompt, output_path, **kwargs: Path(output_path).write_bytes(b"image")
    generator._get_model_for = lambda model_name: model

    generator.generate_frame(
        frame, pipeline.resolve_project_assets(script)["characters"], None,
        prompt="Visible reviewed prompt", preserve_prompt=True,
        output_dir=str(tmp_path / "storyboard"),
    )

    assert model.generate.call_args.kwargs["ref_image_paths"] == [str(tmp_path / "injured.webp")]
    assert model.generate.call_args.args[0] == "Visible reviewed prompt"


def test_explicit_storyboard_references_cannot_omit_reviewed_look(tmp_path):
    pipeline, script = make_pipeline()
    pipeline.output_root = str(tmp_path)
    use = pipeline.confirm_episode_character_use(
        "episode", "hero", "injured", "Injured", "wound visible",
        "hero-injured", "injured", 1, True)
    pipeline.select_frame_character_use("episode", "after", "hero", use.use_id, 1)
    with pytest.raises(ValueError, match="omit the selected episode character look"):
        pipeline.generate_storyboard_render(
            "episode", "after", {"reference_image_urls": ["old-look.webp"]}, "Reviewed prompt",
            prompt_is_complete=True,
        )
    with pytest.raises(ValueError, match="mix another look"):
        pipeline.generate_storyboard_render(
            "episode", "after", {"reference_image_urls": ["injured.webp", "normal.webp"]},
            "Reviewed prompt", prompt_is_complete=True,
        )
    assert script.frames[1].status.value != "processing"


def test_episode_use_api_is_owner_scoped(monkeypatch):
    from fastapi.testclient import TestClient
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    pipeline, _ = make_pipeline()
    monkeypatch.setattr(api, "pipeline", pipeline)
    owner = UserContext("owner", "owner", "Owner", "")
    foreign = UserContext("foreign", "foreign", "Foreign", "")
    monkeypatch.setattr(api, "_resolve_request_context", lambda *_args: (owner, False))
    api.app.dependency_overrides[require_studio_user] = lambda: owner
    try:
        with TestClient(api.app) as client:
            created = client.post("/projects/episode/characters/hero/episode-uses", json={
                "label": "Normal", "condition": "", "selected_asset_id": "hero",
                "selected_variant_id": "normal", "expected_pack_revision": 1,
                "reviewed": True,
            })
            assert created.status_code == 200, created.text
            assert len(client.get("/projects/episode/character-uses").json()["uses"]) == 1
            api.app.dependency_overrides[require_studio_user] = lambda: foreign
            assert client.get("/projects/episode/character-uses").status_code == 404
            assert client.post("/projects/episode/frames/before/character-use", json={
                "project_character_id": "hero", "use_id": created.json()["use_id"],
                "expected_reference_revision": 1,
            }).status_code == 404
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)
