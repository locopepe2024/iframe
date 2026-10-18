import json

import pytest

from scripts.promote_platform_reference_candidate import promote, reviewer_from_api_key, reviewer_from_iframe_config


def _manifest(tmp_path, status="candidate"):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "catalog_revision": "r1",
        "resources": [{
            "platform_resource_id": "style.card.v1",
            "revision": 1,
            "kind": "style",
            "title": "Card",
            "status": status,
            "provenance": {"license": "MIT", "content_sha256": "a" * 64},
        }],
    }), encoding="utf-8")
    return path


def test_promote_records_review_and_hash(tmp_path):
    path = _manifest(tmp_path)
    resource = promote(path, "style.card.v1", "release-bot", "a" * 64)
    assert resource["status"] == "active"
    assert resource["review"]["reviewer"] == "release-bot"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["resources"][0]["review"]["content_sha256"] == "a" * 64


def test_promote_rejects_hash_mismatch_and_non_candidate(tmp_path):
    path = _manifest(tmp_path)
    with pytest.raises(ValueError, match="hash"):
        promote(path, "style.card.v1", "release-bot", "b" * 64)
    active = _manifest(tmp_path, status="active")
    with pytest.raises(ValueError, match="not a candidate"):
        promote(active, "style.card.v1", "release-bot")


def test_api_key_reviewer_is_one_way_identity():
    reviewer = reviewer_from_api_key("secret-key")
    assert reviewer.startswith("apikey-")
    assert len(reviewer) == len("apikey-") + 64
    assert "secret-key" not in reviewer


def test_iframe_config_key_is_hashed_without_persisting_secret(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"providers": {"UNIART_API_KEY": "secret-key"}}), encoding="utf-8")
    reviewer = reviewer_from_iframe_config(config)
    assert reviewer == reviewer_from_api_key("secret-key")
    assert "secret-key" not in reviewer
