import threading
import time
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest

from src.apps.comic_gen.models import Character, GenerationStatus, ImageAsset, ImageVariant, ModelSettings, Scene, Script, Series, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.storyboard import StoryboardGenerator
from src.apps.studio_access import studio_media_url, studio_owner_key, verify_studio_media


def test_accepted_image_polish_flags_new_confirmed_design_but_not_draft():
    scene = Scene(id="scene-1", name="长街", description="青石街", asset_design={
        "design_revisions": [{"revision": 1, "design": {"visual_notes": "冷灰蓝长街"}}],
        "design_draft": {},
    })
    character = Character(id="char-1", name="苏砚", description="剑客", character_design={
        "design_revisions": [{"revision": 1, "design": {"identity": "素衣"}}],
    })
    frame = StoryboardFrame(id="frame-1", scene_id=scene.id, character_ids=[character.id])
    script = Script(id="episode-1", title="Episode", original_text="", scenes=[scene],
                    characters=[character], frames=[frame], created_at=0, updated_at=0)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"scenes": [scene], "characters": [character]})
    pipeline.get_effective_prompt = Mock(return_value="")
    pipeline.director_prompt_context = Mock(return_value="")
    pipeline.effective_art_direction = Mock(return_value=None)
    pipeline.script_processor = Mock()
    pipeline.script_processor.polish_storyboard_prompt.return_value = {
        "prompt_cn": "长街", "prompt_en": "Reviewed street prompt",
    }
    pipeline._save_data = Mock()

    prepared = pipeline.preview_frame_polish_input(script.id, frame.id, "街上行人", [])
    result = pipeline.refine_frame_prompt(script.id, frame.id, "街上行人", [],
                                          reviewed_message=prepared["message"], context_token=prepared["context_token"])
    polish_message = pipeline.script_processor.polish_storyboard_prompt.call_args.kwargs["prepared_message"]
    assert "冷灰蓝长街" in polish_message and "素衣" in polish_message
    assert frame.image_prompt_en is None and frame.image_prompt is None
    pipeline.apply_frame_image_polish_candidate(script.id, frame.id, result["candidate_id"])
    assert pipeline.storyboard_image_polish_review(script.id, frame.id, frame.image_prompt_en) is None
    scene.asset_design["design_draft"] = {"visual_notes": "红色草稿"}
    assert pipeline.storyboard_image_polish_review(script.id, frame.id, frame.image_prompt_en) is None
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "新街景"}})
    assert "场景设计已变化" in pipeline.storyboard_image_polish_review(script.id, frame.id, frame.image_prompt_en)
    prepared = pipeline.preview_frame_polish_input(script.id, frame.id, "街上行人", [])
    result = pipeline.refine_frame_prompt(script.id, frame.id, "街上行人", [],
                                          reviewed_message=prepared["message"], context_token=prepared["context_token"])
    pipeline.apply_frame_image_polish_candidate(script.id, frame.id, result["candidate_id"])
    assert pipeline.storyboard_image_polish_review(script.id, frame.id, frame.image_prompt_en) is None
    character.character_design["design_revisions"].append({"revision": 2, "design": {"identity": "蓝衣"}})
    assert "角色设计已变化" in pipeline.storyboard_image_polish_review(script.id, frame.id, frame.image_prompt_en)


