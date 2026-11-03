import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

import src.apps.platform_reference_catalog as catalog
from src.apps.comic_gen import api as comic_api
from src.apps.identity import UserContext
from src.apps.studio_access import studio_media_dir


OWNER = "apikey-" + "a" * 64


def _uploaded_png(path):
    image = Image.new("RGB", (8, 8), "white")
    image.save(path, format="PNG")


def test_uploaded_visual_candidate_requires_review_and_owner_media(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    monkeypatch.setattr(catalog, "reviewer_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner" / "uploads"
    owner.mkdir(parents=True)
    media = owner / "pose.png"
    _uploaded_png(media)
    manifest = tmp_path / "catalog" / "manifest.json"
    values = dict(creator_profile_id=OWNER, category_path="reference/pose", title="站姿",
                  description="全身站立", tags=["姿态参考"], media_source=media,
                  media_owner_root=owner, rights_confirmed=True, rights_note="原创图片",
                  source_url="https://example.org/source", path=manifest)
    resource = catalog.submit_uploaded_visual_candidate(**values)
    assert resource["status"] == "candidate"
    assert resource["provenance"]["source"] == "owner-upload"
    assert catalog.list_resources(path=manifest)["resources"] == []
    assert catalog.list_review_candidates(path=manifest)["resources"] == [resource]
    assert catalog.submit_uploaded_visual_candidate(**values)["platform_resource_id"] == resource["platform_resource_id"]
    catalog.promote_resource(resource["platform_resource_id"], OWNER,
                             resource["provenance"]["content_sha256"], manifest)
    assert catalog.list_resources(category="reference/pose", path=manifest)["resources"][0]["platform_resource_id"] == resource["platform_resource_id"]

    outside = tmp_path / "other.png"
    _uploaded_png(outside)
    failures = [
        ({"media_source": outside}, ValueError),
        ({"category_path": "character/reference"}, ValueError),
        ({"rights_confirmed": False}, ValueError),
        ({"rights_note": " "}, ValueError),
        ({"source_url": "file:///private/image.png"}, ValueError),
    ]
    for change, error in failures:
        with pytest.raises(error):
            catalog.submit_uploaded_visual_candidate(**{**values, **change})
    media.write_bytes(b"not a png")
    with pytest.raises(ValueError, match="decoded"):
        catalog.submit_uploaded_visual_candidate(**values)
    with pytest.raises(PermissionError):
        catalog.submit_uploaded_visual_candidate(**{**values, "creator_profile_id": "other"})


def test_uploaded_visual_api_rejects_foreign_media(monkeypatch, tmp_path):
    user = UserContext(user_id="u", owner_profile_id=OWNER, display_name="u", access_token="token")
    request = comic_api.PlatformUploadedVisualCandidateRequest(
        source_image_url="https://example.org/image.png", category_path="reference/pose",
        title="站姿", rights_confirmed=True, rights_note="原创图片",
    )
    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: False)
    with pytest.raises(HTTPException) as denied:
        comic_api.submit_uploaded_platform_visual_candidate(request, user)
    assert denied.value.status_code == 403
    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: True)
    with pytest.raises(HTTPException) as external:
        comic_api.submit_uploaded_platform_visual_candidate(request, user)
    assert external.value.status_code == 422
    monkeypatch.setattr(comic_api, "resolve_studio_reference", lambda *_args, **_kwargs: "users/foreign/studio/uploads/image.png")
    monkeypatch.setattr(comic_api.pipeline, "output_root", str(tmp_path))
    monkeypatch.setattr(comic_api, "submit_uploaded_visual_candidate", lambda **_kwargs: (_ for _ in ()).throw(ValueError("outside")))
    request.source_image_url = "uploads/image.png"
    with pytest.raises(HTTPException) as foreign:
        comic_api.submit_uploaded_platform_visual_candidate(request, user)
    assert foreign.value.status_code == 422


