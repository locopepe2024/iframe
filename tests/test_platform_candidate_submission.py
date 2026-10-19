import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import src.apps.platform_reference_catalog as catalog
from src.apps.comic_gen import api as comic_api
from src.apps.identity import UserContext


OWNER = "apikey-" + "a" * 64


def test_publisher_grants_are_server_side_and_reversible(tmp_path):
    path = tmp_path / "publisher_grants.json"
    assert catalog.list_publisher_grants(path) == []
    assert catalog.set_publisher_grant(OWNER, True, path) == [OWNER]
    assert catalog.publisher_is_authorized(OWNER, path)
    assert OWNER in path.read_text(encoding="utf-8")
    assert catalog.set_publisher_grant(OWNER, False, path) == []
    assert not catalog.publisher_is_authorized(OWNER, path)
    with pytest.raises(ValueError, match="server-derived"):
        catalog.set_publisher_grant("raw-api-key", True, path)


def test_owned_generation_media_becomes_review_candidate(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner" / "playground"
    owner.mkdir(parents=True)
    media = owner / "result.png"
    media.write_bytes(b"example-media")
    manifest = tmp_path / "catalog" / "manifest.json"
    values = dict(
        creator_profile_id=OWNER, generation_id="generation-1", output_id="output-1",
        kind="image", category_path="character/reference", title="角色锚点",
        description="用户可编辑的角色描述", prompt_used="实际模型提示词",
        model_id="model-1", parameters={"aspect_ratio": "1:1"},
        media_source=media, media_owner_root=owner, rights_confirmed=True, path=manifest,
    )
    resource = catalog.submit_generation_candidate(**values)
    assert resource["status"] == "candidate"
    assert resource["payload"]["prompt_used"] == "实际模型提示词"
    assert resource["payload"]["structured_prompt"]["content"] == "用户可编辑的角色描述"
    assert (manifest.parent / "media" / resource["payload"]["media_file"]).read_bytes() == b"example-media"
    assert catalog.list_resources(path=manifest)["resources"] == []
    assert catalog.list_review_candidates(category="character/reference", path=manifest)["resources"] == [resource]
    assert catalog.submit_generation_candidate(**values)["platform_resource_id"] == resource["platform_resource_id"]
    assert len(json.loads(manifest.read_text(encoding="utf-8"))["resources"]) == 1


def test_candidate_rejects_unowned_media_and_unknown_category(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"media")
    values = dict(
        creator_profile_id=OWNER, generation_id="g", output_id="o", kind="image",
        category_path="character/reference", title="Reference", description="",
        prompt_used="prompt", model_id="model", parameters={}, media_source=outside,
        media_owner_root=owner, rights_confirmed=True, path=tmp_path / "manifest.json",
    )
    with pytest.raises(ValueError, match="outside"):
        catalog.submit_generation_candidate(**values)
    with pytest.raises(ValueError, match="category"):
        catalog.submit_generation_candidate(**{**values, "category_path": "scene/unknown"})


def test_prompt_only_candidate_keeps_actual_prompt_separate(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    resource = catalog.submit_generation_candidate(
        creator_profile_id=OWNER, generation_id="g", output_id=None,
        kind="prompt_preset", category_path="character/style", title="水彩角色",
        description="编辑后的可复用描述", prompt_used="实际生成提示词",
        model_id="model", parameters={}, media_source=None, media_owner_root=owner,
        rights_confirmed=True, path=tmp_path / "manifest.json",
    )
    assert resource["payload"]["media_file"] is None
    assert resource["payload"]["prompt_used"] != resource["payload"]["structured_prompt"]["content"]


def test_candidate_api_rejects_unapproved_and_foreign_generation(monkeypatch, tmp_path):
    user = UserContext(user_id="u", owner_profile_id=OWNER, display_name="u", access_token="token")
    request = comic_api.PlatformCandidateRequest(
        source_generation_id="g", source_output_id="o", kind="image",
        category_path="character/reference", title="锚点", description="已审描述", rights_confirmed=True,
    )
    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: False)
    with pytest.raises(HTTPException) as denied:
        comic_api.submit_platform_candidate(request, user)
    assert denied.value.status_code == 403

    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: True)
    foreign = SimpleNamespace(id="g", status="completed", owner_profile_id="apikey-" + "b" * 64,
                              outputs=[SimpleNamespace(id="o", media_type="image", media_path=str(tmp_path / "owned.png"))])
    monkeypatch.setattr(comic_api, "playground_storage_for", lambda _: SimpleNamespace(get_generation=lambda _: foreign))
    with pytest.raises(HTTPException) as missing:
        comic_api.submit_platform_candidate(request, user)
    assert missing.value.status_code == 404


def test_candidate_api_rejects_wrong_output_without_publishing(monkeypatch, tmp_path):
    user = UserContext(user_id="u", owner_profile_id=OWNER, display_name="u", access_token="token")
    generation = SimpleNamespace(id="g", status="completed", owner_profile_id=OWNER,
                                 outputs=[SimpleNamespace(id="actual", media_type="image", media_path=str(tmp_path / "owned.png"))])
    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: True)
    monkeypatch.setattr(comic_api, "playground_storage_for", lambda _: SimpleNamespace(get_generation=lambda _: generation))
    request = comic_api.PlatformCandidateRequest(
        source_generation_id="g", source_output_id="forged", kind="image",
        category_path="character/reference", title="锚点", description="", rights_confirmed=True,
    )
    with pytest.raises(HTTPException) as missing:
        comic_api.submit_platform_candidate(request, user)
    assert missing.value.status_code == 422
