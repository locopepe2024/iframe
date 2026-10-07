def test_media_registry_is_owner_scoped_and_idempotent(tmp_path, monkeypatch):
    from src.apps import media_registry

    monkeypatch.chdir(tmp_path)
    first = media_registry.register_media("owner", "users/owner/uploads/a.png", kind="temporary_input")
    again = media_registry.register_media("owner", "users/owner/uploads/a.png", kind="temporary_input")
    assert first == again
    assert media_registry.get_media("owner", first)["storage_key"] == "users/owner/uploads/a.png"
    assert media_registry.get_media("other", first) is None
    assert [item["media_id"] for item in media_registry.list_media("owner", display_name="")] == [first]

    named = media_registry.register_media(
        "owner", "users/owner/assets/hero.png", kind="asset_variant", display_name="Hero",
    )
    matches = media_registry.list_media("owner", display_name="Hero", kind="asset_variant")
    assert [item["media_id"] for item in matches] == [named]
    assert matches[0]["storage_key"] == "users/owner/assets/hero.png"
