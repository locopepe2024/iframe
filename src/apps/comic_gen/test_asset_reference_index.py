import os
import sys
import threading

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from src.apps.comic_gen.models import (
    AssetUnit,
    Character,
    GlobalAssetLibrary,
    ImageAsset,
    ImageVariant,
    Prop,
    Scene,
    Script,
    Series,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _variant(variant_id: str, url: str) -> ImageVariant:
    return ImageVariant(id=variant_id, url=url)


def _character(asset_id: str, name: str, variant_id: str) -> Character:
    return Character(
        id=asset_id,
        name=name,
        description=name,
        reference_sheet=AssetUnit(
            selected_image_id=variant_id,
            image_variants=[_variant(variant_id, f"{variant_id}.png")],
        ),
    )


def _scene(asset_id: str, name: str, variant_id: str) -> Scene:
    return Scene(
        id=asset_id,
        name=name,
        description=name,
        image_asset=ImageAsset(
            selected_id=variant_id,
            variants=[_variant(variant_id, f"{variant_id}.png")],
        ),
    )


def _prop(asset_id: str, name: str, variant_id: str) -> Prop:
    return Prop(
        id=asset_id,
        name=name,
        description=name,
        image_asset=ImageAsset(
            selected_id=variant_id,
            variants=[_variant(variant_id, f"{variant_id}.png")],
        ),
    )


def _pipeline(project: Script, series: Series, library: GlobalAssetLibrary) -> ComicGenPipeline:
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {project.id: project}
    pipeline.series_store = {series.id: series}
    pipeline.library_store = library
    pipeline._save_lock = threading.RLock()
    return pipeline


def test_asset_reference_index_normalizes_scope_precedence_and_variants():
    project = Script(
        id="episode",
        title="Episode",
        original_text="text",
        series_id="series",
        characters=[_character("shared", "Episode actor", "episode-view")],
        created_at=0,
        updated_at=0,
    )
    series = Series(
        id="series",
        title="Series",
        characters=[
            _character("shared", "Shadowed series actor", "series-shadow"),
            _character("series-actor", "Series actor", "series-view"),
        ],
        scenes=[_scene("series-scene", "Series scene", "scene-view")],
        created_at=0,
        updated_at=0,
    )
    library = GlobalAssetLibrary(
        characters=[_character("shared", "Shadowed global actor", "global-shadow")],
        props=[_prop("global-prop", "Global prop", "prop-view")],
    )

    index = _pipeline(project, series, library).get_asset_reference_index("episode")

    assert index.schema_version == 1
    assert index.project_id == "episode"
    assert [(item.asset_type, item.asset_id) for item in index.assets] == [
        ("character", "shared"),
        ("character", "series-actor"),
        ("scene", "series-scene"),
        ("prop", "global-prop"),
    ]
    by_id = {item.asset_id: item for item in index.assets}
    assert by_id["shared"].source_scope == "episode"
    assert by_id["shared"].source_container_id == "episode"
    assert by_id["shared"].selected_variant_id == "episode-view"
    assert [item.id for item in by_id["shared"].variants] == ["episode-view"]
    assert by_id["series-actor"].source_scope == "series"
    assert by_id["series-actor"].source_container_id == "series"
    assert by_id["global-prop"].source_scope == "global"
    assert by_id["global-prop"].source_container_id is None


def test_asset_reference_index_keeps_legacy_character_variants_readable():
    legacy = Character(
        id="legacy",
        name="Legacy",
        description="Legacy",
        reference_sheet=AssetUnit(),
        full_body_asset=ImageAsset(
            selected_id="legacy-full",
            variants=[_variant("legacy-full", "legacy.png")],
        ),
    )
    project = Script(
        id="episode",
        title="Episode",
        original_text="text",
        characters=[legacy],
        created_at=0,
        updated_at=0,
    )
    series = Series(id="unused", title="Unused", created_at=0, updated_at=0)

    index = _pipeline(project, series, GlobalAssetLibrary()).get_asset_reference_index("episode")

    assert index.assets[0].selected_variant_id == "legacy-full"
    assert [item.id for item in index.assets[0].variants] == ["legacy-full"]


def test_asset_library_index_projects_each_owned_container_without_effective_scope_shadowing():
    project = Script(
        id="standalone",
        title="Standalone",
        original_text="text",
        owner_profile_id="owner",
        props=[_prop("watch", "Project watch", "project-watch")],
        created_at=0,
        updated_at=0,
    )
    project.props[0].owner_profile_id = "owner"
    series = Series(
        id="series",
        title="Series",
        owner_profile_id="owner",
        characters=[_character("actor", "Series actor", "series-actor")],
        created_at=0,
        updated_at=0,
    )
    series.characters[0].owner_profile_id = "owner"
    global_scene = _scene("stage", "Global stage", "global-stage")
    global_scene.owner_profile_id = "owner"

    index = _pipeline(project, series, GlobalAssetLibrary(scenes=[global_scene])).get_asset_library_reference_index("owner")

    assert [(item.source_scope, item.source_container_id, item.source_name, item.asset_id) for item in index.assets] == [
        ("series", "series", "Series", "actor"),
        ("project", "standalone", "Standalone", "watch"),
        ("global", None, None, "stage"),
    ]
    assert index.assets[1].selected_variant_id == "project-watch"


def test_asset_reference_index_api_is_owner_scoped(monkeypatch):
    from fastapi.testclient import TestClient

    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    user = UserContext("owner", "owner", "Owner", "")
    project = Script(
        id="owned-project",
        title="Owned",
        original_text="text",
        owner_user_id="owner",
        owner_profile_id="owner",
        characters=[_character("actor", "Actor", "actor-view")],
        created_at=0,
        updated_at=0,
    )
    pipeline = _pipeline(
        project,
        Series(id="unused", title="Unused", created_at=0, updated_at=0),
        GlobalAssetLibrary(),
    )
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "_resolve_request_context", lambda *_args: (user, False))
    api.app.dependency_overrides[require_studio_user] = lambda: user
    try:
        with TestClient(api.app) as client:
            response = client.get("/projects/owned-project/asset-index")
            assert response.status_code == 200
            assert response.json() == {
                "schema_version": 1,
                "project_id": "owned-project",
                "assets": [{
                    "asset_type": "character",
                    "asset_id": "actor",
                    "name": "Actor",
                    "description": "Actor",
                    "starred": False,
                    "source_scope": "episode",
                    "source_container_id": "owned-project",
                    "source_name": "Owned",
                    "selected_variant_id": "actor-view",
                    "variants": [project.characters[0].reference_sheet.image_variants[0].model_dump()],
                }],
            }
            assert client.get("/projects/missing/asset-index").status_code == 404
            library_response = client.get("/asset-index")
            assert library_response.status_code == 200
            library_assets = library_response.json()["assets"]
            assert [(item["source_scope"], item["asset_id"]) for item in library_assets] == [
                ("project", "actor"),
            ]
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)