def test_image_polish_candidate_rejects_changed_confirmed_design_without_replacing_prompt():
    scene = Scene(id="scene-1", name="长街", description="青石街", asset_design={
        "design_revisions": [{"revision": 1, "design": {"visual_notes": "冷灰蓝"}}],
    })
    frame = StoryboardFrame(id="frame-1", scene_id=scene.id, image_prompt="原提示词")
    script = Script(id="episode-1", title="Episode", original_text="", scenes=[scene],
                    frames=[frame], created_at=0, updated_at=0)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"scenes": [scene], "characters": []})
    pipeline.get_effective_prompt = Mock(return_value="")
    pipeline.director_prompt_context = Mock(return_value="")
    pipeline.effective_art_direction = Mock(return_value=None)
    pipeline.script_processor = Mock()
    pipeline.script_processor.polish_storyboard_prompt.return_value = {
        "prompt_cn": "新版", "prompt_en": "New candidate",
    }
    pipeline._save_data = Mock()

    prepared = pipeline.preview_frame_polish_input(script.id, frame.id, "草稿", [])
    result = pipeline.refine_frame_prompt(script.id, frame.id, "草稿", [],
                                          reviewed_message=prepared["message"], context_token=prepared["context_token"])
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "新场景"}})
    with pytest.raises(ValueError, match="asset design changed"):
        pipeline.apply_frame_image_polish_candidate(script.id, frame.id, result["candidate_id"])
    assert frame.image_prompt == "原提示词"
    assert frame.image_prompt_en is None
    scene.asset_design["design_revisions"].pop()
    original_angle = frame.camera_angle
    frame.camera_angle = "low_angle"
    with pytest.raises(ValueError, match="Shot or asset design changed"):
        pipeline.apply_frame_image_polish_candidate(script.id, frame.id, result["candidate_id"])
    frame.camera_angle = original_angle
    frame.image_prompt = "用户刚刚手动修改"
    with pytest.raises(ValueError, match="Frame prompt changed"):
        pipeline.apply_frame_image_polish_candidate(script.id, frame.id, result["candidate_id"])


@pytest.mark.parametrize("model_name", ["uniart/gpt-image-2"])
def test_storyboard_routes_uniart_image_models_to_uniart_adapter(monkeypatch, tmp_path, model_name):
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: path
    monkeypatch.setattr(
        "src.models.uniart.UniArtImageModel",
        lambda _config: adapter,
    )
    monkeypatch.setattr(
        "src.apps.comic_gen.storyboard.studio_uniart_config",
        lambda: {"UNIART_API_KEY": "test"},
    )

    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        action_description="A person enters the street",
    )

    generator.generate_frame(
        frame,
        characters=[],
        scene=None,
        prompt="A person enters the street",
        model_name=model_name,
    )

    adapter.generate.assert_called_once()
    assert adapter.generate.call_args.kwargs["model_name"] == model_name
    assert frame.status == GenerationStatus.COMPLETED


def test_storyboard_generation_failure_is_not_returned_as_success(tmp_path):
    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    generator.model.generate = Mock(side_effect=RuntimeError("provider rejected request"))
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")

    with pytest.raises(RuntimeError, match="provider rejected request"):
        generator.generate_frame(frame, [], None, model_name="wan2.7-image-pro")

    assert frame.status == GenerationStatus.FAILED


def test_storyboard_reference_images_keep_selected_order(monkeypatch, tmp_path):
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: path
    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    generator._get_model_for = Mock(return_value=adapter)
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    first.write_bytes(b"first")
    second.write_bytes(b"second")

    generator.generate_frame(
        StoryboardFrame(id="frame-1", scene_id="scene-1"), [], None,
        prompt="A street", ref_image_paths=[str(first), str(second), str(first)],
    )

    assert adapter.generate.call_args.kwargs["ref_image_paths"] == [str(first), str(second)]


def test_storyboard_render_keeps_local_file_even_when_oss_is_configured(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "src.utils.oss_utils.OSSImageUploader",
        Mock(side_effect=AssertionError("storyboard must not upload to OSS")),
    )
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: (
        Path(path).write_bytes(b"image"), 0,
    )
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneImageModel", lambda _config: adapter)
    monkeypatch.setattr("src.apps.comic_gen.storyboard.studio_nsfw_new_one_config", lambda: {"api_key": "test"})
    generator = StoryboardGenerator({"output_dir": "output/storyboard"})
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")

    generator.generate_frame(frame, [], None, prompt="A street", model_name="nsfw/seedream_5.0Pro_nsfw")

    selected = frame.rendered_image_asset.variants[0]
    assert selected.url.startswith("storyboard/")
    assert (tmp_path / "output" / selected.url).read_bytes() == b"image"
    assert frame.image_url == selected.url


