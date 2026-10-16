def test_green_a_reference_uses_custom_root(monkeypatch, tmp_path):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example")
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-key")
    path = tmp_path / "media" / "users" / ("a" * 24) / "studio" / "uploads" / "image.jpg"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"image")
    from src.models.nsfw_new_one import _reference_url
    assert _reference_url(str(path)).startswith("https://media.example/provider/media/")


def test_uniart_reference_uses_custom_root(monkeypatch, tmp_path):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example")
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-key")
    path = tmp_path / "media" / "users" / ("b" * 24) / "studio" / "uploads" / "image.jpg"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"image")
    from src.models.uniart import _image_reference_url
    assert _image_reference_url(str(path)).startswith("https://media.example/provider/media/")
