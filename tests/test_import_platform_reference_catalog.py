import json

from scripts.import_platform_reference_catalog import import_candidates


def test_importer_creates_candidate_with_provenance(tmp_path):
    source = tmp_path / "canvas"
    card = source / "backend/builtin/freestyle-风格库/cards"
    card.mkdir(parents=True)
    (card / "style.md").write_text(
        "---\nname: style-card\nsource_license: MIT\nsource_url: https://example.test/style\ntags: [film, style]\n---\n\n# Style\n",
        encoding="utf-8",
    )
    allowlist = tmp_path / "allowlist.json"
    allowlist.write_text(json.dumps([{"path": "backend/builtin/freestyle-风格库/cards/style.md", "kind": "style", "expected_license": "MIT"}], ensure_ascii=False), encoding="utf-8")
    result = import_candidates(source, allowlist, tmp_path / "manifest.json")
    item = result["resources"][0]
    assert item["status"] == "candidate"
    assert item["provenance"]["license"] == "MIT"
    assert len(item["provenance"]["content_sha256"]) == 64


def test_importer_rejects_license_mismatch(tmp_path):
    source = tmp_path / "canvas"
    source.mkdir()
    card = source / "card.md"
    card.write_text("---\nname: card\nsource_license: Apache-2.0\n---\nbody\n", encoding="utf-8")
    allowlist = tmp_path / "allowlist.json"
    allowlist.write_text(json.dumps([{"path": "card.md", "kind": "style", "expected_license": "MIT"}]), encoding="utf-8")
    try:
        import_candidates(source, allowlist, tmp_path / "manifest.json")
    except ValueError as exc:
        assert "license mismatch" in str(exc)
    else:
        raise AssertionError("expected license mismatch")


def test_importer_increments_revision_when_source_changes(tmp_path):
    source = tmp_path / "canvas"
    source.mkdir()
    card = source / "card.md"
    card.write_text("---\nname: card\nsource_license: MIT\n---\nv1\n", encoding="utf-8")
    allowlist = tmp_path / "allowlist.json"
    allowlist.write_text(json.dumps([{"path": "card.md", "kind": "style", "expected_license": "MIT"}]), encoding="utf-8")
    manifest = tmp_path / "manifest.json"
    first = import_candidates(source, allowlist, manifest)
    manifest.write_text(json.dumps(first), encoding="utf-8")
    card.write_text("---\nname: card\nsource_license: MIT\n---\nv2\n", encoding="utf-8")
    second = import_candidates(source, allowlist, manifest)
    assert second["resources"][0]["revision"] == 2
