import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps import director_design as design
from src.apps.identity import UserContext, require_user_context
from src.apps.studio_access import current_studio_user


def request():
    return dict(prompt="只把机位拉近半米", baseRevision="design-fnv1a32:12345678", context='{"selectedCameraId":"camera-main"}', history=[])


def response():
    return dict(summary="仅调整当前机位", assumptions=[], clarification=None,
                operations=[dict(kind="dolly_camera", cameraId="camera-main", towardM=0.5)])


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(design.router)
    owner = UserContext("owner-a", "profile-a", "A", "")
    app.dependency_overrides[require_user_context] = lambda: owner
    class Adapter:
        is_configured = True
        def chat(self, messages, **kwargs):
            assert current_studio_user() == owner
            assert "positionM is the BOTTOM center" in messages[0]["content"]
            content = messages[-1]["content"]
            if isinstance(content, list):
                assert any(item["type"] == "image_url" for item in content)
                content = next(item["text"] for item in content if item["type"] == "text")
            assert json.loads(content.split("\n", 1)[0])["request"] == request()["prompt"]
            assert kwargs["response_format"] == {"type": "json_object"}
            return json.dumps(response())
    monkeypatch.setattr(design, "LLMAdapter", Adapter)
    return TestClient(app), app


def test_proposal_binds_request_revision_and_uses_owner_context(client):
    c, _ = client
    result = c.post("/director3d/design-proposals", json=request())
    assert result.status_code == 200, result.text
    assert result.json() == {"schemaVersion": "iframe.director3d.design-proposal.v1", "baseRevision": request()["baseRevision"], **response()}
    assert current_studio_user() is None


def test_invalid_identity_is_rejected(client):
    c, app = client
    app.dependency_overrides.clear()
    assert c.post("/director3d/design-proposals", json=request(), headers={"Authorization": "Bearer iframe-session.invalid"}).status_code == 401


@pytest.mark.parametrize("invalid", [
    {**response(), "code": "exec('bad')"},
    {**response(), "operations": [{"kind": "execute_code", "code": "bad"}]},
    {**response(), "operations": [{"kind": "dolly_camera", "cameraId": "camera-main", "towardM": float('nan')}]},
    {**response(), "operations": [{"kind": "arrange_pair", "actorIds": ["a", "b"], "centerM": [0,0,0], "separationM": -1, "axisDeg": 0}]},
    {**response(), "clarification": "Which actor?"},
    {**response(), "operations": []},
])
def test_invalid_model_response_never_returns_executable_plan(client, monkeypatch, invalid):
    c, _ = client
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *args, **kwargs: json.dumps(invalid))
    result = c.post("/director3d/design-proposals", json=request())
    assert result.status_code == 502
    assert current_studio_user() is None


def test_provider_failure_does_not_leak_credentials(client, monkeypatch):
    c, _ = client
    def fail(*args, **kwargs): raise RuntimeError("sensitive-provider-details")
    monkeypatch.setattr(design.LLMAdapter, "chat", fail)
    result = c.post("/director3d/design-proposals", json=request())
    assert result.status_code == 502
    assert "sensitive" not in result.text
    assert current_studio_user() is None


def test_provider_timeout_is_reported_as_timeout_with_extended_budget(client, monkeypatch):
    c, _ = client
    captured = {}
    def timeout(*args, **kwargs):
        captured.update(kwargs)
        raise RuntimeError("Request timed out")
    monkeypatch.setattr(design.LLMAdapter, "chat", timeout)
    result = c.post("/director3d/design-proposals", json=request())
    assert result.status_code == 504
    assert "超时" in result.json()["detail"]
    assert captured["timeout_seconds"] == design.DESIGN_LLM_TIMEOUT_SECONDS
    assert design.DESIGN_LLM_TIMEOUT_SECONDS >= 90
    assert current_studio_user() is None


