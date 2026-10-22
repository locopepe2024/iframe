from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.apps.identity import UserContext, require_user_context
from src.apps.photos import analysis
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore
from src.apps.user_config import UserConfigStore, UserConfigUpdate
from fastapi import HTTPException


OBSERVATION = dict(visible_summary="画面中有一张桌子。", visible_text=[], uncertainties=[], story_question="您想聊聊这张照片吗？")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = DateStore(tmp_path / "photos.db")
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(store.path))
    app = create_app()
    app.dependency_overrides[require_user_context] = lambda: UserContext("actor", "owner", "", "")
    image = BytesIO(); Image.new("RGB", (20, 20), "red").save(image, "PNG")
    with TestClient(app) as client:
        photo = client.post("/photos/uploads/test", content=image.getvalue()).json()["photo_id"]
        yield client, store, app, "/photos/" + photo


def test_permission_owner_persistence_and_date_isolation(setup, monkeypatch):
    client, store, app, path = setup
    model = Mock(return_value=analysis.PhotoAnalysis(model="qwen-test", image_sha256="abc", created_at=datetime.now(timezone.utc), observation=analysis.Observation(**OBSERVATION)))
    monkeypatch.setattr("src.apps.photos.api.analyze_photo", model)
    before = client.get(path + "/date").json()
    assert client.get(path + "/analysis").json() is None
    assert client.post(path + "/analysis", json={"allow_external_analysis": False}).status_code == 422
    assert client.post(path + "/analysis", json={}).status_code == 422
    model.assert_not_called()
    result = client.post(path + "/analysis", json={"allow_external_analysis": True})
    assert result.status_code == 200
    assert result.json()["status"] == "needs_review"
    assert client.post(path + "/analysis", json={"allow_external_analysis": True}).json() == result.json()
    model.assert_called_once()
    assert client.get(path + "/analysis").json() == result.json()
    assert client.get(path + "/date").json() == before
    app.dependency_overrides[require_user_context] = lambda: UserContext("other", "other", "", "")
    assert client.get(path + "/analysis").status_code == 404
    assert client.post(path + "/analysis", json={"allow_external_analysis": True}).status_code == 404
    model.assert_called_once()


def test_provider_failure_never_saves_result(setup, monkeypatch):
    client, _, _, path = setup
    monkeypatch.setattr("src.apps.photos.api.analyze_photo", Mock(side_effect=analysis.AnalysisUnavailable("private upstream body")))
    response = client.post(path + "/analysis", json={"allow_external_analysis": True})
    assert response.status_code == 503
    assert "private" not in response.text
    assert client.get(path + "/analysis").json() is None


def test_qwen_wire_and_strict_observation_validation(monkeypatch):
    identity = UserContext("actor", "owner", "", "")
    configured = Mock()
    configured.get_public.return_value = {"secrets_configured": {"UNIART_API_KEY": True}}
    configured.get_runtime_uniart.return_value = {"base_url": "https://example.test/v1", "api_key": "test-key"}
    monkeypatch.setattr(analysis, "UserConfigStore", Mock(return_value=configured))
    monkeypatch.setenv("IFRAME_PHOTOS_QWEN_MODEL", "qwen-test")
    response = Mock(); response.json.return_value = {"choices": [{"message": {"content": analysis.Observation(**OBSERVATION).model_dump_json()}}]}
    post = Mock(return_value=response); monkeypatch.setattr(analysis.requests, "post", post)
    result = analysis.analyze_photo(b"webp", identity)
    configured.get_runtime_uniart.assert_called_once_with(identity)
    assert result.observation.visible_summary == OBSERVATION["visible_summary"]
    body = post.call_args.kwargs["json"]
    assert body["model"] == "qwen-test"
    assert body["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/webp;base64,")
    response.json.return_value = {"choices": [{"message": {"content": '{"date":"1985"}'}}]}
    with pytest.raises(analysis.AnalysisUnavailable):
        analysis.analyze_photo(b"webp", identity)
    response.status_code = 401
    with pytest.raises(analysis.AnalysisCredentialRejected):
        analysis.analyze_photo(b"webp", identity)
    configured.get_public.return_value = {"secrets_configured": {"UNIART_API_KEY": False}}
    with pytest.raises(HTTPException) as missing:
        analysis.analyze_photo(b"webp", identity)
    assert missing.value.status_code == 409


def test_read_only_current_user_channel_does_not_fall_back_to_shared(tmp_path, monkeypatch):
    path = tmp_path / "users.db"
    identity = UserContext("actor", "owner", "", "")
    store = UserConfigStore(str(path))
    store.update(identity, UserConfigUpdate(UNIART_API_KEY="personal", UNIART_BASE_URL="https://example.test/v1"))
    monkeypatch.setenv("IFRAME_PHOTOS_USER_CONFIG_DB", str(path))
    monkeypatch.setenv("LUMENX_ALLOW_SHARED_PROVIDER_CREDENTIALS", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "shared-must-not-be-used")
    before = path.read_bytes()
    response = Mock(status_code=200)
    response.json.return_value = {"choices": [{"message": {"content": analysis.Observation(**OBSERVATION).model_dump_json()}}]}
    post = Mock(return_value=response); monkeypatch.setattr(analysis.requests, "post", post)
    analysis.analyze_photo(b"webp", identity)
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer personal"
    assert path.read_bytes() == before
    with pytest.raises(HTTPException) as missing:
        analysis.analyze_photo(b"webp", UserContext("other", "other", "", ""))
    assert missing.value.status_code == 409
    assert post.call_count == 1
    readonly = UserConfigStore(str(path), read_only=True)
    with pytest.raises(HTTPException):
        readonly.update(identity, UserConfigUpdate(UNIART_API_KEY="replacement"))
    absent = tmp_path / "absent.db"
    monkeypatch.setenv("IFRAME_PHOTOS_USER_CONFIG_DB", str(absent))
    with pytest.raises(analysis.AnalysisUnavailable):
        analysis.analyze_photo(b"webp", identity)
    assert not absent.exists()
