"""Reference selections resolve real bytes without changing semantic assets."""
import threading
from pathlib import Path
from unittest.mock import Mock

import pytest
from PIL import Image

from src.apps.comic_gen.models import AssetLibraryReference, Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline, InvalidAssetReference
from src.apps.media_registry import register_media
from src.apps.reference_materials import materialize_image, resolve_owned_image
from src.utils.managed_media_root import ManagedMediaRoot


def image_file(tmp_path, name="image.png"):
    path = tmp_path / name
    Image.new("RGB", (16, 16), "blue").save(path)
    return path


def pipeline_for(tmp_path):
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.output_root = str(tmp_path)
    pipeline.scripts = {"project": Script(id="project", title="test", original_text="", owner_profile_id="owner", created_at=0, updated_at=0,
        frames=[StoryboardFrame(id="shot", scene_id="scene")])}
    pipeline.series_store = {}
    pipeline._save_lock = threading.RLock()
    pipeline._save_data = Mock()
    pipeline._pin_frame_assets = lambda *args: []
    pipeline._build_consistency_manifest = lambda *args, **kwargs: None
    pipeline._shot_asset_visual_context = lambda *args: ("", [])
    pipeline.resolve_project_assets = lambda *args: {"characters": [], "scenes": [], "props": []}
    return pipeline


def test_upload_owner_and_image_bytes_are_verified(tmp_path):
    source = image_file(tmp_path)
    media_id = register_media("owner", "image.png", kind="temporary_input", output_root=str(tmp_path))
    assert resolve_owned_image("owner", media_id, output_root=str(tmp_path)) == str(source)
    with pytest.raises(ValueError, match="owner"):
        resolve_owned_image("other", media_id, output_root=str(tmp_path))
    source.write_text("not an image")
    with pytest.raises(OSError):
        resolve_owned_image("owner", media_id, output_root=str(tmp_path))


def test_materialization_is_idempotent_and_has_durable_owner_url(tmp_path):
    source = image_file(tmp_path)
    first = materialize_image("owner", str(source), label="举臂交叉", output_root=str(tmp_path))
    second = materialize_image("owner", str(source), output_root=str(tmp_path))
    assert first["media_id"] == second["media_id"]
    assert first["path"].startswith("/studio/owned-media/") and "signature=" not in first["path"]
    assert ManagedMediaRoot(str(tmp_path)).resolve(first["storage_key"]).read_bytes() == source.read_bytes()
    assert resolve_owned_image("owner", first["media_id"], output_root=str(tmp_path))


def test_changed_registered_image_is_rejected(tmp_path):
    source = image_file(tmp_path)
    material = materialize_image("owner", str(source), output_root=str(tmp_path))
    Image.new("RGB", (16, 16), "red").save(ManagedMediaRoot(str(tmp_path)).resolve(material["storage_key"]))
    with pytest.raises(ValueError, match="changed"):
        resolve_owned_image("owner", material["media_id"], output_root=str(tmp_path))


def test_frame_keeps_stable_references_and_resolves_supplemental_bytes(tmp_path):
    material = materialize_image("owner", str(image_file(tmp_path)), output_root=str(tmp_path))
    pipeline = pipeline_for(tmp_path)
    reference = AssetLibraryReference.model_validate(material["reference"])
    frame = pipeline.update_frame_workbench("project", "shot", workbench_material_references=[reference])
    restored = StoryboardFrame.model_validate_json(frame.model_dump_json())
    assert restored.workbench_material_references == [reference]
    assert pipeline._frame_material_paths(pipeline.scripts["project"], restored) == [resolve_owned_image("owner", material["media_id"], output_root=str(tmp_path))]
    assert not pipeline.scripts["project"].characters and not pipeline.scripts["project"].props
    pipeline.update_frame_workbench("project", "shot", workbench_material_references=[])
    assert not frame.workbench_material_references


def test_frame_rejects_another_owners_media_before_mutation(tmp_path):
    material = materialize_image("other", str(image_file(tmp_path)), output_root=str(tmp_path))
    pipeline = pipeline_for(tmp_path)
    with pytest.raises(InvalidAssetReference):
        pipeline.update_frame_workbench("project", "shot", workbench_material_references=[AssetLibraryReference.model_validate(material["reference"])])
    assert not pipeline.scripts["project"].frames[0].workbench_material_references
    pipeline._save_data.assert_not_called()


def test_r2v_receives_supplemental_image_without_semantic_input(tmp_path):
    material = materialize_image("owner", str(image_file(tmp_path)), output_root=str(tmp_path))
    pipeline = pipeline_for(tmp_path)
    pipeline.get_script = lambda script_id: pipeline.scripts[script_id]
    frame = pipeline.scripts["project"].frames[0]
    frame.workbench_material_references = [AssetLibraryReference.model_validate(material["reference"])]
    script, task_id = pipeline.create_video_task("project", "", "A dancer", model="nsfw/wan3.0", frame_id="shot",
        generation_mode="r2v", reference_image_urls=[], reference_asset_inputs=[])
    task = next(item for item in script.video_tasks if item.id == task_id)
    assert len(task.reference_image_urls) == 1
    assert task.reference_asset_inputs[0].asset_type == "media"


