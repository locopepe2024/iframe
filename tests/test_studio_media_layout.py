from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen import api
from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.audio import AudioGenerator
from src.apps.comic_gen.models import Prop, Scene
from src.apps.comic_gen.video import VideoGenerator
from src.apps.studio_access import studio_media_dir, studio_owner_key


def test_studio_media_dir_validates_owner_and_category():
    assert studio_media_dir("owner-1", "storyboard") == (
        f"output/users/{studio_owner_key('owner-1')}/studio/storyboard"
    )
    with pytest.raises(ValueError, match="owner profile"):
        studio_media_dir("", "storyboard")
    with pytest.raises(ValueError, match="category"):
        studio_media_dir("owner-1", "../storyboard")


def test_studio_writers_share_owner_root(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    owner = "owner-1"
    root = Path("output/users") / studio_owner_key(owner) / "studio"
    asset = SimpleNamespace(owner_profile_id=owner)
    frame = SimpleNamespace(owner_profile_id=owner)

    assert AssetGenerator()._output_dir_for(asset) == str(root / "assets")
    assert AudioGenerator()._output_dir_for(frame) == str(root / "audio")
    upload_path, stored_key = api._studio_upload_target(frame, "reference.png")
    assert upload_path == str(root / "uploads/reference.png")
    assert stored_key == str((root / "uploads/reference.png").relative_to("output"))


@pytest.mark.parametrize("asset_type,subdir", [("scene", "scenes"), ("prop", "props")])
def test_asset_image_writes_under_its_owner(monkeypatch, tmp_path, asset_type, subdir):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator()
    model = Mock()

    def generate(_prompt, path, **_kwargs):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"image")
        return path, 0

    model.generate.side_effect = generate
    generator._get_model_for = Mock(return_value=model)
    asset_class = Scene if asset_type == "scene" else Prop
    asset = asset_class(id=f"{asset_type}-1", name="Test", description="Reference",
                        owner_profile_id="owner-1")

    getattr(generator, f"generate_{asset_type}")(asset, prompt="A clear reference")

    key = asset.image_asset.variants[0].url
    assert key.startswith(f"users/{studio_owner_key('owner-1')}/studio/assets/{subdir}/")
    assert (tmp_path / "output" / key).read_bytes() == b"image"


def test_motion_reference_writes_to_owner_video_dir(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    generator = VideoGenerator()
    generator.model = Mock()

    def generate(**kwargs):
        Path(kwargs["output_path"]).write_bytes(b"video")
        return kwargs["output_path"], None

    generator.model.generate.side_effect = generate
    monkeypatch.setattr("src.utils.oss_utils.OSSImageUploader", lambda: SimpleNamespace(is_configured=False))

    result = generator.generate_i2v("https://example.com/reference.png", "slow pan", owner_profile_id="owner-1")

    assert result["video_url"].startswith(f"users/{studio_owner_key('owner-1')}/studio/video/")
    assert (tmp_path / "output" / result["video_url"]).read_bytes() == b"video"
