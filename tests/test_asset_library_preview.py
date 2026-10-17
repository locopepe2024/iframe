from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image
from fastapi import HTTPException
import pytest


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
    monkeypatch.setattr(api.pipeline, "output_root", str(tmp_path / "selected"))
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


def test_episode_asset_preview_works_inside_series(monkeypatch, tmp_path):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    source = tmp_path / "episode.png"
    Image.new("RGB", (800, 1200), "blue").save(source)
    owner = UserContext("owner", "owner", "Owner", "")
    asset = SimpleNamespace(id="character-1", variants=[SimpleNamespace(id="variant-1", url=str(source), created_at=1)])
    episode = SimpleNamespace(series_id="series-1", characters=[asset])
    monkeypatch.setattr(api.pipeline, "get_script", lambda project_id, profile: episode if (project_id, profile) == ("episode-1", "owner") else None)
    monkeypatch.setattr(api.pipeline, "_asset_image_variants", lambda item, _kind: item.variants)
    monkeypatch.setattr(api.pipeline, "_resolve_stored_reference_value", lambda value, _owner: value)
    monkeypatch.setattr(api.pipeline, "output_root", str(tmp_path / "selected"))
    monkeypatch.setattr(api, "_resolve_request_context", lambda *_args: (owner, False))
    api.app.dependency_overrides[require_studio_user] = lambda: owner
    try:
        with TestClient(api.app) as client:
            response = client.get("/asset-index/preview", params={
                "scope": "project", "container_id": "episode-1", "asset_type": "character",
                "asset_id": "character-1", "variant_id": "variant-1",
            })
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/webp"
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)


@pytest.mark.parametrize("slot", ["first", "last"])
def test_attach_asset_frame_uses_owned_storage_key_not_expired_delivery_url(monkeypatch, tmp_path, slot):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ImageVariant
    from src.apps.identity import UserContext

    owner = UserContext("owner", "owner", "Owner", "")
    source = tmp_path / "original.png"
    source.write_bytes(b"original image bytes")
    variant = ImageVariant(id="v1", url="https://old.example/image?expires=1",
                           storage_key="assets/original.png")
    entry = SimpleNamespace(asset_type="scene", asset_id="scene-1", source_scope="episode",
                            source_container_id="project-1", variants=[variant])
    monkeypatch.setattr(api.pipeline, "get_script", lambda project, profile: object()
                        if (project, profile) == ("project-1", "owner") else None)
    monkeypatch.setattr(api.pipeline, "get_asset_reference_index", lambda *_args, **_kwargs:
                        SimpleNamespace(assets=[entry]))
    monkeypatch.setattr(api, "storage_backend", lambda: "local")
    monkeypatch.setattr(api.pipeline, "_resolve_stored_reference_value", lambda stored, profile:
                        str(source) if (stored, profile) == (variant.storage_key, "owner") else None)
    monkeypatch.setattr(api, "_studio_upload_target", lambda _user, filename:
                        (str(tmp_path / filename), f"users/owner/studio/uploads/{filename}"))
    attached = []
    monkeypatch.setattr(api.pipeline, "upload_t2i_frame", lambda *args: attached.append(("first", args)) or {"ok": True})
    monkeypatch.setattr(api.pipeline, "upload_last_frame", lambda *args: attached.append(("last", args)) or {"ok": True})
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    request = api.AttachAssetFrameRequest(scope="project", container_id="project-1",
        asset_type="scene", asset_id="scene-1", variant_id="v1", slot=slot)

    assert api.attach_asset_frame("project-1", "frame-1", request, owner) == {"ok": True}
    assert attached[0][0] == slot
    assert attached[0][1][:2] == ("project-1", "frame-1")
    assert attached[0][1][2].startswith(f"users/owner/studio/uploads/{slot}_asset_")
    assert next(tmp_path.glob(f"{slot}_asset_*.png")).read_bytes() == source.read_bytes()
    with pytest.raises(HTTPException) as denied:
        api.attach_asset_frame("project-1", "frame-1", request,
                               UserContext("other", "other", "Other", ""))
    assert denied.value.status_code == 404
    with pytest.raises(HTTPException) as missing:
        api.attach_asset_frame("project-1", "frame-1", request.model_copy(update={"variant_id": "other"}), owner)
    assert missing.value.status_code == 404


def test_attach_asset_frame_normalizes_legacy_managed_cloud_url(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ImageVariant
    from src.apps.identity import UserContext

    owner = UserContext("owner", "owner", "Owner", "")
    old_url = "https://managed.example/asset.png?expires=1"
    variant = ImageVariant(id="v1", url=old_url)
    entry = SimpleNamespace(asset_type="scene", asset_id="scene-1", source_scope="episode",
                            source_container_id="project-1", variants=[variant])
    monkeypatch.setattr(api.pipeline, "get_script", lambda *_args: object())
    monkeypatch.setattr(api.pipeline, "get_asset_reference_index", lambda *_args, **_kwargs:
                        SimpleNamespace(assets=[entry]))
    monkeypatch.setattr(api, "managed_object_key_from_url", lambda url, _uploader:
                        "lumenx/owned/asset.png" if url == old_url else None)
    monkeypatch.setattr(api, "_owned_media_delivery_url", lambda key, _owner: "https://fresh.example/asset.png")
    attached = []
    monkeypatch.setattr(api.pipeline, "upload_t2i_frame", lambda *args: attached.append(args) or {"ok": True})
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    request = api.AttachAssetFrameRequest(scope="project", container_id="project-1",
        asset_type="scene", asset_id="scene-1", variant_id="v1")

    assert api.attach_asset_frame("project-1", "frame-1", request, owner) == {"ok": True}
    assert attached == [("project-1", "frame-1", "lumenx/owned/asset.png")]
