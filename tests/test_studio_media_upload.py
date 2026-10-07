from io import BytesIO
import json
from types import SimpleNamespace

from fastapi import UploadFile

from src.apps.comic_gen import api
from src.apps.identity import UserContext
from src.apps.media_registry import get_media
from src.apps.studio_access import studio_owner_key


def test_video_upload_registers_owner_media_and_returns_studio_reference(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(api, "OSSImageUploader", lambda: SimpleNamespace(
        is_configured=False,
        upload_file=lambda *_args, **_kwargs: None,
    ))
    user = UserContext("user", "owner-profile", "Owner", "")
    upload = UploadFile(filename="motion.mp4", file=BytesIO(b"video-bytes"))

    response = api.upload_file(upload, user)
    result = json.loads(response.body.decode())
    assert result["url"] == result["storage_key"]
    assert result["storage_key"].startswith(f"users/{studio_owner_key(user.owner_profile_id)}/studio/uploads/")
    assert result["storage_key"].endswith(".mp4")
    assert result["media_id"]
    stored_file = tmp_path / "output" / result["storage_key"]
    assert stored_file.read_bytes() == b"video-bytes"
    record = get_media(user.owner_profile_id, result["media_id"])
    assert record["storage_key"] == result["storage_key"]
