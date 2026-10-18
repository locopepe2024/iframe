import json

import pytest

from src.apps.platform_reference_catalog import list_resources


def test_active_skill_cards_are_not_visual_assets(tmp_path):
    import json
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "resources": [
        {"platform_resource_id": "method", "revision": 1, "kind": "style", "title": "Six blocks", "status": "active", "payload": {"source_metadata": {"skill_type": "template"}}, "provenance": {"license": "MIT", "content_sha256": "a" * 64}},
        {"platform_resource_id": "visual", "revision": 1, "kind": "style", "title": "Visual style", "status": "active", "definition": {"palette": "blue"}, "provenance": {"license": "MIT", "content_sha256": "b" * 64}},
    ]}), encoding="utf-8")
    assert [item["platform_resource_id"] for item in list_resources(path=manifest)["resources"]] == ["visual"]


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
