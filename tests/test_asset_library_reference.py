from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import (
    Character,
    GlobalAssetLibrary,
    ImageVariant,
    Prop,
    Scene,
    Series,
)
from src.apps.comic_gen.pipeline import (
    ComicGenPipeline,
    InvalidAssetReference,
)
from src.models.image import WanxImageModel


def _pipeline_with_assets(tmp_path: Path):
    from src.apps.comic_gen.models import Script

    target = Scene(
        id="target-scene",
        name="Target",
        description="Target scene",
        owner_user_id="user",
        owner_profile_id="owner",
    )
    script = Script(
        id="project",
        title="Project",
        original_text="",
        scenes=[target],
        created_at=1,
        updated_at=1,
        owner_user_id="user",
        owner_profile_id="owner",
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline.asset_generation_tasks = {}
    pipeline._save_data = Mock()
    pipeline._save_library_data = Mock()
    pipeline._save_series_data = Mock()
    pipeline.effective_director_profile = lambda _script: None
    return pipeline, target


def test_task_snapshots_library_reference_ids_and_resolves_at_execution(tmp_path, monkeypatch):
    pipeline, target = _pipeline_with_assets(tmp_path)
    reference_path = tmp_path / "output" / "users" / "owner" / "studio" / "assets" / "library.png"
    reference_path.parent.mkdir(parents=True)
    reference_path.write_bytes(b"reference")

    reference_asset = Prop(
        id="library-prop",
        name="Tea cup",
        description="Ceramic cup",
        owner_user_id="user",
        owner_profile_id="owner",
    )
    reference_asset.image_asset.variants.append(
        ImageVariant(id="variant-1", url=str(reference_path.relative_to(tmp_path / "output")))
    )
    reference_asset.image_asset.selected_id = "variant-1"
    pipeline.library_store.props = [reference_asset]
    pipeline._save_library_data = Mock()

    # The resolver uses the process cwd for managed output paths.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.runtime_uniart_for_owner",
        lambda *_args: {},
    )
    generator = Mock()
    pipeline.asset_generator = generator

    _, task_id = pipeline.create_asset_generation_task(
        "project",
        target.id,
        "scene",
        prompt="Tea room",
        model_name="test-image-model",
        reference_image_url="https://example.test/legacy-provider-url.png",
        reference={
            "asset_type": "prop",
            "asset_id": "library-prop",
            "variant_id": "variant-1",
        },
        image_generation_mode="reference",
    )
    task = pipeline.asset_generation_tasks[task_id]
    assert task["params"]["reference"] == {
        "asset_type": "prop",
        "asset_id": "library-prop",
        "variant_id": "variant-1",
    }
    assert task["params"]["reference_image_url"] is None
    assert "library.png" not in str(task["params"])

    pipeline.process_asset_generation_task(task_id)

    call = generator.generate_scene.call_args
    assert call.kwargs["reference_image_url"] == str(reference_path)
    assert call.kwargs["reference_provenance"] == task["params"]["reference"]
    assert pipeline.asset_generation_tasks[task_id]["status"] == "completed"
    status = pipeline.get_asset_generation_task_status(task_id)
    assert status["asset"]["id"] == target.id
    assert status["asset_source"] == "episode"
    assert "script" not in status


