from threading import RLock
from unittest.mock import Mock

from src.apps.comic_gen.models import (
    GlobalAssetLibrary,
    ImageAsset,
    ImageVariant,
    Scene,
    Script,
    ShotVisualDesignSnapshot,
    ShotVisualPreset,
    StoryboardFrame,
    StoryboardReference,
    LightingData,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.storyboard import StoryboardGenerator


def make_pipeline(tmp_path):
    source_scene = Scene(id="source-street", name="清溪镇青石板长街", description="source")
    target_scene = Scene(id="target-shop", name="粮店长街", description="target")
    script = Script(
        id="project", title="Project", original_text="",
        scenes=[source_scene, target_scene], created_at=1, updated_at=1,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    return pipeline, script, source_scene, target_scene


def context(scene_id, place, time_id, *, lighting=None):
    return {
        "scene": {
            "scene_id": scene_id,
            "place_continuity_id": place,
            "time_continuity_id": time_id,
            "location": scene_id,
        },
        "shot": {"lighting": lighting or {}, "camera_angle": "wide"},
        "shooting_plan_revision": 2,
        "shooting_plan_hash": "plan-hash",
    }


def frozen_frame_variant(variant_id, visual_design, *, media_id=None, url="output/source.webp",
                         place=None, time_id=None):
    return ImageVariant(
        id=variant_id, url=url, media_id=media_id,
        storyboard_visual_snapshot={"visual_design": visual_design,
                                    "source_scene_id": "source-street",
                                    "place_continuity_id": place,
                                    "time_continuity_id": time_id,
                                    "shooting_plan_revision": 2,
                                    "shooting_plan_hash": "plan-hash"},
    )


def test_reference_picker_previews_bind_to_exact_source_variants(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.studio_access import UserContext

    pipeline, script, source_scene, _ = make_pipeline(tmp_path)
    source_scene.image_asset = ImageAsset(variants=[
        ImageVariant(id="first", url="output/first.webp"),
        ImageVariant(id="second", url="output/second.webp"),
    ], selected_id="first")
    script.shot_visual_presets = [ShotVisualPreset(
        id="stale", name="unavailable", scene_id=source_scene.id, source_asset_id=source_scene.id,
        source_variant_id="missing",
    )]
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(pipeline, "get_script", lambda script_id, owner_id: script if owner_id == "owner" else None)
    monkeypatch.setattr(api, "_owned_media_cover_url", lambda stored, owner, size: f"/preview/{stored}")
    owner = UserContext("owner", "owner", "", "")

    response = api.list_shot_visual_presets(script.id, user=owner)
    import json
    previews = {item["source_variant_id"]: item["preview_url"] for item in json.loads(response.body)}
    assert previews["first"] == "/preview/output/first.webp"
    assert previews["second"] == "/preview/output/second.webp"
    assert previews["missing"] is None
    source_scene.image_asset.variants = [source_scene.image_asset.variants[0]]
    assert "second" not in {item["source_variant_id"] for item in json.loads(api.list_shot_visual_presets(script.id, user=owner).body)}


def test_explicit_reference_defaults_to_image_only_and_never_copies_source_prompt(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id, shot_id="source-shot",
        action_description="SOURCE ACTION MUST NOT LEAK",
        dialogue="SOURCE DIALOGUE MUST NOT LEAK",
        director_shot_context=context(
            source_scene.id, "place-a", "time-a",
            lighting={"story_time": "dusk", "daylight_phase": "blue hour", "weather": "clear",
                      "shadow_direction": "west", "key_source": "local lantern"},
        ),
        rendered_image_asset=ImageAsset(variants=[ImageVariant(
            id="source-variant", url="output/source.webp", media_id="media-source",
        )], selected_id="source-variant"),
        shot_visual_design=ShotVisualDesignSnapshot(
            visual_design={
                "lighting": {"story_time": "dusk", "daylight_phase": "blue hour", "weather": "clear",
                              "shadow_direction": "west", "key_source": "local lantern"},
                "space": {"reference_viewpoint": "northbound"},
                "camera": {"shot_size": "wide", "camera_angle": "eye level"},
                "continuity_state": {"stage": [{"ref": "source-person", "zone": "left"}]},
            },
            compiled_prompt="SOURCE COMPLETE PROMPT MUST NOT LEAK",
        ),
    )
    target = StoryboardFrame(
        id="target-frame", scene_id=target_scene.id, shot_id="target-shot",
        action_description="TARGET ACTION",
        director_shot_context=context(target_scene.id, "place-b", "time-a"),
    )
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(
        script.id, source.id, "清溪镇参考", source_variant_id="source-variant",
    )

    preview = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)
    projection = preview["projection"]
    assert projection["scope"] == "same_time_world_light"
    assert projection["suggested_fields"] == []
    assert projection["eligible_fields"] == []

    applied = pipeline.apply_shot_visual_preset(
        script.id, target.id, preset.id, "image_only", selected_fields=[],
    )
    assert applied.reference_visual_projection.selected_fields == []
    assert applied.reference_package.confirmed is True
    assert applied.reference_package.references[0].source_variant_id == "source-variant"
    assert "SOURCE COMPLETE PROMPT" not in (applied.shot_visual_design.compiled_prompt or "")


def test_confirmed_subset_projects_only_world_light_and_keeps_provenance(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id, shot_id="source-shot",
        director_shot_context=context(
            source_scene.id, "place-a", "time-a",
            lighting={"story_time": "dusk", "daylight_phase": "blue hour", "weather": "clear",
                      "shadow_direction": "west", "key_source": "lantern"},
        ),
        rendered_image_asset=ImageAsset(variants=[frozen_frame_variant("source-variant", {
            "lighting": {"story_time": "dusk", "daylight_phase": "blue hour", "weather": "clear",
                         "shadow_direction": "west", "key_source": "lantern"},
            "space": {"reference_viewpoint": "northbound"},
            "camera": {"shot_size": "wide"},
        }, media_id="media-source", place="place-a", time_id="time-a")], selected_id="source-variant"),
        shot_visual_design=ShotVisualDesignSnapshot(
            visual_design={
                "lighting": {"story_time": "dusk", "daylight_phase": "blue hour", "weather": "clear",
                              "shadow_direction": "west", "key_source": "lantern"},
                "space": {"reference_viewpoint": "northbound"},
                "camera": {"shot_size": "wide"},
            },
        ),
    )
    target = StoryboardFrame(
        id="target-frame", scene_id=target_scene.id, shot_id="target-shot",
        director_shot_context=context(target_scene.id, "place-b", "time-a"),
    )
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "参考", source_variant_id="source-variant")
    applied = pipeline.apply_shot_visual_preset(
        script.id, target.id, preset.id, "image_and_context", selected_fields=["lighting"],
    )
    snapshot = applied.reference_visual_projection
    assert snapshot is not None
    assert snapshot.selected_fields == ["lighting"]
    assert set(snapshot.visual_design["lighting"]) == {"story_time", "daylight_phase", "weather", "shadow_direction"}
    assert snapshot.source_variant_id == "source-variant"
    assert snapshot.source_media_id == "media-source"
    assert snapshot.source_frame_id == "source-frame"
    assert applied.reference_package.references[0].media_id == "media-source"

    prompt = pipeline.preview_storyboard_render_prompt(
        script.id, target.id, "TARGET PROMPT ONLY",
    )
    candidate_prompt = pipeline.preview_storyboard_candidate_prompt(
        script.id, target.id, "TARGET PROMPT ONLY",
    )
    assert candidate_prompt == prompt
    assert "参考结构化光影" in prompt
    assert "lantern" not in prompt
    assert "SOURCE ACTION" not in prompt
    assert "SOURCE DIALOGUE" not in prompt


def test_missing_continuity_ids_do_not_suggest_fields(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id,
        rendered_image_asset=ImageAsset(variants=[frozen_frame_variant("source-variant", {
            "lighting": {"key_source": "soft"}, "space": {"location": "street"},
        })], selected_id="source-variant"),
        shot_visual_design=ShotVisualDesignSnapshot(
            visual_design={"lighting": {"key_source": "soft"}, "space": {"location": "street"}},
        ),
    )
    target = StoryboardFrame(id="target-frame", scene_id=target_scene.id)
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "参考", source_variant_id="source-variant")
    projection = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert projection["scope"] == "unresolved"
    assert projection["suggested_fields"] == []
    assert projection["eligible_fields"] == ["lighting", "space"]