def test_storyboard_render_writes_owner_scoped_media(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    generator = StoryboardGenerator()
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: Path(path).write_bytes(b"image")
    generator._get_model_for = Mock(return_value=adapter)
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    owner_dir = f"output/users/{studio_owner_key('owner-1')}/studio/storyboard"

    generator.generate_frame(frame, [], None, prompt="A street", output_dir=owner_dir)

    assert frame.image_url.startswith(f"users/{studio_owner_key('owner-1')}/studio/storyboard/")
    assert (tmp_path / "output" / frame.image_url).read_bytes() == b"image"


def test_legacy_storyboard_image_is_migrated_to_owner_media(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    legacy = tmp_path / "output/storyboard/frame-1_variant-1.png"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"existing frame")
    variant = ImageVariant(id="variant-1", url="storyboard/frame-1_variant-1.png")
    frame = StoryboardFrame(
        id="frame-1", scene_id="scene-1", image_url=variant.url,
        rendered_image_url=variant.url,
        rendered_image_asset=ImageAsset(selected_id=variant.id, variants=[variant]),
    )
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    owner_profile_id="owner-1", created_at=time.time(), updated_at=time.time())
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline._save_data = Mock()

    pipeline.migrate_legacy_storyboard_media(script)

    assert frame.image_url.startswith(f"users/{studio_owner_key('owner-1')}/studio/storyboard/")
    assert (tmp_path / "output" / frame.image_url).read_bytes() == b"existing frame"
    assert legacy.read_bytes() == b"existing frame"
    assert variant.media_id
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-signing-key")
    signed = urlsplit(studio_media_url("owner-1", frame.image_url))
    query = parse_qs(signed.query)
    assert verify_studio_media(
        studio_owner_key("owner-1"), "storyboard/frame-1_variant-1.png",
        int(query["expires"][0]), query["signature"][0],
    ) == str(tmp_path / "output" / frame.image_url)
    pipeline._save_data.assert_called_once()


def test_legacy_seedream_selection_uses_nsfw_adapter(monkeypatch):
    adapter = Mock()
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneImageModel", lambda _config: adapter)
    monkeypatch.setattr("src.apps.comic_gen.storyboard.studio_nsfw_new_one_config", lambda: {"api_key": "test"})

    assert StoryboardGenerator()._get_model_for("uniart/seedream_5.0Pro_nsfw") is adapter


def test_series_storyboard_render_uses_series_i2i_model(tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="episode-1", series_id="series-1", title="Episode", original_text="",
        frames=[frame], model_settings=ModelSettings(i2i_model="uniart/gpt-image-2"),
        owner_profile_id="owner-1", created_at=now, updated_at=now,
    )
    series = Series(
        id="series-1", title="Series", model_settings=ModelSettings(
            i2i_model="uniart/gpt-image-2.5-flare-discount"),
        created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    pipeline.generate_storyboard_render(script.id, frame.id, None, "A street")

    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["model_name"] == "uniart/gpt-image-2.5-flare-discount"
    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["output_dir"] == (
        f"output/users/{studio_owner_key('owner-1')}/studio/storyboard"
    )


def test_complete_first_frame_prompt_reaches_generator_unchanged():
    now = time.time()
    frame = StoryboardFrame(
        id="frame-1", scene_id="scene-1",
        director_shot_context={"scene": {"location": "长街", "time_anchor": "黄昏"},
                               "shot": {"visual_intent": "人物出场"}},
    )
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    complete_prompt = "完整首帧正文：人物站在长街树荫下。"

    pipeline.generate_storyboard_render(
        script.id, frame.id, None, complete_prompt, negative_prompt="文字、水印",
        prompt_is_complete=True,
    )

    call = pipeline.storyboard_generator.generate_frame.call_args
    assert call.kwargs["prompt"] == complete_prompt
    assert call.kwargs["preserve_prompt"] is True
    assert call.kwargs["negative_prompt"] == "文字、水印"


def test_shot_frame_candidate_does_not_replace_storyboard_image(tmp_path):
    frame = StoryboardFrame(
        id="frame-1", scene_id="scene-1", image_url="original.png",
        rendered_image_url="original.png", image_prompt="reviewed storyboard",
        status=GenerationStatus.COMPLETED,
    )
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=time.time(), updated_at=time.time())
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.output_root = str(tmp_path)
    pipeline.resolve_project_assets = Mock(return_value={"characters": [], "scenes": []})
    pipeline._owner_output_dir = Mock(return_value=str(tmp_path))
    pipeline._register_storyboard_frame_media = Mock()
    pipeline.storyboard_generator = Mock()

    def generate(candidate, *_args, **_kwargs):
        candidate.rendered_image_asset = ImageAsset(
            selected_id="candidate", variants=[ImageVariant(id="candidate", url="candidate.png")],
        )
        candidate.image_url = "candidate.png"
        candidate.rendered_image_url = "candidate.png"

    pipeline.storyboard_generator.generate_frame.side_effect = generate

    token = pipeline.storyboard_candidate_preview_token(script.id, frame.id, "shot input", None)
    assert pipeline.generate_storyboard_candidate(script.id, frame.id, "shot input", context_token=token) == "candidate.png"
    assert frame.image_url == "original.png"
    assert frame.rendered_image_url == "original.png"
    assert frame.image_prompt == "reviewed storyboard"
    assert frame.status == GenerationStatus.COMPLETED
    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["preserve_prompt"] is True


