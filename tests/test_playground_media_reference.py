from pathlib import Path

from src.apps.playground.storage import PlaygroundStorage


def test_resolves_owner_scoped_input_media_reference(tmp_path):
    storage = PlaygroundStorage(
        owner_user_id="user-1",
        owner_profile_id="profile-1",
        history_path=str(tmp_path / "history.json"),
        templates_path=str(tmp_path / "templates.json"),
        sessions_path=str(tmp_path / "sessions.json"),
    )
    upload_dir = Path(storage.output_dir) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    source = upload_dir / "reference.png"
    source.write_bytes(b"png")

    assert storage.resolve_media_reference("/playground/input-media/reference.png") == str(source)


def test_rejects_path_traversal_in_input_media_reference(tmp_path):
    storage = PlaygroundStorage(
        owner_user_id="user-1",
        owner_profile_id="profile-1",
        history_path=str(tmp_path / "history.json"),
        templates_path=str(tmp_path / "templates.json"),
        sessions_path=str(tmp_path / "sessions.json"),
    )

    try:
        storage.resolve_media_reference("/playground/input-media/../secret.png")
    except ValueError as exc:
        assert "Invalid" in str(exc)
    else:
        raise AssertionError("expected traversal reference to be rejected")