def test_structured_character_and_watch_references_keep_prompt_and_attachment_order(tmp_path, monkeypatch):
    pipeline, target = _pipeline_with_assets(tmp_path)
    output = tmp_path / "output"
    character_path = output / "users" / "owner" / "character.png"
    watch_path = output / "users" / "owner" / "watch.png"
    character_path.parent.mkdir(parents=True)
    character_path.write_bytes(b"character")
    watch_path.write_bytes(b"watch")

    character = Character(
        id="actor", name="Actor", description="", owner_user_id="user", owner_profile_id="owner"
    )
    character.reference_sheet.image_variants.append(
        ImageVariant(id="actor-front", url=str(character_path.relative_to(output)))
    )
    watch = Prop(
        id="watch", name="Watch", description="", owner_user_id="user", owner_profile_id="owner"
    )
    watch.image_asset.variants.append(
        ImageVariant(id="watch-front", url=str(watch_path.relative_to(output)))
    )
    pipeline.library_store.characters = [character]
    pipeline.library_store.props = [watch]
    pipeline.asset_generator = Mock()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("src.apps.comic_gen.pipeline.runtime_uniart_for_owner", lambda *_args: {})

    references = [
        {"asset_type": "character", "asset_id": "actor", "variant_id": "actor-front"},
        {"asset_type": "prop", "asset_id": "watch", "variant_id": "watch-front"},
    ]
    _, task_id = pipeline.create_asset_generation_task(
        "project",
        target.id,
        "scene",
        prompt="Keep the character; put the referenced watch on the left wrist.",
        image_generation_mode="reference",
        references=references,
    )
    assert pipeline.asset_generation_tasks[task_id]["params"]["references"] == references

    pipeline.process_asset_generation_task(task_id)

    call = pipeline.asset_generator.generate_scene.call_args
    assert call.kwargs["prompt"] == "Keep the character; put the referenced watch on the left wrist."
    assert call.kwargs["reference_image_url"] is None
    assert call.kwargs["reference_image_urls"] == [str(character_path), str(watch_path)]
    assert call.kwargs["image_generation_mode"] == "reference"
    assert call.kwargs["reference_provenance_list"] == [
        {"asset_type": "character", "asset_id": "actor", "variant_id": "actor-front"},
        {"asset_type": "prop", "asset_id": "watch", "variant_id": "watch-front"},
    ]


def test_duplicate_structured_references_fail_before_task_creation(tmp_path):
    pipeline, target = _pipeline_with_assets(tmp_path)
    references = [
        {"asset_type": "prop", "asset_id": "watch", "variant_id": "front"},
        {"asset_type": "prop", "asset_id": "watch", "variant_id": "front"},
    ]
    with pytest.raises(InvalidAssetReference, match="duplicate"):
        pipeline.create_asset_generation_task(
            "project",
            target.id,
            "scene",
            prompt="Use the watch",
            references=references,
            image_generation_mode="reference",
        )
    assert pipeline.asset_generation_tasks == {}


@pytest.mark.parametrize(
    "mode,references,error",
    [
        ("text", [{"asset_type": "prop", "asset_id": "watch", "variant_id": "front"}], "text mode"),
        ("reference", [], "requires at least one"),
    ],
)
def test_generation_mode_rejects_inconsistent_reference_inputs(tmp_path, mode, references, error):
    pipeline, target = _pipeline_with_assets(tmp_path)
    with pytest.raises(InvalidAssetReference, match=error):
        pipeline.create_asset_generation_task(
            "project",
            target.id,
            "scene",
            prompt="Watch",
            references=references,
            image_generation_mode=mode,
        )
    assert pipeline.asset_generation_tasks == {}


def test_library_reference_rejects_foreign_asset_and_wrong_variant(tmp_path, monkeypatch):
    pipeline, target = _pipeline_with_assets(tmp_path)
    foreign = Prop(
        id="foreign-prop",
        name="Foreign",
        description="",
        owner_user_id="other-user",
        owner_profile_id="other-owner",
    )
    foreign.image_asset.variants.append(ImageVariant(id="foreign-variant", url="https://example.test/ref.png"))
    pipeline.library_store.props = [foreign]
    monkeypatch.chdir(tmp_path)

    with pytest.raises(InvalidAssetReference, match="visible"):
        pipeline.create_asset_generation_task(
            "project",
            target.id,
            "scene",
            reference={
                "asset_type": "prop",
                "asset_id": "foreign-prop",
                "variant_id": "foreign-variant",
            },
            image_generation_mode="reference",
        )

    owned = foreign.model_copy(update={"owner_user_id": "user", "owner_profile_id": "owner", "id": "owned-prop"})
    pipeline.library_store.props = [owned]
    with pytest.raises(InvalidAssetReference, match="does not belong"):
        pipeline.create_asset_generation_task(
            "project",
            target.id,
            "scene",
            reference={
                "asset_type": "prop",
                "asset_id": "owned-prop",
                "variant_id": "missing-variant",
            },
            image_generation_mode="reference",
        )


