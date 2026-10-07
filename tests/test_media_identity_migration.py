import json

from scripts.migrate_media_identity import migrate_store, storage_key


def test_media_identity_migration_plans_variant_registration(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    output = tmp_path / "output"
    output.mkdir()
    (output / "hero.png").write_bytes(b"image")
    store = output / "projects.json"
    store.write_text(json.dumps({"episode": {
        "owner_profile_id": "owner",
        "characters": [{"id": "hero", "name": "Hero", "reference_sheet": {
            "image_variants": [{"id": "variant-1", "url": "hero.png"}]
        }}],
    }}))
    report = {"registered": 0, "migrated": 0, "pending": 0, "rejected": [], "plans": []}
    migrate_store(store, output, True, report)
    data = report["plans"][0][2]
    variant = data["episode"]["characters"][0]["reference_sheet"]["image_variants"][0]
    assert variant["storage_key"] == "hero.png"
    assert variant["media_id"] == "pending:hero.png"

    assert report["rejected"] == []


def test_storage_key_accepts_owned_cos_locator_but_rejects_external_url(tmp_path):
    assert storage_key(
        "https://bucket.cos.ap-tokyo.myqcloud.com/lumenx/a.png?signature=expired",
        tmp_path,
    ) == "lumenx/a.png"
    assert storage_key("https://example.com/a.png", tmp_path) is None