def test_unconfigured_provider_and_clarification(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(design.LLMAdapter, "is_configured", False)
    assert c.post("/director3d/design-proposals", json=request()).status_code == 503
    monkeypatch.setattr(design.LLMAdapter, "is_configured", True)
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *a, **k: json.dumps({**response(), "operations": [], "clarification": "首版不支持四秒运镜。"}))
    assert c.post("/director3d/design-proposals", json=request()).json()["clarification"]


@pytest.mark.parametrize("change", [{"context": "not json"}, {"context": "[]"}, {"prompt": " "}, {"prompt": "x" * 2001}, {"baseRevision": "invalid"}])
def test_invalid_requests(client, change):
    c, _ = client
    assert c.post("/director3d/design-proposals", json={**request(), **change}).status_code == 422


def test_reference_image_is_sent_as_multimodal_evidence(client):
    c, _ = client
    image_request = {**request(), "referenceImage": {"url": "data:image/png;base64," + ("A" * 32), "mediaId": "media-grain-shop"}}
    result = c.post("/director3d/design-proposals", json=image_request)
    assert result.status_code == 200, result.text


def spatial_request():
    return {**request(), "mode": "spatial_draft", "prompt": "按参考图建立粮铺空间；匪首踹倒掌柜，百姓延迟避让",
            "referenceImage": {"url": "data:image/png;base64," + "A" * 32}}


def spatial_response():
    return {"summary": "粮铺门前空间草稿", "assumptions": ["柜台宽两米，尺度待校正"],
            "observations": ["店门与街面相连"], "deferredActions": ["踹倒与延迟避让尚未编排"],
            "clarification": None, "operations": [{"kind": "add_actor", "actorId": "design-extra-shopkeeper",
                "label": "老掌柜", "positionM": [3, 0, 0], "yawDeg": 90}]}


def test_spatial_draft_requires_image_before_calling_model(client, monkeypatch):
    c, _ = client
    def unexpected(*args, **kwargs):
        pytest.fail("Missing image must fail before provider call")
    monkeypatch.setattr(design, "LLMAdapter", unexpected)
    assert c.post("/director3d/design-proposals", json={**spatial_request(), "referenceImage": None}).status_code == 422


def test_spatial_draft_sends_image_and_preserves_labeled_evidence(client, monkeypatch):
    c, _ = client
    def generate(self, messages, **kwargs):
        assert "REFERENCE IMAGE SPATIAL DRAFT" in messages[0]["content"]
        assert messages[-1]["content"][1]["image_url"]["url"] == spatial_request()["referenceImage"]["url"]
        assert json.loads(messages[-1]["content"][0]["text"].split("\n")[0])["request"] == spatial_request()["prompt"]
        return json.dumps(spatial_response())
    monkeypatch.setattr(design.LLMAdapter, "chat", generate)
    result = c.post("/director3d/design-proposals", json=spatial_request())
    assert result.status_code == 200, result.text
    assert result.json()["operations"] == spatial_response()["operations"]
    assert result.json()["assumptions"] == ["图像解读（待校正）：店门与街面相连", "设计假设：柜台宽两米，尺度待校正", "未编排动作：踹倒与延迟避让尚未编排"]
    assert set(result.json()) == {"schemaVersion", "baseRevision", "summary", "assumptions", "clarification", "operations"}
    assert current_studio_user() is None


@pytest.mark.parametrize("operation", [
    {"kind": "camera_motion", "cameraId": "camera-main", "presetId": "push_in", "durationSeconds": 4, "easing": "linear"},
    {"kind": "camera_cut", "cameraId": "camera-main", "timeSeconds": 0},
    {"kind": "crowd_motion", "groupId": "design-crowd-near", "label": "近景", "behavior": "observe",
     "members": [{"actorId": "design-extra-near", "positionM": [3, 0, 0], "destinationM": [3, 0, 0], "yawDeg": 0, "startSeconds": 0, "durationSeconds": 4}]},
])
def test_spatial_draft_rejects_animation_even_if_model_returns_it(client, monkeypatch, operation):
    c, _ = client
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *a, **kw: json.dumps({**spatial_response(), "operations": [operation]}))
    result = c.post("/director3d/design-proposals", json=spatial_request())
    assert result.status_code == 502
    assert current_studio_user() is None


