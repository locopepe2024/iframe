import json

import pytest

from src.apps.workbench_templates import list_workbench_templates


def test_imported_templates_are_media_free_and_searchable():
    catalog = list_workbench_templates()
    assert len(catalog["templates"]) == 8
    assert all(item["media"] == [] for item in catalog["templates"])
    assert {item["station"] for item in list_workbench_templates(station="scene")["templates"]} == {"scene"}
    assert [item["template_id"] for item in list_workbench_templates(query="首尾帧")["templates"]] == [
        "open-ai-canvas:drama-first-last-frame"
    ]
    assert list_workbench_templates(query="无匹配内容")["templates"] == []


def test_catalog_rejects_embedded_media_and_duplicate_ids(tmp_path):
    catalog = list_workbench_templates()
    catalog["templates"][0]["media"] = ["https://example.invalid/image.jpg"]
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    with pytest.raises(ValueError, match="media-free"):
        list_workbench_templates(path=path)
    catalog["templates"][0]["media"] = []
    catalog["templates"][1]["template_id"] = catalog["templates"][0]["template_id"]
    path.write_text(json.dumps(catalog), encoding="utf-8")
    with pytest.raises(ValueError, match="identity"):
        list_workbench_templates(path=path)


def test_invalid_station_is_rejected():
    with pytest.raises(ValueError, match="station"):
        list_workbench_templates(station="platform_asset")
