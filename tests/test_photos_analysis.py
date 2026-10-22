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
    for key, value in {"BASE_URL": "https://example.test/v1", "API_KEY": "test-key", "MODEL": "qwen-test"}.items():
        monkeypatch.setenv("IFRAME_PHOTOS_QWEN_" + key, value)
    response = Mock(); response.json.return_value = {"choices": [{"message": {"content": analysis.Observation(**OBSERVATION).model_dump_json()}}]}
    post = Mock(return_value=response); monkeypatch.setattr(analysis.requests, "post", post)
    result = analysis.analyze_photo(b"webp")
    assert result.observation.visible_summary == OBSERVATION["visible_summary"]
    body = post.call_args.kwargs["json"]
    assert body["model"] == "qwen-test"
    assert body["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/webp;base64,")
    response.json.return_value = {"choices": [{"message": {"content": '{"date":"1985"}'}}]}
    with pytest.raises(analysis.AnalysisUnavailable):
        analysis.analyze_photo(b"webp")
    monkeypatch.delenv("IFRAME_PHOTOS_QWEN_API_KEY")
    with pytest.raises(analysis.AnalysisUnavailable):
        analysis.analyze_photo(b"webp")
