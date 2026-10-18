import json

from src.apps.platform_reference_catalog import configured_reviewer_identity, promote_resource, reviewer_is_authorized


def test_host_config_key_authorizes_matching_api_key_identity(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"UNIART_API_KEY": "secret-key"}), encoding="utf-8")
    identity = configured_reviewer_identity(config)
    assert identity and identity.startswith("apikey-")
    assert reviewer_is_authorized(identity, config)
    assert not reviewer_is_authorized("apikey-" + "0" * 64, config)


def test_backend_promotion_records_identity_without_secret(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "resources": [{
        "platform_resource_id": "style.card.v1", "revision": 1, "kind": "style", "title": "Card",
        "status": "candidate", "provenance": {"license": "MIT", "content_sha256": "a" * 64},
    }]}), encoding="utf-8")
    resource = promote_resource("style.card.v1", "apikey-" + "b" * 64, "a" * 64, manifest)
    assert resource["status"] == "active"
    assert "secret" not in manifest.read_text(encoding="utf-8")


def test_default_reviewer_config_uses_iframe_data_dir(monkeypatch, tmp_path):
    data_dir = tmp_path / ".iframe"
    data_dir.mkdir()
    (data_dir / "config.json").write_text(
        json.dumps({"UNIART_API_KEY": "host-key"}), encoding="utf-8"
    )
    monkeypatch.setenv("IFRAME_DATA_DIR", str(data_dir))
    identity = configured_reviewer_identity()
    assert identity == configured_reviewer_identity(data_dir / "config.json")


def test_host_iframe_key_file_is_supported(tmp_path):
    key_file = tmp_path / ".iframe"
    key_file.write_text("api_key=host-key\n", encoding="utf-8")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"UNIART_API_KEY": "host-key"}), encoding="utf-8")
    assert configured_reviewer_identity(key_file) == configured_reviewer_identity(config)


def test_mounted_reviewer_key_file_is_supported(tmp_path):
    mounted = tmp_path / "iframe-review-key"
    mounted.write_text("api_key=host-key\n", encoding="utf-8")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"UNIART_API_KEY": "host-key"}), encoding="utf-8")
    assert configured_reviewer_identity(mounted) == configured_reviewer_identity(config)


def test_review_queue_lists_only_unpublished_candidates(tmp_path):
    from src.apps.platform_reference_catalog import list_review_candidates
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "catalog_revision": "r1", "resources": [
        {"platform_resource_id": "candidate", "revision": 1, "kind": "style", "title": "Candidate", "status": "candidate", "provenance": {"license": "MIT", "content_sha256": "a" * 64}},
        {"platform_resource_id": "active", "revision": 1, "kind": "style", "title": "Active", "status": "active", "provenance": {"license": "MIT", "content_sha256": "b" * 64}},
    ]}), encoding="utf-8")
    result = list_review_candidates(path=manifest)
    assert [item["platform_resource_id"] for item in result["resources"]] == ["candidate"]


def test_runtime_manifest_seeds_from_packaged_then_persists_review(monkeypatch, tmp_path):
    import src.apps.platform_reference_catalog as catalog
    packaged = tmp_path / "packaged.json"
    packaged.write_text(json.dumps({"schema_version": 1, "catalog_revision": "r1", "resources": [{
        "platform_resource_id": "style.card.v1", "revision": 1, "kind": "style", "title": "Card",
        "status": "candidate", "provenance": {"license": "MIT", "content_sha256": "a" * 64},
    }]}), encoding="utf-8")
    runtime = tmp_path / "output" / "platform_reference_catalog" / "manifest.json"
    monkeypatch.setattr(catalog, "MANIFEST_PATH", runtime)
    monkeypatch.setattr(catalog, "PACKAGED_MANIFEST_PATH", packaged)
    assert catalog.list_review_candidates(path=runtime)["resources"][0]["status"] == "candidate"
    catalog.promote_resource("style.card.v1", "apikey-reviewer", "a" * 64, runtime)
    assert catalog.list_resources(path=runtime)["resources"][0]["status"] == "active"
    assert json.loads(packaged.read_text())["resources"][0]["status"] == "candidate"