def test_shot_candidate_requires_current_reviewed_input(tmp_path):
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=time.time(), updated_at=time.time())
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"characters": [], "scenes": [], "props": []})
    token = pipeline.storyboard_candidate_preview_token(script.id, frame.id, "reviewed", "negative")
    with pytest.raises(ValueError, match="outdated"):
        pipeline.generate_storyboard_candidate(script.id, frame.id, "changed", "negative", token)
    with pytest.raises(ValueError, match="outdated"):
        pipeline.generate_storyboard_candidate(script.id, frame.id, "reviewed", "different negative", token)
    frame.shot_size = "close-up"
    with pytest.raises(ValueError, match="outdated"):
        pipeline.generate_storyboard_candidate(script.id, frame.id, "reviewed", "negative", token)


def test_canonical_render_token_binds_negative_prompt():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    reviewed = ComicGenPipeline.storyboard_render_preview_token("context", "frame", "no blur")
    assert reviewed != ComicGenPipeline.storyboard_render_preview_token("context", "frame", "no motion")
    assert reviewed != ComicGenPipeline.storyboard_render_preview_token("context", "changed", "no blur")


def test_candidate_preview_uses_confirmed_scene_design_without_video_timing():
    scene = Scene(id="scene-1", name="长街", description="青石路", asset_design={
        "design_revisions": [{"revision": 1, "design": {
            "visual_notes": "粮铺沿街排列", "ambient_lighting": "冷灰蓝天光",
            "visual_constraints": {"key_light_direction": "side", "visible_face_limit": 2},
        }}],
    })
    frame = StoryboardFrame(id="frame-1", scene_id=scene.id, camera_movement="快速推进", transition_hint="叠化")
    script = Script(id="episode-1", title="Episode", original_text="", scenes=[scene], frames=[frame],
                    created_at=time.time(), updated_at=time.time())
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"characters": [], "scenes": [scene], "props": []})

    preview = pipeline.preview_storyboard_candidate_prompt(script.id, frame.id, "人物站在粮铺前")
    assert "粮铺沿街排列" in preview
    assert "冷灰蓝天光" in preview
    assert "主光方向：侧面光" in preview
    assert "可见人脸上限：2 张" not in preview
    assert "快速推进" not in preview
    assert "叠化" not in preview
    original_token = pipeline.storyboard_candidate_preview_token(script.id, frame.id, preview, None)
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "粮铺门面已改"}})
    assert pipeline.storyboard_candidate_preview_token(script.id, frame.id, preview, None) != original_token


def test_candidate_preview_uses_scene_baseline_without_old_shot_content():
    scene = Scene(id="scene-1", name="青溪镇粮铺",
                  description="木质粮铺，流民匪寇劫掠，近景百姓退后", asset_design={
        "design_revisions": [{"revision": 1, "design": {
            "visual_notes": "木质粮铺，流民匪寇劫掠",
            "asset_baseline": {
                "scene_identity": "青溪镇粮铺", "location_type": "长街粮铺",
                "fixed_geometry": ["木质铺面", "柜台"], "fixed_landmarks": ["粮袋"],
                "materials": ["旧木材"], "environment": ["青石板长街"],
                "time_baseline": "黄昏", "lighting_baseline": "右侧斜光",
                "composition_tendency": "沿街纵深", "reusable_constraints": [], "basis": ["observed"],
            },
            "shot_only_content": ["流民匪寇劫掠", "近景百姓退后"],
            "visual_constraints": {"visible_face_limit": 2},
        }}],
    })
    frame = StoryboardFrame(id="frame-1", scene_id=scene.id)
    script = Script(id="episode-1", title="Episode", original_text="", scenes=[scene], frames=[frame],
                    created_at=time.time(), updated_at=time.time())
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"characters": [], "scenes": [scene], "props": []})

    preview = pipeline.preview_storyboard_candidate_prompt(script.id, frame.id, "粮铺空镜")

    assert "固定结构：木质铺面、柜台" in preview
    assert "流民匪寇" not in preview
    assert "百姓退后" not in preview
    assert "可见人脸上限" not in preview


