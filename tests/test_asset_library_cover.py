import threading

import pytest

from src.apps.comic_gen.models import (
    AssetUnit,
    Character,
    GlobalAssetLibrary,
    ImageAsset,
    ImageVariant,
    Prop,
    Scene,
    Script,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


def make_pipeline(asset, asset_type):
    project = Script(
        id="project-1",
        title="Cover test",
        original_text="text",
        created_at=0,
        updated_at=0,
        **{f"{asset_type}s": [asset]},
    )
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {project.id: project}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._save_lock = threading.RLock()
    pipeline._save_after_asset_mutation = lambda _source: None
    return pipeline, project


def test_cover_selection_accepts_any_character_container_and_keeps_category_selection():
    character = Character(
        id="character-1",
        name="Actor",
        description="Actor",
        reference_sheet=AssetUnit(
            selected_image_id="reference-1",
            image_variants=[ImageVariant(id="reference-1", url="reference.png")],
        ),
        full_body_asset=ImageAsset(
            selected_id="body-1",
            variants=[ImageVariant(id="body-1", url="body.png")],
        ),
    )
    pipeline, _project = make_pipeline(character, "character")

    result = pipeline.set_asset_cover_variant("project-1", "character-1", "character", "body-1")

    assert result["asset_type"] == "character"
    assert result["asset_id"] == "character-1"
    assert result["cover_variant_id"] == "body-1"
    assert result["variant"] == {"id": "body-1", "url": "body.png", "created_at": character.full_body_asset.variants[0].created_at}
    assert character.cover_variant_id == "body-1"
    assert character.reference_sheet.selected_image_id == "reference-1"
    assert character.full_body_asset.selected_id == "body-1"
    indexed = pipeline.get_asset_reference_index("project-1").assets[0]
    assert indexed.selected_variant_id == "reference-1"
    assert indexed.cover_variant_id == "body-1"
    project = pipeline.scripts["project-1"]
    pipeline.list_series = lambda *_args: []
    pipeline.list_scripts = lambda *_args: [project]
    library_index = pipeline.get_asset_library_reference_index().assets[0]
    assert library_index.selected_variant_id == "reference-1"
    assert library_index.cover_variant_id == "body-1"


@pytest.mark.parametrize(
    ("asset_type", "asset"),
    [
        ("scene", Scene(id="scene-1", name="Scene", description="Scene", image_asset=ImageAsset(
            selected_id="scene-1-v1", variants=[ImageVariant(id="scene-1-v1", url="scene.png")]
        ))),
        ("prop", Prop(id="prop-1", name="Prop", description="Prop", image_asset=ImageAsset(
            selected_id="prop-1-v1", variants=[ImageVariant(id="prop-1-v1", url="prop.png")]
        ))),
    ],
)
def test_scene_and_prop_cover_selection_is_persisted(asset_type, asset):
    pipeline, _project = make_pipeline(asset, asset_type)

    result = pipeline.set_asset_cover_variant("project-1", asset.id, asset_type, f"{asset_type}-1-v1")

    assert result["cover_variant_id"] == f"{asset_type}-1-v1"
    indexed = pipeline.get_asset_reference_index("project-1").assets[0]
    assert indexed.selected_variant_id == f"{asset_type}-1-v1"
    assert indexed.cover_variant_id == f"{asset_type}-1-v1"


def test_cover_selection_rejects_variant_not_owned_by_asset():
    character = Character(
        id="character-1",
        name="Actor",
        description="Actor",
        reference_sheet=AssetUnit(image_variants=[ImageVariant(id="reference-1", url="reference.png")]),
    )
    pipeline, _project = make_pipeline(character, "character")

    with pytest.raises(ValueError, match="Variant missing does not belong to asset"):
        pipeline.set_asset_cover_variant("project-1", "character-1", "character", "missing")

    assert getattr(character, "cover_variant_id", None) is None


def test_category_selection_does_not_override_explicit_library_cover():
    character = Character(
        id="character-1",
        name="Actor",
        description="Actor",
        cover_variant_id="body-1",
        reference_sheet=AssetUnit(
            selected_image_id="reference-1",
            image_variants=[ImageVariant(id="reference-1", url="reference.png")],
        ),
        full_body_asset=ImageAsset(
            selected_id="body-1",
            variants=[ImageVariant(id="body-1", url="body.png")],
        ),
    )
    pipeline, _project = make_pipeline(character, "character")

    pipeline.select_asset_variant("project-1", "character-1", "character", "reference-1", "reference_sheet")

    assert character.cover_variant_id == "body-1"
    indexed = pipeline.get_asset_reference_index("project-1").assets[0]
    assert indexed.selected_variant_id == "reference-1"
    assert indexed.cover_variant_id == "body-1"


def test_deleting_explicit_cover_clears_pointer_and_restores_valid_fallback():
    character = Character(
        id="character-1",
        name="Actor",
        description="Actor",
        cover_variant_id="body-1",
        reference_sheet=AssetUnit(
            selected_image_id="reference-1",
            image_variants=[ImageVariant(id="reference-1", url="reference.png")],
        ),
        full_body_asset=ImageAsset(
            selected_id="body-1",
            variants=[ImageVariant(id="body-1", url="body.png")],
        ),
    )
    pipeline, _project = make_pipeline(character, "character")

    pipeline.delete_asset_variant("project-1", "character-1", "character", "body-1")

    assert character.cover_variant_id is None
    assert pipeline.get_asset_reference_index("project-1").assets[0].selected_variant_id == "reference-1"


def test_cover_route_returns_compact_ack_without_loading_project(monkeypatch):
    from fastapi.responses import JSONResponse
    from src.apps.comic_gen import api

    result = {
        "asset_type": "character",
        "asset_id": "character-1",
        "cover_variant_id": "body-1",
        "variant": {"id": "body-1", "url": "body.png", "created_at": 1},
    }
    monkeypatch.setattr(api.pipeline, "set_asset_cover_variant", lambda *_args: result)
    monkeypatch.setattr(api, "get_project", lambda *_args: pytest.fail("cover update must not load full project"))
    monkeypatch.setattr(api, "signed_response", lambda value: JSONResponse(content=value))

    response = api.set_asset_cover(
        "project-1", "character", "character-1", api.SetAssetCoverRequest(variant_id="body-1")
    )

    assert response.headers["cache-control"] == "private, no-store"
    assert response.body == b'{"asset_type":"character","asset_id":"character-1","cover_variant_id":"body-1","variant":{"id":"body-1","url":"body.png","created_at":1}}'
