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
            assert json.loads(messages[-1]["content"])["request"] == request()["prompt"]
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
