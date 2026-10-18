import json

import pytest

from src.apps.platform_reference_catalog import list_resources


def _manifest(tmp_path, resources):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"schema_version": 1, "catalog_revision": "r1", "resources": resources}), encoding="utf-8")
    return path


def _resource(**overrides):
    value = {
        "platform_resource_id": "style.cinematic.v1",
        "revision": 1,
        "kind": "style",
        "title": "Cinematic Realism",
        "summary": "写实电影质感",
        "tags": ["film"],
        "status": "active",
        "provenance": {"license": "MIT", "content_sha256": "a" * 64},
    }
    value.update(overrides)
    return value


def test_catalog_returns_only_active_and_supports_structured_search(tmp_path):
    path = _manifest(tmp_path, [_resource(), _resource(platform_resource_id="old", status="retired")])
    result = list_resources(query="电影", path=path)
    assert result["scope"] == "platform_shared"
    assert [item["platform_resource_id"] for item in result["resources"]] == ["style.cinematic.v1"]


def test_catalog_requires_license_and_content_hash(tmp_path):
    path = _manifest(tmp_path, [_resource(provenance={"license": "MIT"})])
    with pytest.raises(ValueError, match="content_sha256"):
        list_resources(path=path)