def test_series_task_resolves_global_library_reference_at_execution(tmp_path, monkeypatch):
    reference_path = tmp_path / "output" / "users" / "owner" / "studio" / "assets" / "library.png"
    reference_path.parent.mkdir(parents=True)
    reference_path.write_bytes(b"reference")
    target = Scene(
        id="series-scene",
        name="Target",
        description="Target scene",
        owner_user_id="user",
        owner_profile_id="owner",
    )
    series = Series(
        id="series",
        title="Series",
        scenes=[target],
        owner_user_id="user",
        owner_profile_id="owner",
        created_at=1,
        updated_at=1,
    )
    reference_asset = Prop(
        id="global-prop",
        name="Tea cup",
        description="Ceramic cup",
        owner_user_id="user",
        owner_profile_id="owner",
    )
    reference_asset.image_asset.variants.append(
        ImageVariant(id="global-variant", url=str(reference_path.relative_to(tmp_path / "output")))
    )

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.series_store = {series.id: series}
    pipeline.library_store = GlobalAssetLibrary(props=[reference_asset])
    pipeline.asset_generation_tasks = {}
    pipeline.asset_generator = Mock()
    pipeline._save_series_data = Mock()
    monkeypatch.chdir(tmp_path)

    _, task_id = pipeline.generate_series_asset(
        series.id,
        target.id,
        "scene",
        prompt="Tea room",
        model_name="test-image-model",
        reference_image_url="https://example.test/legacy-provider-url.png",
        reference={
            "asset_type": "prop",
            "asset_id": reference_asset.id,
            "variant_id": "global-variant",
        },
        image_generation_mode="reference",
    )
    assert pipeline.asset_generation_tasks[task_id]["params"]["reference"] == {
        "asset_type": "prop",
        "asset_id": "global-prop",
        "variant_id": "global-variant",
    }
    assert pipeline.asset_generation_tasks[task_id]["params"]["reference_image_url"] is None

    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.runtime_uniart_for_owner",
        lambda *_args: {},
    )
    pipeline.process_asset_generation_task(task_id)
    call = pipeline.asset_generator.generate_scene.call_args
    assert call.kwargs["reference_image_url"] == str(reference_path)
    assert call.kwargs["reference_provenance"]["variant_id"] == "global-variant"
    assert pipeline.asset_generation_tasks[task_id]["status"] == "completed"
    status = pipeline.get_asset_generation_task_status(task_id)
    assert status["asset"]["id"] == target.id
    assert status["asset_source"] == "series"


def test_asset_generation_endpoint_maps_invalid_reference_to_http_400(monkeypatch):
    from fastapi import BackgroundTasks, HTTPException
    from src.apps.comic_gen import api

    def reject(*_args, **_kwargs):
        raise InvalidAssetReference("reference variant does not belong to the asset")

    monkeypatch.setattr(api, "pipeline", SimpleNamespace(create_asset_generation_task=reject))
    request = api.GenerateAssetRequest(
        asset_id="scene",
        asset_type="scene",
        reference={
            "asset_type": "prop",
            "asset_id": "foreign",
            "variant_id": "variant",
        },
    )

    with pytest.raises(HTTPException) as error:
        api.generate_single_asset("project", request, BackgroundTasks())
    assert error.value.status_code == 400


def test_explicit_upload_url_reference_mode_remains_compatible(tmp_path, monkeypatch):
    pipeline, target = _pipeline_with_assets(tmp_path)
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.runtime_uniart_for_owner",
        lambda *_args: {},
    )
    pipeline.asset_generator = Mock()
    _, task_id = pipeline.create_asset_generation_task(
        "project",
        target.id,
        "scene",
        reference_image_url="https://example.test/uploaded.png",
        image_generation_mode="reference",
    )
    assert pipeline.asset_generation_tasks[task_id]["params"]["reference"] is None
    pipeline.process_asset_generation_task(task_id)
    call = pipeline.asset_generator.generate_scene.call_args
    assert call.kwargs["reference_image_url"] == "https://example.test/uploaded.png"
    assert call.kwargs["reference_provenance"] is None