def test_image_candidate_receives_supplemental_bytes_and_keeps_canonical_frame(tmp_path):
    from src.apps.comic_gen.models import ImageAsset, ImageVariant
    material = materialize_image("owner", str(image_file(tmp_path)), output_root=str(tmp_path))
    pipeline = pipeline_for(tmp_path)
    frame = pipeline.scripts["project"].frames[0]
    frame.workbench_material_references = [AssetLibraryReference.model_validate(material["reference"])]
    pipeline.storyboard_candidate_preview_token = lambda *args: "reviewed"
    pipeline._owner_output_dir = lambda *args: str(tmp_path)
    pipeline._register_storyboard_frame_media = Mock()
    pipeline.storyboard_generator = Mock()
    def generate(candidate, *args, **kwargs):
        assert Path(kwargs["supplemental_ref_image_paths"][0]).read_bytes() == Path(resolve_owned_image("owner", material["media_id"], output_root=str(tmp_path))).read_bytes()
        candidate.rendered_image_asset = ImageAsset(selected_id="new", variants=[ImageVariant(id="new", url="candidate.png")])
    pipeline.storyboard_generator.generate_frame.side_effect = generate
    assert pipeline.generate_storyboard_candidate("project", "shot", "dancer", context_token="reviewed") == "candidate.png"
    assert not frame.rendered_image_asset.variants


def test_semantic_reference_source_container_is_preserved_and_owner_checked(tmp_path):
    pipeline = pipeline_for(tmp_path)
    reference = {"asset_type": "character", "asset_id": "hero", "variant_id": "front", "source_scope": "project", "source_container_id": "another-project"}
    pipeline.get_script = lambda script_id, owner: None
    assert pipeline._normalize_asset_reference(reference)["source_container_id"] == "another-project"
    with pytest.raises(InvalidAssetReference, match="source is not visible"):
        pipeline._resolve_asset_library_reference(pipeline.scripts["project"], reference)


def test_failed_frame_save_does_not_leave_unconfirmed_material_selection(tmp_path):
    material = materialize_image("owner", str(image_file(tmp_path)), output_root=str(tmp_path))
    pipeline = pipeline_for(tmp_path)
    pipeline._save_data.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        pipeline.update_frame_workbench("project", "shot", workbench_material_references=[AssetLibraryReference.model_validate(material["reference"])])
    assert not pipeline.scripts["project"].frames[0].workbench_material_references


def test_generated_variant_can_record_uploaded_image_provenance():
    from src.apps.comic_gen.assets import AssetGenerator
    from src.apps.comic_gen.models import ImageVariant
    reference = {"asset_type": "media", "asset_id": "upload", "variant_id": "upload"}
    variant = ImageVariant(id="new", url="new.png", **AssetGenerator._reference_metadata(reference))
    assert variant.reference_asset_type == "media"
    assert variant.reference_inputs == [reference]


@pytest.mark.parametrize("kind", ["platform_reference", "media"])
@pytest.mark.parametrize("project_id", [None, "project"])
def test_character_design_preview_accepts_image_evidence_from_all_sources(tmp_path, monkeypatch, kind, project_id):
    from types import SimpleNamespace
    from src.apps import agent_api
    from src.apps.identity import UserContext
    from src.apps.comic_gen import api as studio_api
    from src.models import uniart
    source = image_file(tmp_path)
    pipeline = pipeline_for(tmp_path)
    pipeline.get_script = lambda project_id, owner: pipeline.scripts["project"] if project_id else None
    pipeline._resolve_asset_library_reference = lambda container, reference: (str(source), reference)
    pipeline._find_asset_with_source = lambda *args: (None, None)
    monkeypatch.setattr(studio_api, "pipeline", pipeline)
    monkeypatch.setattr(agent_api, "validate_model", lambda *args: None)
    def delivery(path):
        assert "/users/" in path and Path(path).read_bytes() == source.read_bytes()
        return "https://media.example/reference.png"
    monkeypatch.setattr(uniart, "_image_reference_url", delivery)
    reference = {"asset_type": kind, "asset_id": "image", "variant_id": "1"}
    if kind == "platform_reference": reference.update(source_scope="platform", revision=1)
    body = agent_api.CharacterDesignRequest(model="nsfw/llm-nf-all", character_name="舞者", profile="成年女性", project_id=project_id, reference_assets=[reference])
    preview = agent_api.preview_character_design_draft(body, UserContext("user", "owner", "name", "token"))
    assert len(preview["media"]) == 1 and preview["media"][0]["url"] == "https://media.example/reference.png"


def test_material_resolver_http_sets_owner_context_and_rejects_foreign_media(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from src.apps.comic_gen import api as studio_api
    from src.apps.identity import UserContext

    pipeline = pipeline_for(tmp_path)
    own = materialize_image('owner', str(image_file(tmp_path)), output_root=str(tmp_path))
    foreign = materialize_image('other', str(image_file(tmp_path)), output_root=str(tmp_path))
    user = UserContext('user', 'owner', 'name', 'token')
    monkeypatch.setattr(studio_api, 'pipeline', pipeline)
    monkeypatch.setattr(studio_api, '_resolve_request_context', lambda *args: (user, False))
    with TestClient(studio_api.app) as client:
        result = client.post('/reference-materials/resolve', json={'reference': own['reference'], 'label': '本地参考'})
        assert result.status_code == 200, result.text
        assert result.json()['path'] == own['path']
        result = client.post('/reference-materials/resolve', json={'reference': foreign['reference']})
        assert result.status_code == 422
