import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api
from src.apps.comic_gen.pipeline import ComicGenPipeline, InvalidAssetName


def test_rename_updates_each_owner_without_changing_asset_identity():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    project_asset = SimpleNamespace(id="project-character", name="Original", character_design={"design_revisions": [{"revision": 1}]})
    project = SimpleNamespace(id="project")
    pipeline.scripts = {project.id: project}
    pipeline._find_asset_with_source = lambda *_: (project_asset, project)
    pipeline._save_after_asset_mutation = lambda *_: None

    library_asset = SimpleNamespace(id="library-character", name="Original")
    pipeline._find_library_asset = lambda *_: library_asset
    pipeline._save_library_data_unlocked = lambda: None

    series_asset = SimpleNamespace(id="series-character", name="Original")
    series = SimpleNamespace(updated_at=0)
    pipeline._find_series_asset = lambda *_: (series, series_asset)
    pipeline._save_series_data_unlocked = lambda: None

    pipeline.update_asset_attributes("project", project_asset.id, "character", {"name": "  苏砚  "})
    pipeline.update_library_asset("character", library_asset.id, {"name": "  发型参考  "})
    pipeline.update_series_asset_attributes("series", series_asset.id, "character", {"name": "  少年苏砚  "})

    assert (project_asset.id, project_asset.name) == ("project-character", "苏砚")
    assert (library_asset.id, library_asset.name) == ("library-character", "发型参考")
    assert (series_asset.id, series_asset.name) == ("series-character", "少年苏砚")
    assert project_asset.character_design["design_revisions"] == [{"revision": 1}]


@pytest.mark.parametrize("name", ["", "   ", None, "x" * 201])
def test_rename_rejects_invalid_names_before_mutation(name):
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    asset = SimpleNamespace(id="character", name="Original")
    project = SimpleNamespace(id="project")
    pipeline.scripts = {project.id: project}
    pipeline._find_asset_with_source = lambda *_: (asset, project)
    pipeline._save_after_asset_mutation = lambda *_: pytest.fail("Invalid name was saved")
    pipeline._find_library_asset = lambda *_: asset
    pipeline._save_library_data_unlocked = lambda: pytest.fail("Invalid name was saved")
    pipeline._find_series_asset = lambda *_: (SimpleNamespace(updated_at=0), asset)
    pipeline._save_series_data_unlocked = lambda: pytest.fail("Invalid name was saved")

    with pytest.raises(ValueError, match="Asset name"):
        pipeline.update_asset_attributes("project", asset.id, "character", {"name": name})
    with pytest.raises(ValueError, match="Asset name"):
        pipeline.update_library_asset("character", asset.id, {"name": name})
    with pytest.raises(ValueError, match="Asset name"):
        pipeline.update_series_asset_attributes("series", asset.id, "character", {"name": name})
    assert asset.name == "Original"


def test_rename_api_returns_validation_error_for_invalid_name(monkeypatch):
    def reject(*_args):
        raise InvalidAssetName("Asset name must be between 1 and 200 characters")

    monkeypatch.setattr(api.pipeline, "update_asset_attributes", reject)
    monkeypatch.setattr(api.pipeline, "update_series_asset_attributes", reject)
    monkeypatch.setattr(api.pipeline, "update_library_asset", reject)
    attributes = api.UpdateAssetAttributesRequest(asset_id="character", asset_type="character", attributes={"name": " "})
    for call in (
        lambda: api.update_asset_attributes("project", attributes),
        lambda: api.update_series_asset_attributes("series", attributes),
        lambda: api.update_library_asset("character", "character", api.UpdateLibraryAssetRequest(name=" ")),
    ):
        with pytest.raises(HTTPException) as error:
            call()
        assert error.value.status_code == 422
