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
