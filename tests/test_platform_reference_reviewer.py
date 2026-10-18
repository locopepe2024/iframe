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
