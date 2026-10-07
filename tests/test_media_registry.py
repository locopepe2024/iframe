def test_media_registry_is_owner_scoped_and_idempotent(tmp_path, monkeypatch):
    from src.apps import media_registry

    monkeypatch.chdir(tmp_path)
    first = media_registry.register_media("owner", "users/owner/uploads/a.png", kind="temporary_input")
    again = media_registry.register_media("owner", "users/owner/uploads/a.png", kind="temporary_input")
    assert first == again
    assert media_registry.get_media("owner", first)["storage_key"] == "users/owner/uploads/a.png"
    assert media_registry.get_media("other", first) is None
