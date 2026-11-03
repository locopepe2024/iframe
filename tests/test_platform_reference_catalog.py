import json
import hashlib
import io

from PIL import Image

import pytest

from src.apps.platform_reference_catalog import list_resources
from src.apps import platform_reference_catalog as catalog


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


def test_open_pose_pack_is_searchable_and_has_stable_image_id():
    resources = catalog._open_pose_resources()
    assert len(resources) == 5975
    sample = next(item for item in resources.values() if item["category_path"] == "reference/pose")
    assert catalog.platform_resource_by_id(sample["platform_resource_id"]) == sample
    assert sample in list_resources(query=sample["title"], kind="image")["resources"]
    with pytest.raises(ValueError, match="revision changed"):
        catalog.resolve_active_visual_reference(sample["platform_resource_id"], sample["revision"] + 1)


def test_runtime_retirement_hides_packed_reference(tmp_path, monkeypatch):
    sample = next(iter(catalog._open_pose_resources().values()))
    manifest = _manifest(tmp_path, [{**sample, "status": "retired"}])
    monkeypatch.setattr(catalog, "MANIFEST_PATH", manifest)
    assert catalog.platform_resource_by_id(sample["platform_resource_id"])["status"] == "retired"
    assert sample["platform_resource_id"] not in {
        item["platform_resource_id"] for item in list_resources(path=manifest)["resources"]
    }
    with pytest.raises(ValueError, match="unavailable"):
        catalog.resolve_active_visual_reference(sample["platform_resource_id"], sample["revision"])


def test_remote_image_is_checked_and_cached_only_when_selected(tmp_path, monkeypatch):
    image = Image.new("RGB", (4, 4), "white")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    content = stream.getvalue()
    resource = {"platform_resource_id": "iframe.opc.test", "revision": 1,
                "payload": {"remote_url": "https://ai-pose-gallery.pages.dev/test.png",
                            "media_sha256": hashlib.sha256(content).hexdigest()}}
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(request.full_url)
            return io.BytesIO(content)

    monkeypatch.setattr(catalog, "build_opener", lambda *_: Opener())
    manifest = tmp_path / "manifest.json"
    path = catalog._materialize_remote_image(resource, manifest)
    assert path.read_bytes() == content
    assert catalog._materialize_remote_image(resource, manifest) == path
    assert calls == [resource["payload"]["remote_url"]]
    path.write_bytes(b"corrupted")
    assert catalog._materialize_remote_image(resource, manifest).read_bytes() == content
    assert len(calls) == 2
    resource["payload"]["media_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="hash"):
        catalog._materialize_remote_image(resource, manifest)


@pytest.mark.parametrize("url", [
    "http://ai-pose-gallery.pages.dev/test.png",
    "https://ai-pose-gallery.pages.dev:8080/test.png",
    "https://example.com/test.png",
    "https://ai-pose-gallery.pages.dev/test.svg",
])
def test_remote_image_url_rejects_untrusted_origins(url):
    with pytest.raises(ValueError, match="origin"):
        catalog._remote_image_url(url)
