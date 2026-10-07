from src.apps.media_reference import normalize_managed_media_reference


def test_normalizes_absolute_managed_delivery_url():
    assert normalize_managed_media_reference(
        "https://garage.example/playground/input-media/a.png?expires=1"
    ) == "/playground/input-media/a.png?expires=1"


def test_keeps_relative_managed_path_and_rejects_external_url():
    assert normalize_managed_media_reference("/studio/media/key/file.png") == "/studio/media/key/file.png"
    assert normalize_managed_media_reference("https://cdn.example/file.png") is None
