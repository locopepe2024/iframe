import json

from scripts.migrate_media_identity import migrate_store
from src.apps.media_registry import get_media


def test_media_identity_migration_registers_variants_and_is_idempotent(tmp_path, monkeypatch):
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
    report = {"registered": 0, "migrated": 0, "pending": 0, "rejected": []}
    migrate_store(store, output, True, report)
    data = json.loads(store.read_text())
    variant = data["episode"]["characters"][0]["reference_sheet"]["image_variants"][0]
    assert variant["storage_key"] == "hero.png"
    assert variant["media_id"]
    assert get_media("owner", variant["media_id"])["storage_key"] == "hero.png"

    second = {"registered": 0, "migrated": 0, "pending": 0, "rejected": []}
    migrate_store(store, output, True, second)
    assert second["rejected"] == []