def test_render_preview_is_the_exact_complete_generator_prompt():
    now = time.time()
    frame = StoryboardFrame(
        id="frame-1", scene_id="scene-1", character_ids=["char-1"],
        director_shot_context={"scene": {"location": "长街", "time_anchor": "黄昏"},
                               "shot": {"composition": "树荫外保留夕阳"}},
    )
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    character = Character(id="char-1", name="苏砚", description="素黑劲装")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [character], "scenes": []})

    preview = pipeline.preview_storyboard_render_prompt(script.id, frame.id, "苏砚站在树下")
    assert "场景地点：长街" in preview
    assert "构图：树荫外保留夕阳" in preview
    assert "Characters: 苏砚 (素黑劲装)." in preview
    pipeline.generate_storyboard_render(
        script.id, frame.id, None, preview, prompt_is_complete=True,
    )
    call = pipeline.storyboard_generator.generate_frame.call_args
    assert call.kwargs["prompt"] == preview
    assert call.kwargs["preserve_prompt"] is True


def test_storyboard_preview_uses_confirmed_scene_design_and_ignores_new_draft():
    now = time.time()
    scene = Scene(id="scene-1", name="长街", description="青石长街", asset_design={
        "design_draft": {"visual_notes": "全画面暖红色", "confirmed": False},
        "design_revisions": [{"revision": 1, "design": {
            "visual_notes": "青石长街与街边粮铺",
            "style": "写实古装",
            "ambient_lighting": "街面环境为冷灰蓝，夕阳仅在远处天际",
            "reference_viewpoint": "街口向粮铺侧拍",
            "visual_constraints": {"key_light_direction": "side", "visible_face_limit": 3},
        }}],
    })
    frame = StoryboardFrame(id="frame-1", scene_id=scene.id,
                            director_shot_context={"shot": {"lighting": {
                                "key_source": "残阳如血覆盖整条街", "color_tone": "暖红色",
                            }, "composition": "粮铺位于画面中段"}})
    script = Script(id="episode-1", title="Episode", original_text="", scenes=[scene], frames=[frame],
                    created_at=now, updated_at=now)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": [scene]})

    preview = pipeline.preview_storyboard_render_prompt(script.id, frame.id, "粮铺前人群退避")
    assert "场景视觉基线" in preview
    assert pipeline.storyboard_render_scene_design_source(script.id, frame.id) == "关联场景设计：长街 r1"
    assert pipeline.storyboard_render_omitted_plan_lighting(script.id, frame.id) == "残阳如血覆盖整条街；暖红色"
    assert "街面环境为冷灰蓝，夕阳仅在远处天际" in preview
    assert "主光方向：侧面光" in preview
    assert "粮铺位于画面中段" in preview
    assert "残阳如血覆盖整条街" not in preview
    assert "全画面暖红色" not in preview
    before = pipeline.storyboard_render_context_token(script.id, frame.id)
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "新版长街"}})
    assert pipeline.storyboard_render_context_token(script.id, frame.id) != before
    scene.asset_design["design_revisions"] = []
    assert "残阳如血覆盖整条街" in pipeline.preview_storyboard_render_prompt(
        script.id, frame.id, "粮铺前人群退避",
    )


def test_complete_prompt_reaches_image_adapter_without_character_suffix(tmp_path):
    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    adapter = Mock()
    generator._get_model_for = Mock(return_value=adapter)
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1", character_ids=["char-1"])
    character = Character(id="char-1", name="苏砚", description="素黑劲装")
    prompt = "苏砚站在长街。Characters: 苏砚 (素黑劲装)."

    generator.generate_frame(frame, [character], None, prompt=prompt, preserve_prompt=True)

    assert adapter.generate.call_args.args[0] == prompt