def test_spatial_draft_max_notes_fit_existing_proposal_contract(client, monkeypatch):
    c, _ = client
    maximum = {**spatial_response(), **{field: ["字" * 280] * 4 for field in ["observations", "assumptions", "deferredActions"]}}
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *a, **kw: json.dumps(maximum))
    result = c.post("/director3d/design-proposals", json=spatial_request())
    assert result.status_code == 200, result.text
    assert len(result.json()["assumptions"]) == 12
    design.ModelProposal.model_validate({key: value for key, value in result.json().items() if key not in {"schemaVersion", "baseRevision"}})


def test_spatial_draft_cannot_omit_design_assumptions(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *a, **kw: json.dumps({**spatial_response(), "assumptions": []}))
    assert c.post("/director3d/design-proposals", json=spatial_request()).status_code == 502


def test_rejected_spatial_draft_gets_explicit_non_repeat_correction_instruction(client, monkeypatch):
    c, _ = client
    seen = {}
    def generate(self, messages, **kwargs):
        seen["text"] = messages[-1]["content"][0]["text"]
        return json.dumps({**spatial_response(), "clarification": "请先调整树的位置。", "operations": []})
    monkeypatch.setattr(design.LLMAdapter, "chat", generate)
    context = json.loads(spatial_request()["context"])
    context["rejectedDesign"] = {"reason": "人物与占位道具重叠", "operations": spatial_response()["operations"]}
    result = c.post("/director3d/design-proposals", json={**spatial_request(), "context": json.dumps(context, ensure_ascii=False)})
    assert result.status_code == 200
    assert "不得原样重复上一版 operations" in seen["text"]
    assert "人物与占位道具重叠" in seen["text"]


def test_reference_assets_keep_checksum_and_owner_boundary(client, monkeypatch, tmp_path):
    c, app = client
    monkeypatch.setenv("IFRAME_MEDIA_ROOT", str(tmp_path / "media"))
    checksum = "fnv1a32:12345678"
    bundle = {"schemaVersion": "iframe.director3d.design-bundle.v1", "sourcePackageChecksum": checksum}
    saved = c.post("/director3d/reference-assets", data={"kind": "design_bundle", "sourcePackageChecksum": checksum, "metadata": json.dumps({"assumptions": ["distance uncertain"]})}, files={"file": ("design.json", json.dumps(bundle).encode(), "application/json")})
    assert saved.status_code == 200, saved.text
    media_id = saved.json()["mediaId"]
    listed = c.get("/director3d/reference-assets")
    assert listed.status_code == 200
    assert listed.json()[0]["metadata"]["assumptions"] == ["distance uncertain"]
    assert c.get(f"/director3d/reference-assets/{media_id}/content").json() == bundle
    app.dependency_overrides[require_user_context] = lambda: UserContext("owner-b", "profile-b", "B", "")
    assert c.get("/director3d/reference-assets").json() == []
    assert c.get(f"/director3d/reference-assets/{media_id}/content").status_code == 404


def test_reference_asset_rejects_stale_bundle_and_wrong_media_type(client, monkeypatch, tmp_path):
    c, _ = client
    monkeypatch.setenv("IFRAME_MEDIA_ROOT", str(tmp_path / "media"))
    checksum = "fnv1a32:12345678"
    bundle = {"schemaVersion": "iframe.director3d.design-bundle.v1", "sourcePackageChecksum": "fnv1a32:87654321"}
    stale = c.post("/director3d/reference-assets", data={"kind": "design_bundle", "sourcePackageChecksum": checksum}, files={"file": ("design.json", json.dumps(bundle).encode(), "application/json")})
    assert stale.status_code == 422
    wrong = c.post("/director3d/reference-assets", data={"kind": "camera_motion_video", "sourcePackageChecksum": checksum}, files={"file": ("video.txt", b"video", "text/plain")})
    assert wrong.status_code == 422


