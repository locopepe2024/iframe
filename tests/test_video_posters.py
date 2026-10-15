"""Local video poster behavior, with real FFmpeg coverage in media CI."""
import os
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from src.apps.user_config import UserContext
from src.apps.studio_access import require_studio_user, studio_owner_key
from src.utils.media_thumbnails import create_media_thumbnail
from src.utils.system_check import get_ffmpeg_path


@pytest.fixture(params=["mp4", "mov", "webm", "mkv"])
def video(tmp_path, request):
    tool = get_ffmpeg_path()
    if not tool:
        pytest.skip("FFmpeg required")
    source = tmp_path / f"a.{request.param}"
    def write(color):
        subprocess.run([tool, "-v", "error", "-f", "lavfi", "-i",
                        f"color={color}:s=640x360:d=0.1", "-threads", "1",
                        "-y", str(source)], check=True, capture_output=True, timeout=15)
    write("red")
    return source, write


def test_video_poster_pixels_cache_and_source_replacement(video, monkeypatch):
    source, write = video
    monkeypatch.setenv("FFMPEG_PATH", get_ffmpeg_path())
    first = create_media_thumbnail(str(source), str(source.parent), 320)
    with Image.open(first) as image:
        assert image.format == "WEBP"
        assert image.size == (320, 180)
        assert image.getpixel((100, 100))[0] > 200
    with patch("src.utils.media_thumbnails.subprocess.run", side_effect=AssertionError("cached")):
        assert create_media_thumbnail(str(source), str(source.parent), 320) == first
    write("blue")
    second = create_media_thumbnail(str(source), str(source.parent), 320)
    assert second != first
    with Image.open(second) as image:
        assert image.getpixel((100, 100))[2] > 200
    if os.name != "nt":
        assert Path(second).stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("area", ["studio", "playground"])
def test_owner_route_serves_video_still_and_original(video, tmp_path, monkeypatch, area):
    from src.apps.comic_gen.api import get_owned_studio_media, get_owned_playground_media
    source, _ = video
    monkeypatch.chdir(tmp_path)
    owner = UserContext(user_id="a", owner_profile_id="profile-a", display_name="a", access_token="")
    key = studio_owner_key(owner.owner_profile_id)
    target = Path("output") / "users" / key / area / source.name
    target.parent.mkdir(parents=True)
    shutil.copyfile(source, target)
    app = FastAPI()
    route = "/studio/owned-media" if area == "studio" else "/studio/owned-playground-media"
    app.add_api_route(route + "/{owner_key}/{relative_path:path}",
                     get_owned_studio_media if area == "studio" else get_owned_playground_media)
    app.dependency_overrides[require_studio_user] = lambda: owner
    with TestClient(app) as client:
        url = f"{route}/{key}/{source.name}"
        poster = client.get(url + "?preview=320")
        assert poster.status_code == 200
        assert poster.headers["content-type"] == "image/webp"
        assert poster.headers["cache-control"] == "private, no-store"
        from io import BytesIO
        with Image.open(BytesIO(poster.content)) as image:
            assert image.size == (320, 180)
        assert client.get(url).content == target.read_bytes()
        assert client.get(url.replace(key, studio_owner_key("foreign")) + "?preview=320").status_code == 404


def test_video_preview_rejects_owner_escape_before_running_tool(video, tmp_path):
    source, _ = video
    owner = tmp_path / "other"
    owner.mkdir()
    link = owner / "a.mp4"
    link.symlink_to(source)
    with patch("src.utils.media_thumbnails.subprocess.run") as run:
        with pytest.raises(ValueError, match="owner"):
            create_media_thumbnail(str(link), str(owner), 320)
        run.assert_not_called()


@pytest.mark.parametrize("failure", [subprocess.TimeoutExpired("ffmpeg", 20), subprocess.CalledProcessError(1, "ffmpeg")])
def test_video_failure_cleans_temporary_output(tmp_path, monkeypatch, failure):
    source = tmp_path / "broken.mp4"
    source.write_bytes(b"invalid video")
    monkeypatch.setattr("src.utils.media_thumbnails.get_ffmpeg_path", lambda: "/custom path/ffmpeg")
    with patch("src.utils.media_thumbnails.subprocess.run", side_effect=failure) as run:
        with pytest.raises(ValueError, match="Video preview"):
            create_media_thumbnail(str(source), str(tmp_path), 320)
    args = run.call_args.args[0]
    assert args[0] == "/custom path/ffmpeg"
    assert args[args.index("-protocol_whitelist") + 1] == "file"
    assert args[args.index("-f") + 1] == "mov"
    assert run.call_args.kwargs["timeout"] == 20
    assert not list(tmp_path.glob(".media-previews/*"))


def test_invalid_explicit_tool_does_not_fall_back(tmp_path, monkeypatch):
    source = tmp_path / "a.mp4"
    source.write_bytes(b"video")
    monkeypatch.setenv("FFMPEG_PATH", str(tmp_path / "missing"))
    with pytest.raises(ValueError, match="FFMPEG_PATH"):
        create_media_thumbnail(str(source), str(tmp_path), 320)
    assert not list(tmp_path.glob(".media-previews/*"))


def test_invalid_video_returns_controlled_route_error(tmp_path, monkeypatch):
    from src.apps.comic_gen.api import get_owned_studio_media
    if not get_ffmpeg_path():
        pytest.skip("FFmpeg required")
    monkeypatch.chdir(tmp_path)
    owner = UserContext(user_id="a", owner_profile_id="profile-a", display_name="a", access_token="")
    key = studio_owner_key(owner.owner_profile_id)
    target = Path("output") / "users" / key / "studio" / "broken.mp4"
    target.parent.mkdir(parents=True)
    # A misleading extension must not enable a playlist/network demuxer.
    target.write_text("#EXTM3U\nhttp://127.0.0.1:1/private\n")
    app = FastAPI()
    app.add_api_route("/media/{owner_key}/{relative_path:path}", get_owned_studio_media)
    app.dependency_overrides[require_studio_user] = lambda: owner
    with TestClient(app) as client:
        response = client.get(f"/media/{key}/broken.mp4?preview=320")
        assert response.status_code == 415
        assert response.json()["detail"] == "A supported image or video is required for preview"
    assert not list(target.parent.glob(".media-previews/*"))


def test_oversized_video_is_rejected_before_decode(tmp_path):
    from src.utils.media_thumbnails import MAX_VIDEO_PREVIEW_SOURCE_BYTES
    source = tmp_path / "oversized.mp4"
    with source.open("wb") as output:
        output.truncate(MAX_VIDEO_PREVIEW_SOURCE_BYTES + 1)
    with patch("src.utils.media_thumbnails.subprocess.run") as run:
        with pytest.raises(ValueError, match="size limits"):
            create_media_thumbnail(str(source), str(tmp_path), 320)
        run.assert_not_called()