class _FakeImageModel:
    def __init__(self):
        self.calls = []

    def generate(self, prompt, output_path, **kwargs):
        self.calls.append((prompt, kwargs))
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"generated")
        return output_path, 0.01


@pytest.mark.parametrize(
    "asset,method,kwargs",
    [
        (
            Scene(id="scene", name="Tea room", description="wood table"),
            "generate_scene",
            {"positive_prompt": "cinematic", "prompt": "Chinese tea ceremony"},
        ),
        (
            Prop(id="prop", name="Tea cup", description="ceramic"),
            "generate_prop",
            {"positive_prompt": "product", "prompt": "blue and white tea cup"},
        ),
    ],
)
def test_scene_and_prop_generators_forward_reference_and_record_provenance(
    tmp_path, asset, method, kwargs
):
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    model = _FakeImageModel()
    generator._get_model_for = lambda _model_name: model
    reference_path = tmp_path / "reference.png"
    reference_path.write_bytes(b"reference")
    getattr(generator, method)(
        asset,
        batch_size=1,
        model_name="test-image-model",
        reference_image_url=str(reference_path),
        reference_provenance={
            "asset_type": "character",
            "asset_id": "character-1",
            "variant_id": "character-variant-1",
        },
        **kwargs,
    )
    assert model.calls[0][1]["ref_image_path"] == str(reference_path)
    variants = asset.image_asset.variants
    assert variants[0].reference_asset_type == "character"
    assert variants[0].reference_asset_id == "character-1"
    assert variants[0].reference_variant_id == "character-variant-1"


@pytest.mark.parametrize("generation_type", ["full_body", "three_view", "headshot"])
def test_character_generators_use_explicit_reference_for_each_generation_mode(
    tmp_path, generation_type
):
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    model = _FakeImageModel()
    generator._get_model_for = lambda _model_name: model
    reference_path = tmp_path / "reference.png"
    reference_path.write_bytes(b"reference")
    character = Character(id="character", name="Traveler", description="A traveler")

    generator.generate_character(
        character,
        generation_type=generation_type,
        prompt="keep the same person",
        batch_size=1,
        model_name="test-t2i",
        i2i_model_name="test-i2i",
        reference_image_url=str(reference_path),
        reference_provenance={
            "asset_type": "character",
            "asset_id": "reference-character",
            "variant_id": "reference-variant",
        },
    )

    assert model.calls, f"no provider call for generation_type={generation_type}"
    assert model.calls[0][1]["ref_image_path"] == str(reference_path)
    if generation_type == "full_body":
        variant = character.full_body_asset.variants[0]
    elif generation_type == "three_view":
        variant = character.three_view_asset.variants[0]
    else:
        variant = character.headshot_asset.variants[0]
    assert variant.reference_asset_type == "character"
    assert variant.reference_asset_id == "reference-character"
    assert variant.reference_variant_id == "reference-variant"


@pytest.mark.parametrize("model_name", ["wan2.6-image", "wan2.7-image"])
def test_wanx_image_model_routes_reference_input_to_image_edit_path(
    monkeypatch, tmp_path, model_name
):
    reference_path = tmp_path / "reference.png"
    reference_path.write_bytes(b"reference")
    calls = []
    model = WanxImageModel({})

    def fake_edit(prompt, size, n, negative_prompt, ref_image_paths, **_kwargs):
        calls.append((prompt, size, n, negative_prompt, ref_image_paths))
        return "https://example.test/result.png"

    monkeypatch.setattr(model, "_generate_wan26_image_http", fake_edit)
    monkeypatch.setattr(model, "_generate_dashscope_image_http", fake_edit)
    monkeypatch.setattr(model, "_download_image", lambda *_args: None)

    model.generate(
        "preserve the selected asset",
        str(tmp_path / "result.png"),
        model_name=model_name,
        ref_image_path=str(reference_path),
    )

    assert calls and calls[0][-1] == [str(reference_path)]