@pytest.mark.parametrize("url", ["http://localhost/image.png", "javascript:alert(1)", "not-an-image"])
def test_reference_image_rejects_uncontrolled_urls(client, url):
    c, _ = client
    result = c.post("/director3d/design-proposals", json={**request(), "referenceImage": {"url": url}})
    assert result.status_code == 422


def test_seated_pair_proposal_uses_typed_actor_operations_and_keeps_camera(client, monkeypatch):
    c, _ = client
    result = {**response(), "summary": "两人坐在程序化椅子参考上，保留当前机位",
              "assumptions": ["椅子是程序化参考，不是真实家具资产"],
              "operations": [dict(kind="seat_actor", actorId=actor, chairId=f"design-chair-{i}") for i, actor in enumerate(["a", "b"])]}
    def generate(self, messages, **kwargs):
        assert "two seat_actor operations" in messages[0]["content"]
        assert "NO camera operations" in messages[0]["content"]
        return json.dumps(result)
    monkeypatch.setattr(design.LLMAdapter, "chat", generate)
    reply = c.post("/director3d/design-proposals", json=request())
    assert reply.status_code == 200
    assert reply.json()["operations"] == result["operations"]
    assert current_studio_user() is None


@pytest.mark.parametrize("operation", [
    dict(kind="set_pose", actorId="a", presetId="gesture.wave"),
    dict(kind="seat_actor", actorId="a", chairId="design-chair-a"),
    dict(kind="arrange_group", members=[
        dict(actorId="a", positionM=[-1, 0, 0], yawDeg=0),
        dict(actorId="b", positionM=[1, 0, 0], yawDeg=180, presetId="kneeling.single_knee"),
    ]),
])
def test_supported_pose_and_seating_schema(operation):
    design.ModelProposal.model_validate({**response(), "operations": [operation]})


@pytest.mark.parametrize("operation", [
    dict(kind="set_pose", actorId="a", presetId="seated.sit"),
    dict(kind="set_pose", actorId="a", presetId="unknown"),
    dict(kind="seat_actor", actorId="a", chairId="../../chair"),
    dict(kind="seat_actor", actorId="a", chairId="design-chair-a", code="bad"),
])
def test_unsupported_pose_or_chair_schema_is_rejected(operation):
    with pytest.raises(ValueError):
        design.ModelProposal.model_validate({**response(), "operations": [operation]})


def test_timed_half_meter_proposal_retains_duration_and_distance(client, monkeypatch):
    c, _ = client
    operation = dict(kind="camera_motion", cameraId="camera-main", presetId="push_in", durationSeconds=4, easing="ease_in_out", distanceM=0.5)
    def generate(self, messages, **kwargs):
        assert "durationSeconds=4, distanceM=0.5" in messages[0]["content"]
        return json.dumps({**response(), "operations": [operation]})
    monkeypatch.setattr(design.LLMAdapter, "chat", generate)
    result = c.post("/director3d/design-proposals", json={**request(), "prompt": "四秒缓慢推进半米"})
    assert result.status_code == 200
    assert result.json()["operations"] == [operation]


@pytest.mark.parametrize("distance", [0, -0.5, 21, float("nan"), float("inf"), "0.5", True])
def test_invalid_camera_motion_distance_is_rejected(distance):
    with pytest.raises(ValueError):
        design.CameraMotion(kind="camera_motion", cameraId="camera-main", presetId="push_in", durationSeconds=4, easing="linear", distanceM=distance)


def test_camera_motion_distance_cannot_be_misread_as_orbit_radius():
    with pytest.raises(ValueError):
        design.CameraMotion(kind="camera_motion", cameraId="camera-main", presetId="orbit", durationSeconds=4, easing="linear", distanceM=0.5)


def crowd_operation():
    return dict(kind="crowd_motion", groupId="design-crowd-near", label="近处百姓",
                behavior="avoid", members=[dict(actorId="design-extra-near-1",
                positionM=[-5, 2, 0], destinationM=[-3, 2, 0], yawDeg=-90,
                startSeconds=0, durationSeconds=4)])


