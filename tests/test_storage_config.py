import pytest

from src.utils.storage_config import media_root, storage_backend


def test_media_root_defaults_to_output(monkeypatch):
    monkeypatch.delenv("IFRAME_MEDIA_ROOT", raising=False)
    assert media_root() == "output"


def test_media_root_expands_user_path(monkeypatch):
    monkeypatch.setenv("IFRAME_MEDIA_ROOT", "~/iframe-media")
    assert media_root().endswith("/iframe-media")


@pytest.mark.parametrize("value", ["local", "cos"])
def test_storage_backend_accepts_supported_values(monkeypatch, value):
    monkeypatch.setenv("IFRAME_STORAGE_BACKEND", value)
    assert storage_backend() == value


def test_storage_backend_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("IFRAME_STORAGE_BACKEND", "s3")
    with pytest.raises(ValueError, match="IFRAME_STORAGE_BACKEND"):
        storage_backend()