def test_render_preview_rejects_changed_shot_before_generating():
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1", character_ids=["char-1"],
                            director_shot_context={"shot": {"composition": "树荫"}})
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    character = Character(id="char-1", name="苏砚", description="素黑劲装")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [character], "scenes": []})
    token = pipeline.storyboard_render_preview_token(
        pipeline.storyboard_render_context_token(script.id, frame.id), "已预览正文",
    )
    frame.director_shot_context["shot"]["composition"] = "夕阳下的街面"

    with pytest.raises(ValueError, match="preview is outdated"):
        pipeline.generate_storyboard_render(
            script.id, frame.id, None, "已预览正文", prompt_is_complete=True,
            context_token=token,
        )
    pipeline.storyboard_generator.generate_frame.assert_not_called()
    pipeline._save_data.assert_not_called()


def test_render_preview_rejects_changed_prompt_before_generating():
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    preview = pipeline.preview_storyboard_render_prompt(script.id, frame.id, "原始镜头")
    token = pipeline.storyboard_render_preview_token(
        pipeline.storyboard_render_context_token(script.id, frame.id), preview,
    )

    with pytest.raises(ValueError, match="preview is outdated"):
        pipeline.generate_storyboard_render(
            script.id, frame.id, None, preview + " 新增光影", prompt_is_complete=True,
            context_token=token,
        )
    pipeline.storyboard_generator.generate_frame.assert_not_called()
    pipeline._save_data.assert_not_called()

    pipeline.generate_storyboard_render(
        script.id, frame.id, None, preview, prompt_is_complete=True, context_token=token,
    )
    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["prompt"] == preview


def test_render_preview_token_tracks_character_asset_and_style():
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1", character_ids=["char-1"])
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    character = Character(id="char-1", name="苏砚", description="素黑劲装")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [character], "scenes": []})
    original = pipeline.storyboard_render_context_token(script.id, frame.id)
    character.description = "灰色长袍"
    changed_character = pipeline.storyboard_render_context_token(script.id, frame.id)
    frame.lighting_override = "暮色"
    changed_style = pipeline.storyboard_render_context_token(script.id, frame.id)
    assert len({original, changed_character, changed_style}) == 3


def test_complete_first_frame_prompt_requires_text():
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(id="episode-1", title="Episode", original_text="", frames=[frame],
                    created_at=now, updated_at=now)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.storyboard_generator = Mock()

    with pytest.raises(ValueError, match="Complete storyboard prompt cannot be empty"):
        pipeline.generate_storyboard_render(
            script.id, frame.id, None, "  ", prompt_is_complete=True,
        )

    pipeline.storyboard_generator.generate_frame.assert_not_called()


def test_storyboard_render_resolves_signed_studio_references(monkeypatch, tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="project-1", title="Project", original_text="", frames=[frame],
        owner_profile_id="apikey-owner", created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    monkeypatch.chdir(tmp_path)
    (tmp_path / "output").mkdir()
    reference = tmp_path / "output" / "reference.png"
    reference.write_bytes(b"image")
    signed_url = "/studio/media/owner/reference.png?expires=123&signature=test"
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.resolve_studio_reference",
        lambda value, owner, **_kwargs: "reference.png" if value == signed_url and owner == "apikey-owner" else None,
    )

    pipeline.generate_storyboard_render(
        script.id, frame.id, {"reference_image_urls": [signed_url]}, "A street",
    )

    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["ref_image_paths"] == [str(reference)]


def test_storyboard_render_rejects_foreign_studio_reference(monkeypatch, tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="project-1", title="Project", original_text="", frames=[frame],
        owner_profile_id="apikey-owner", created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline._save_data = Mock()
    signed_url = "/studio/media/foreign/reference.png?expires=123&signature=test"
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.resolve_studio_reference",
        Mock(side_effect=ValueError("Media reference belongs to another owner")),
    )

    with pytest.raises(ValueError, match="another owner"):
        pipeline.generate_storyboard_render(
            script.id, frame.id, {"reference_image_urls": [signed_url]}, "A street",
        )