def test_changed_source_variant_invalidates_render_preview(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source_scene.image_asset.variants = [ImageVariant(
        id="source-variant", url="output/source.webp", media_id="media-v1",
        submission_snapshot={"positive_prompt": "safe", "visual_design": {"lighting": {"key_source": "soft"}},
                             "selected_model_id": "m", "aspect_ratio": "16:9", "generation_type": "all",
                             "image_generation_mode": "text"},
    )]
    source_scene.image_asset.selected_id = "source-variant"
    source = StoryboardFrame(id="source-frame", scene_id=source_scene.id)
    target = StoryboardFrame(
        id="target-frame", scene_id=target_scene.id,
        director_shot_context=context(target_scene.id, "place-b", "time-a"),
    )
    script.frames = [source, target]
    preset = pipeline.list_shot_visual_presets(script.id)[0]
    pipeline.apply_shot_visual_preset(script.id, target.id, preset.id, "image_and_context", ["lighting"])
    source_scene.image_asset.variants[0].media_id = "media-v2"
    try:
        pipeline.preview_storyboard_render_prompt(script.id, target.id, "target")
    except ValueError as exc:
        assert "media changed" in str(exc)
    else:
        raise AssertionError("stale source media must invalidate render preview")


def test_same_place_subset_and_target_fields_win(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id, shot_id="source-shot",
        director_shot_context=context(source_scene.id, "same-place", "same-time",
                                      lighting={"key_source": "source lamp", "color_tone": "amber"}),
        rendered_image_asset=ImageAsset(variants=[frozen_frame_variant("source-variant", {
            "lighting": {"key_source": "source lamp", "color_tone": "amber"},
            "space": {"reference_viewpoint": "northbound"},
            "camera": {"shot_size": "wide", "camera_angle": "wide", "camera_movement": "orbit half circle"},
        }, place="same-place", time_id="same-time")], selected_id="source-variant"),
        shot_visual_design=ShotVisualDesignSnapshot(visual_design={
            "lighting": {"key_source": "source lamp", "color_tone": "amber"},
            "space": {"reference_viewpoint": "northbound"},
            "camera": {"shot_size": "wide"},
        }),
    )
    target = StoryboardFrame(
        id="target-frame", scene_id=target_scene.id, shot_id="target-shot",
        director_shot_context=context(target_scene.id, "same-place", "same-time"),
        lighting=LightingData(color_temp="cool"),
        shot_size="close-up",
    )
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "same place", source_variant_id="source-variant")
    offered = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert offered["scope"] == "same_place_time"
    assert set(offered["eligible_fields"]) >= {"lighting", "space", "camera"}
    applied = pipeline.apply_shot_visual_preset(
        script.id, target.id, preset.id, "image_and_context", ["lighting", "camera"],
    )
    prompt = pipeline.preview_storyboard_render_prompt(script.id, target.id, "target prompt")
    assert "source lamp" in prompt
    assert "amber" in prompt
    assert "参考结构化空间" not in prompt
    assert "参考结构化镜头" in prompt
    assert "shot_size：wide" not in prompt
    assert "orbit half circle" not in prompt
    assert applied.reference_visual_projection.visual_design["camera"]["camera_movement"] == "orbit half circle"
    assert applied.reference_visual_projection.selected_fields == ["lighting", "camera"]