def test_crowd_camera_schema_round_trip(client, monkeypatch):
    c, _ = client
    result = dict(summary="群演避让与切镜", assumptions=["四秒参考"], clarification=None,
                  operations=[crowd_operation(), dict(kind="add_camera", cameraId="design-camera-near",
                  label="近景", targetIds=["design-extra-near-1"], azimuthDeg=0,
                  elevationDeg=10, distanceM=6, focalLengthMm=35),
                  dict(kind="camera_cut", cameraId="design-camera-near", timeSeconds=2)])
    monkeypatch.setattr(design.LLMAdapter, "chat", lambda *args, **kwargs: json.dumps(result))
    actual = c.post("/director3d/design-proposals", json=request())
    assert actual.status_code == 200, actual.text
    assert actual.json()["operations"] == result["operations"]


@pytest.mark.parametrize("change", [
    {"behavior": "unknown"},
    {"groupId": "other"},
    {"behavior": "observe"},
    {"members": []},
    {"members": [dict(actorId="a", positionM=[0, 0, 0], destinationM=[1, 0, 0],
                      yawDeg=0, startSeconds=599, durationSeconds=4)]},
])
def test_invalid_crowd_response_rejected(change):
    with pytest.raises(ValueError):
        design.ModelProposal.model_validate(dict(summary="test", assumptions=[],
            clarification=None, operations=[{**crowd_operation(), **change}]))


def test_duplicate_crowd_members_rejected():
    operation = crowd_operation()
    operation["members"] *= 2
    with pytest.raises(ValueError):
        design.ModelProposal.model_validate(dict(summary="test", assumptions=[],
            clarification=None, operations=[operation]))


def street_operation():
    return dict(kind="street_layout", layoutId="design-street-grain", centerM=[0, 0, 0],
                widthM=6, lengthM=12, buildings=[dict(id="shop", label="粮铺",
                centerM=[0, 9, 0], dimensionsM=[6, 6, 4], doorWidthM=2, frontSide="negative_y")],
                trees=[dict(id="tree", positionM=[-2, -4, 0], heightM=5, trunkWidthM=0.6)])


def test_street_layout_contract():
    op = street_operation()
    value = design.ModelProposal.model_validate(dict(summary="街区", assumptions=["尺寸为布局假设"], clarification=None, operations=[op]))
    assert value.model_dump(mode="json")["operations"][0] == op


@pytest.mark.parametrize("change", [{"widthM": 0}, {"layoutId": "other"}, {"code": "bad"}])
def test_street_layout_rejects_invalid_fields(change):
    with pytest.raises(ValueError):
        design.StreetLayout.model_validate({**street_operation(), **change})


def test_street_rejects_duplicate_ids_and_invalid_door():
    op = street_operation()
    op["trees"][0]["id"] = "shop"
    with pytest.raises(ValueError):
        design.StreetLayout.model_validate(op)
    op = street_operation()
    op["buildings"][0]["doorWidthM"] = 6
    with pytest.raises(ValueError):
        design.StreetLayout.model_validate(op)


@pytest.mark.parametrize("mime,extension", [("video/mp4;codecs=vp9", ".mp4"), ("video/webm;codecs=vp8", ".webm")])
def test_reference_video_accepts_browser_codec_parameters(client, monkeypatch, tmp_path, mime, extension):
    c, _ = client
    monkeypatch.setenv("IFRAME_MEDIA_ROOT", str(tmp_path / "media"))
    result = c.post("/director3d/reference-assets", data={"kind": "camera_motion_video", "sourcePackageChecksum": "fnv1a32:12345678"},
                    files={"file": ("recording" + extension, b"recorded-video", mime)})
    assert result.status_code == 200, result.text
    saved = list((tmp_path / "media").rglob("*" + extension))
    assert len(saved) == 1
    assert saved[0].read_bytes() == b"recorded-video"
    content = c.get(f"/director3d/reference-assets/{result.json()['mediaId']}/content")
    assert content.status_code == 200
    assert content.headers["content-type"].split(";")[0] == mime.split(";")[0]