def test_uploaded_visual_api_accepts_owner_upload(monkeypatch, tmp_path):
    user = UserContext(user_id="u", owner_profile_id=OWNER, display_name="u", access_token="token")
    root = str(tmp_path / "output")
    uploads = tmp_path / studio_media_dir(OWNER, "uploads", output_root=root).removeprefix(str(tmp_path) + "/")
    uploads.mkdir(parents=True)
    media = uploads / "pose.png"
    _uploaded_png(media)
    manifest = tmp_path / "catalog" / "manifest.json"
    monkeypatch.setattr(comic_api.pipeline, "output_root", root)
    monkeypatch.setattr(catalog, "MANIFEST_PATH", manifest)
    monkeypatch.setattr(comic_api, "publisher_is_authorized", lambda profile: profile == OWNER)
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda profile: profile == OWNER)
    request = comic_api.PlatformUploadedVisualCandidateRequest(
        source_image_url=str(media.relative_to(root)), category_path="reference/pose",
        title="站姿", rights_confirmed=True, rights_note="原创图片",
    )
    response = comic_api.submit_uploaded_platform_visual_candidate(request, user)
    assert response.body
    assert any(item["title"] == "站姿" for item in catalog.list_review_candidates(path=manifest)["resources"])


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
        kind="image", category_path="character/reference", tags=[" 角色设定稿 ", "转面三视图", "角色设定稿"], title="角色锚点",
        description="用户可编辑的角色描述", prompt_used="实际模型提示词",
        model_id="model-1", parameters={"aspect_ratio": "1:1"},
        media_source=media, media_owner_root=owner, rights_confirmed=True, path=manifest,
    )
    resource = catalog.submit_generation_candidate(**values)
    assert resource["status"] == "candidate"
    assert resource["payload"]["prompt_used"] == "实际模型提示词"
    assert resource["payload"]["structured_prompt"]["content"] == "用户可编辑的角色描述"
    assert resource["tags"] == ["角色设定稿", "转面三视图"]
    assert (manifest.parent / "media" / resource["payload"]["media_file"]).read_bytes() == b"example-media"
    assert catalog.list_resources(path=manifest)["resources"] == []
    assert catalog.list_review_candidates(category="character/reference", path=manifest)["resources"] == [resource]
    assert catalog.list_review_candidates(tag="转面三视图", path=manifest)["resources"] == [resource]
    assert catalog.list_review_candidates(tag="表情表", path=manifest)["resources"] == []
    assert catalog.submit_generation_candidate(**values)["platform_resource_id"] == resource["platform_resource_id"]
    assert catalog.submit_generation_candidate(**{**values, "tags": ["转面三视图", "角色设定稿"]})["platform_resource_id"] == resource["platform_resource_id"]
    assert len(json.loads(manifest.read_text(encoding="utf-8"))["resources"]) == 1


def test_candidate_rejects_unowned_media_and_unknown_category(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"media")
    values = dict(
        creator_profile_id=OWNER, generation_id="g", output_id="o", kind="image",
        category_path="character/reference", title="Reference", description="Paired prompt",
        prompt_used="prompt", model_id="model", parameters={}, media_source=outside,
        media_owner_root=owner, rights_confirmed=True, path=tmp_path / "manifest.json",
    )
    with pytest.raises(ValueError, match="outside"):
        catalog.submit_generation_candidate(**values)
    with pytest.raises(ValueError, match="category"):
        catalog.submit_generation_candidate(**{**values, "category_path": "scene/unknown"})