def test_scene_variant_uses_its_submission_design_after_scene_design_changes(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source_scene.asset_design = {"design_revisions": [{"revision": 2, "design": {
        "lighting": {"key_source": "new lamp"},
    }}]}
    source_scene.image_asset.variants = [ImageVariant(
        id="source-variant", url="output/source.webp", media_id="media-v1",
        submission_snapshot={
            "positive_prompt": "old image", "selected_model_id": "m", "aspect_ratio": "16:9",
            "generation_type": "all", "image_generation_mode": "text",
            "visual_design": {"lighting": {"key_source": "old lamp"}},
            "design_revision_at_submission": 1,
        },
    )]
    source_scene.image_asset.selected_id = "source-variant"
    source = StoryboardFrame(id="source-frame", scene_id=source_scene.id)
    target = StoryboardFrame(id="target-frame", scene_id=target_scene.id)
    script.frames = [source, target]
    preset = pipeline.list_shot_visual_presets(script.id)[0]
    preview = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert preview["visual_design"]["lighting"]["key_source"] == "old lamp"
    assert preview["source_scene_design_revision"] == 1
    pipeline.apply_shot_visual_preset(script.id, target.id, preset.id, "image_and_context", ["lighting"])
    assert "old lamp" in pipeline.preview_storyboard_render_prompt(script.id, target.id, "target")
    source_scene.asset_design = {"design_revisions": [{"revision": 3, "design": {
        "lighting": {"key_source": "newer lamp"},
    }}]}
    source_scene.asset_revision += 1
    assert "old lamp" in pipeline.preview_storyboard_render_prompt(script.id, target.id, "target")


def test_legacy_scene_variant_does_not_borrow_current_scene_design(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source_scene.asset_design = {"design_revisions": [{"revision": 4, "design": {
        "lighting": {"key_source": "new lamp"}, "space": {"reference_viewpoint": "new angle"},
    }}]}
    source_scene.image_asset.variants = [ImageVariant(id="legacy", url="output/old.webp")]
    source = StoryboardFrame(id="source-frame", scene_id=source_scene.id,
                             director_shot_context=context(source_scene.id, "same", "same"))
    target = StoryboardFrame(id="target-frame", scene_id=target_scene.id,
                             director_shot_context=context(target_scene.id, "same", "same"))
    script.frames = [source, target]
    preset = pipeline.list_shot_visual_presets(script.id)[0]
    projection = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert projection["source_scene_design_revision"] is None
    assert projection["source_visual_version_known"] is False
    assert projection["available_fields"] == []
    assert projection["eligible_fields"] == []
    assert all(not values for values in projection["visual_design"].values())


def test_legacy_frame_variant_does_not_borrow_current_frame_state(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id,
        director_shot_context=context(source_scene.id, "same", "same", lighting={"key_source": "current lamp"}),
        rendered_image_asset=ImageAsset(variants=[ImageVariant(id="legacy", url="output/old.webp")]),
        shot_visual_design=ShotVisualDesignSnapshot(visual_design={"camera": {"camera_angle": "current angle"}}),
    )
    target = StoryboardFrame(id="target-frame", scene_id=target_scene.id,
                             director_shot_context=context(target_scene.id, "same", "same"))
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "legacy frame", source_variant_id="legacy")
    projection = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert projection["available_fields"] == []
    assert projection["eligible_fields"] == []
    assert all(not values for values in projection["visual_design"].values())


def test_generated_frame_variant_freezes_visual_design_for_later_reference(tmp_path):
    scene = Scene(id="street", name="清溪镇长街", description="source")
    scene.asset_design = {"design_revisions": [{"revision": 2, "design": {
        "lighting": {"key_source": "old lamp"},
    }}]}
    frame = StoryboardFrame(id="frame", scene_id=scene.id,
                            director_shot_context=context(scene.id, "place", "time"))
    generator = StoryboardGenerator.__new__(StoryboardGenerator)
    generator.output_root = str(tmp_path)
    generator.model = Mock()
    generator._get_model_for = Mock(return_value=generator.model)
    generator.generate_frame(frame, [], scene, prompt="old frame prompt", output_dir=str(tmp_path))
    variant = frame.rendered_image_asset.variants[-1]
    assert variant.storyboard_visual_snapshot.visual_design["lighting"]["key_source"] == "old lamp"
    assert variant.storyboard_visual_snapshot.scene_design_revision == 2
    assert ImageVariant.model_validate(variant.model_dump()).storyboard_visual_snapshot == variant.storyboard_visual_snapshot

    scene.asset_design = {"design_revisions": [{"revision": 3, "design": {
        "lighting": {"key_source": "new lamp"},
    }}]}
    frame.lighting = LightingData(description="new frame light")
    from src.apps.comic_gen.visual_continuity import build_reference_projection
    target = StoryboardFrame(id="target", scene_id=scene.id,
                             director_shot_context=context(scene.id, "place", "time"))
    projection = build_reference_projection(target, source_frame=frame, source_asset=scene,
                                            source_scene=scene, source_variant=variant)
    assert projection.visual_design["lighting"]["key_source"] == "old lamp"
    assert "new frame light" not in str(projection.visual_design)
    assert projection.source_scene_design_revision == 2
    assert projection.source_visual_version_known is True


def test_generated_frame_reference_keeps_its_plan_scope_after_source_edits(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source_scene.asset_design = {"design_revisions": [{"revision": 2, "design": {
        "lighting": {"key_source": "old lamp"},
    }}]}
    source = StoryboardFrame(id="source-frame", scene_id=source_scene.id,
                             director_shot_context=context(source_scene.id, "same-place", "same-time"))
    target = StoryboardFrame(id="target-frame", scene_id=target_scene.id,
                             director_shot_context=context(target_scene.id, "same-place", "same-time"))
    script.frames = [source, target]
    generator = StoryboardGenerator.__new__(StoryboardGenerator)
    generator.output_root = str(tmp_path)
    generator.model = Mock()
    generator._get_model_for = Mock(return_value=generator.model)
    generator.generate_frame(source, [], source_scene, prompt="old frame prompt", output_dir=str(tmp_path))
    variant_id = source.rendered_image_asset.selected_id
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "source image", source_variant_id=variant_id)
    pipeline.apply_shot_visual_preset(script.id, target.id, preset.id, "image_and_context", ["lighting"])

    source.director_shot_context = context(source_scene.id, "different-place", "different-time")
    source.director_shot_context["shooting_plan_revision"] = 3
    source.director_shot_context["shooting_plan_hash"] = "new-plan"
    source_scene.asset_design = {"design_revisions": [{"revision": 3, "design": {
        "lighting": {"key_source": "new lamp"},
    }}]}
    assert "old lamp" in pipeline.preview_storyboard_render_prompt(script.id, target.id, "target")
    projection = pipeline.preview_shot_visual_preset(script.id, target.id, preset.id)["projection"]
    assert projection["scope"] == "same_place_time"
    assert projection["source_plan_revision"] == 2


def test_candidate_and_render_submit_reviewed_prompt_and_selected_image(tmp_path):
    pipeline, script, source_scene, target_scene = make_pipeline(tmp_path)
    source = StoryboardFrame(
        id="source-frame", scene_id=source_scene.id, shot_id="source-shot",
        action_description="SOURCE ACTION MUST NOT LEAK",
        dialogue="SOURCE DIALOGUE MUST NOT LEAK",
        director_shot_context=context(source_scene.id, "same-place", "same-time"),
        rendered_image_asset=ImageAsset(variants=[frozen_frame_variant("source-variant", {
            "lighting": {"key_source": "source lamp"},
            "camera": {"camera_angle": "high"},
        }, media_id="media-source", place="same-place", time_id="same-time")], selected_id="source-variant"),
        shot_visual_design=ShotVisualDesignSnapshot(visual_design={
            "lighting": {"key_source": "source lamp"},
            "camera": {"camera_angle": "high"},
        }, compiled_prompt="SOURCE COMPLETE PROMPT MUST NOT LEAK"),
    )
    target = StoryboardFrame(
        id="target-frame", scene_id=target_scene.id, shot_id="target-shot",
        director_shot_context=context(target_scene.id, "same-place", "same-time"),
    )
    script.frames = [source, target]
    preset = pipeline.save_shot_visual_preset(script.id, source.id, "reference", source_variant_id="source-variant")
    pipeline.apply_shot_visual_preset(script.id, target.id, preset.id, "image_and_context", ["lighting"])
    target.reference_package.references.extend([
        StoryboardReference(kind="reference_video", url="output/motion.mp4"),
        StoryboardReference(kind="upload", url="output/unselected.webp"),
    ])
    reviewed = pipeline.preview_storyboard_render_prompt(script.id, target.id, "TARGET SHOT")
    assert "source lamp" in reviewed
    assert "high" not in reviewed
    assert "SOURCE ACTION" not in reviewed
    assert "SOURCE DIALOGUE" not in reviewed
    assert "SOURCE COMPLETE PROMPT" not in reviewed

    pipeline.output_root = str(tmp_path)
    pipeline.storyboard_generator = Mock()
    pipeline._register_storyboard_frame_media = Mock()
    pipeline._owner_output_dir = Mock(return_value=str(tmp_path))
    pipeline._save_data = Mock()
    def generated(candidate, *_args, **_kwargs):
        candidate.rendered_image_asset = ImageAsset(
            variants=[ImageVariant(id="candidate", url="candidate.png")], selected_id="candidate",
        )
    pipeline.storyboard_generator.generate_frame.side_effect = generated
    candidate_token = pipeline.storyboard_candidate_preview_token(script.id, target.id, reviewed, None)
    pipeline.generate_storyboard_candidate(script.id, target.id, reviewed, context_token=candidate_token)
    candidate_call = pipeline.storyboard_generator.generate_frame.call_args.kwargs
    assert candidate_call["prompt"] == reviewed
    assert candidate_call["supplemental_ref_image_paths"] == ["output/source.webp", "output/unselected.webp"]

    render_token = pipeline.storyboard_render_preview_token(
        pipeline.storyboard_render_context_token(script.id, target.id), reviewed,
    )
    pipeline.generate_storyboard_render(
        script.id, target.id, None, reviewed, prompt_is_complete=True, context_token=render_token,
    )
    render_call = pipeline.storyboard_generator.generate_frame.call_args.kwargs
    assert render_call["prompt"] == reviewed
    assert render_call["supplemental_ref_image_paths"] == ["output/source.webp"]
