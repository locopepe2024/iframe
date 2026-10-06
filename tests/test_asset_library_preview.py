from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image


def test_asset_library_preview_is_owner_scoped_and_cached(monkeypatch, tmp_path):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    source = tmp_path / "source.png"
    Image.new("RGB", (1200, 800), "red").save(source)
    owner = UserContext("owner", "owner", "Owner", "")
    other = UserContext("other", "other", "Other", "")
    asset = SimpleNamespace(
        id="scene-1", variants=[SimpleNamespace(id="variant-1", url=str(source), created_at=1)],
    )
    monkeypatch.setattr(api.pipeline, "_library_list_for_type", lambda kind, profile: [asset] if kind == "scene" and profile == "owner" else [])
    monkeypatch.setattr(api.pipeline, "_asset_image_variants", lambda item, _kind: item.variants)
    monkeypatch.setattr(api.pipeline, "_resolve_stored_reference_value", lambda value, _owner: value)
    monkeypatch.setattr(api, "studio_owner_dir", lambda profile: str(tmp_path / profile))
    monkeypatch.setattr(api, "_resolve_request_context", lambda *_args: (owner, False))
    api.app.dependency_overrides[require_studio_user] = lambda: owner
    params = {"scope": "global", "asset_type": "scene", "asset_id": "scene-1", "variant_id": "variant-1"}
    try:
        with TestClient(api.app) as client:
            first = client.get("/asset-index/preview", params=params)
            assert first.status_code == 200
            assert first.headers["content-type"] == "image/webp"
            from io import BytesIO
            with Image.open(BytesIO(first.content)) as image:
                assert image.size == (320, 213)
            assert client.get("/asset-index/preview", params={**params, "variant_id": "missing"}).status_code == 404
            from src.utils import asset_previews
            monkeypatch.setattr(asset_previews, "create_media_thumbnail", lambda *_args: (_ for _ in ()).throw(AssertionError("cache miss")))
            second = client.get("/asset-index/preview", params=params)
            assert second.status_code == 200
            assert second.content == first.content
            api.app.dependency_overrides[require_studio_user] = lambda: other
            assert client.get("/asset-index/preview", params=params).status_code == 404
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)