def test_shared_visual_categories_publish_as_platform_images(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    monkeypatch.setattr(catalog, "reviewer_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    media = owner / "pose.png"
    media.write_bytes(b"pose-reference")
    manifest = tmp_path / "manifest.json"
    for category in ("reference/pose", "reference/costume", "reference/character"):
        resource = catalog.submit_generation_candidate(
            creator_profile_id=OWNER, generation_id=category, output_id="output",
            kind="image", category_path=category, title=category,
            description="Shared image reference", prompt_used="source prompt", model_id="model",
            parameters={}, media_source=media, media_owner_root=owner,
            rights_confirmed=True, path=manifest,
        )
        assert catalog.list_resources(category=category, path=manifest)["resources"] == []
        catalog.promote_resource(resource["platform_resource_id"], OWNER,
                                 resource["provenance"]["content_sha256"], manifest)
        assert catalog.list_resources(category=category, path=manifest)["resources"][0]["platform_resource_id"] == resource["platform_resource_id"]
    with pytest.raises(ValueError, match="images"):
        catalog.submit_generation_candidate(
            creator_profile_id=OWNER, generation_id="video", output_id=None,
            kind="prompt_preset", category_path="reference/pose", title="pose",
            description="pose", prompt_used="pose", model_id="model", parameters={},
            media_source=None, media_owner_root=owner, rights_confirmed=True, path=manifest,
        )


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


def test_explicit_dictionary_label_survives_review_and_filters(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    manifest = tmp_path / "manifest.json"
    values = dict(
        creator_profile_id=OWNER, generation_id="g", output_id=None, kind="prompt_preset",
        category_path="character/identity/face", title="窄长脸", description="窄长脸型",
        prompt_used="完整生成提示词", model_id="model", parameters={}, media_source=None,
        media_owner_root=owner, rights_confirmed=True, path=manifest,
    )
    ordinary = catalog.submit_generation_candidate(**values)
    term = catalog.submit_generation_candidate(**{**values, "dictionary_entry_type": "term"})
    with pytest.raises(ValueError, match="single editable phrase"):
        catalog.submit_generation_candidate(**{**values, "dictionary_entry_type": "term", "description": "A" * 501})
    assert ordinary["platform_resource_id"] != term["platform_resource_id"]
    assert "dictionary" not in ordinary
    assert term["dictionary"] == {"semantic_domain": "character.identity", "entry_type": "term"}
    assert catalog.list_resources(semantic_domain="character.identity", entry_type="term", path=manifest)["resources"] == []
    catalog.promote_resource(term["platform_resource_id"], OWNER, term["provenance"]["content_sha256"], manifest)
    assert [item["platform_resource_id"] for item in catalog.list_resources(
        semantic_domain="character.identity", entry_type="term", path=manifest
    )["resources"]] == [term["platform_resource_id"]]
    assert catalog.list_resources(semantic_domain="character.look", path=manifest)["resources"] == []
    for kind, category, entry_type in [
        ("image", "character/identity/face", "term"),
        ("prompt_preset", "character/identity/face", "case"),
        ("prompt_preset", "character/reference", "term"),
    ]:
        with pytest.raises(ValueError, match="Dictionary type"):
            catalog.submit_generation_candidate(**{**values, "kind": kind, "category_path": category, "dictionary_entry_type": entry_type})


def test_pattern_requires_pinned_active_terms_in_one_domain(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    manifest = tmp_path / "manifest.json"
    base = dict(
        creator_profile_id=OWNER, generation_id="g", output_id=None, kind="prompt_preset",
        category_path="character/identity/face", title="脸型", description="窄长脸",
        prompt_used="生成提示词", model_id="model", parameters={}, media_source=None,
        media_owner_root=owner, rights_confirmed=True, path=manifest, dictionary_entry_type="term",
    )
    first = catalog.submit_generation_candidate(**base)
    second = catalog.submit_generation_candidate(**{**base, "title": "眉眼", "description": "窄眼距"})
    members = [
        {"platform_resource_id": first["platform_resource_id"], "revision": 1, "role": "face"},
        {"platform_resource_id": second["platform_resource_id"], "revision": 1, "role": "eyes"},
    ]
    pattern = {**base, "title": "古典面容", "description": "组合描述", "dictionary_entry_type": "pattern", "dictionary_members": members}
    with pytest.raises(ValueError, match="active term"):
        catalog.submit_generation_candidate(**pattern)
    for term in (first, second):
        catalog.promote_resource(term["platform_resource_id"], OWNER, term["provenance"]["content_sha256"], manifest)
    result = catalog.submit_generation_candidate(**pattern)
    assert result["dictionary"]["members"] == members
    assert catalog.list_resources(entry_type="pattern", path=manifest)["resources"] == []
    catalog.promote_resource(result["platform_resource_id"], OWNER, result["provenance"]["content_sha256"], manifest)
    assert [item["platform_resource_id"] for item in catalog.list_resources(entry_type="pattern", path=manifest)["resources"]] == [result["platform_resource_id"]]
    with pytest.raises(ValueError, match="same domain"):
        catalog.submit_generation_candidate(**{**pattern, "category_path": "character/look/clothing"})
    with pytest.raises(ValueError, match="same domain"):
        catalog.submit_generation_candidate(**{**pattern, "dictionary_members": [members[0], {**members[1], "revision": 2}]})


def test_character_tags_reject_invalid_values_and_are_searchable_after_review(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "publisher_is_authorized", lambda owner: owner == OWNER)
    owner = tmp_path / "owner"
    owner.mkdir()
    values = dict(
        creator_profile_id=OWNER, generation_id="g", output_id=None, kind="prompt_preset",
        category_path="character/reference", tags=["三视图", "配色卡"], title="角色设定稿",
        description="可编辑全文", prompt_used="生成时的提示词", model_id="model", parameters={},
        media_source=None, media_owner_root=owner, rights_confirmed=True, path=tmp_path / "manifest.json",
    )
    with pytest.raises(ValueError, match="tags"):
        catalog.submit_generation_candidate(**{**values, "tags": ["x"] * 13})
    with pytest.raises(ValueError, match="tag"):
        catalog.submit_generation_candidate(**{**values, "tags": ["含\n换行"]})
    with pytest.raises(ValueError, match="description"):
        catalog.submit_generation_candidate(**{**values, "description": ""})
    resource = catalog.submit_generation_candidate(**values)
    catalog.promote_resource(resource["platform_resource_id"], OWNER, resource["provenance"]["content_sha256"], values["path"])
    assert [item["title"] for item in catalog.list_resources(tag="配色卡", path=values["path"])["resources"]] == ["角色设定稿"]
    assert catalog.list_resources(tag="服装拆解", path=values["path"])["resources"] == []


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
