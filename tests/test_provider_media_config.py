from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from src.apps.studio_access import signed_provider_media_url, verify_provider_media


@pytest.fixture(autouse=True)
def clean_config(monkeypatch):
    for name in ("PROVIDER_MEDIA_PUBLIC_BASE_URL", "UNIART_MEDIA_BASE_URL", "PROVIDER_MEDIA_URL_TTL_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-media-key")


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    path = tmp_path / "output" / "users" / ("a" * 24) / "playground" / "uploads" / "reference.jpg"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"reference")
    return path


def test_neutral_origin_and_lifetime_drive_signed_url(media, monkeypatch):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example.test/")
    monkeypatch.setenv("UNIART_MEDIA_BASE_URL", "https://legacy.example.test")
    monkeypatch.setenv("PROVIDER_MEDIA_URL_TTL_SECONDS", "7200")
    monkeypatch.setattr("src.apps.studio_access.time.time", lambda: 1000)
    url = signed_provider_media_url(str(media))
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "media.example.test"
    assert query["expires"] == ["8200"]
    assert verify_provider_media("a" * 24, "playground/uploads/reference.jpg", 8200, query["signature"][0]) == str(media)
    with pytest.raises(HTTPException) as error:
        verify_provider_media("a" * 24, "playground/uploads/reference.jpg", 8201, query["signature"][0])
    assert error.value.status_code == 401


def test_legacy_origin_and_default_lifetime_remain_supported(media, monkeypatch):
    monkeypatch.setenv("UNIART_MEDIA_BASE_URL", "https://legacy.example.test")
    monkeypatch.setattr("src.apps.studio_access.time.time", lambda: 1000)
    url = signed_provider_media_url(str(media))
    assert url.startswith("https://legacy.example.test/provider/media/")
    assert parse_qs(urlsplit(url).query)["expires"] == ["2800"]


@pytest.mark.parametrize("origin", ["", "https://user:password@example.test", "https://@example.test", "https://:@example.test", "https://example.test/path", "https://example.test?x=1", "https://example.test#x", "ftp://example.test", "https://example.test:bad", "https://example.test/a/..", "https://exa mple.test", "https://example.test\n.evil"])
def test_explicit_invalid_origin_never_uses_legacy(origin, media, monkeypatch):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", origin)
    monkeypatch.setenv("UNIART_MEDIA_BASE_URL", "https://legacy.example.test")
    with pytest.raises(ValueError, match="PROVIDER_MEDIA_PUBLIC_BASE_URL"):
        signed_provider_media_url(str(media))


@pytest.mark.parametrize("ttl", ["0", "-1", "1.5", "", "no"])
def test_invalid_lifetime_rejected(ttl, media, monkeypatch):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example.test")
    monkeypatch.setenv("PROVIDER_MEDIA_URL_TTL_SECONDS", ttl)
    with pytest.raises(ValueError, match="PROVIDER_MEDIA_URL_TTL_SECONDS"):
        signed_provider_media_url(str(media))


def test_uniart_adapter_uses_neutral_origin(media, monkeypatch):
    from src.models.uniart import _image_reference_url
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example.test")
    assert _image_reference_url(str(media)).startswith("https://media.example.test/provider/media/")


def test_missing_origin_keeps_local_publication_disabled(monkeypatch):
    from src.utils.provider_media_config import provider_media_origin
    assert provider_media_origin() is None


def test_uniart_retains_cloud_object_key_reads_with_local_origin(monkeypatch):
    from types import SimpleNamespace
    from src.models.uniart import _image_reference_url
    from src.utils import oss_utils
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example.test")
    monkeypatch.setattr(oss_utils, "is_object_key", lambda value: value == "lumenx/old.jpg")
    monkeypatch.setattr(oss_utils, "OSSImageUploader", lambda: SimpleNamespace(
        is_configured=True, sign_url_for_api=lambda key: f"https://bucket.example.test/{key}"))
    assert _image_reference_url("lumenx/old.jpg") == "https://bucket.example.test/lumenx/old.jpg"


def test_neutral_origin_preserves_file_containment(media, tmp_path, monkeypatch):
    monkeypatch.setenv("PROVIDER_MEDIA_PUBLIC_BASE_URL", "https://media.example.test")
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"private")
    media.unlink()
    media.symlink_to(outside)
    with pytest.raises(ValueError, match="owner-scoped"):
        signed_provider_media_url(str(media))
