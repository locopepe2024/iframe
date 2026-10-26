import json
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps import director_design as design
from src.apps.identity import UserContext, require_user_context


class FakeLibrary:
    def __init__(self):
        self.director_reference_requests = []
        self.director_reference_results = []
        self.director_reference_assets = []


class FakePipeline:
    def __init__(self):
        self.library_store = FakeLibrary()
        self._save_lock = threading.RLock()
        self.saves = 0

    def _save_library_data_unlocked(self):
        self.saves += 1


def _app(monkeypatch):
    pipeline = FakePipeline()
    app = FastAPI()
    app.include_router(design.router)
    owner = UserContext("owner-a", "profile-a", "A", "")
    app.dependency_overrides[require_user_context] = lambda: owner
    monkeypatch.setattr(design, "_reference_library", lambda: pipeline)
    return TestClient(app), pipeline


def test_approved_result_is_saved_as_immutable_reusable_library_snapshot(monkeypatch):
    client, pipeline = _app(monkeypatch)
    request = {"prompt": "两个人站在前后景", "baseRevision": "design-fnv1a32:12345678", "context": json.dumps({"selectedCameraId": "camera-main"}), "requestedOutputs": {"depth": True, "blockingImage": False, "cameraMotionVideo": False, "actionMotionVideo": False}}
    created = client.post("/director3d/reference-generation-requests", json=request)
    assert created.status_code == 200
    request_id = created.json()["requestId"]
    assert client.get(f"/director3d/reference-generation-results/{request_id}").json()["reviewStatus"] == "pending"
    blocked = client.patch(f"/director3d/reference-generation-results/{request_id}/review", json={"reviewStatus": "approved", "acceptedChanges": {}, "rejectedOutputs": [], "reviewNotes": [], "blockingIssues": []})
    assert blocked.status_code == 409
    review = client.patch(f"/director3d/reference-generation-results/{request_id}/review", json={"reviewStatus": "approved", "acceptedChanges": {"outputs": {"depth": {"status": "generated", "mediaId": "depth-1", "checksum": "sha256:depth"}}}, "rejectedOutputs": [], "reviewNotes": ["导演台已审核"], "blockingIssues": []})
    assert review.status_code == 200
    snapshot = client.post("/director3d/reference-snapshots", json={"requestId": request_id})
    assert snapshot.status_code == 200
    payload = snapshot.json()
    assert payload["assetId"] == payload["snapshotId"]
    assert payload["variantId"].endswith("-r1")
    assert payload["immutable"] is True
    assert client.patch(f"/director3d/reference-generation-results/{request_id}/review", json={"reviewStatus": "needs_revision"}).status_code == 409
    assert len(pipeline.library_store.director_reference_assets) == 1


def test_unapproved_result_cannot_be_saved_as_snapshot(monkeypatch):
    client, _ = _app(monkeypatch)
    created = client.post("/director3d/reference-generation-requests", json={"prompt": "占位", "baseRevision": "design-fnv1a32:12345678", "context": "{}", "requestedOutputs": {"depth": False, "blockingImage": True, "cameraMotionVideo": False, "actionMotionVideo": False}})
    assert created.status_code == 200
    assert client.post("/director3d/reference-snapshots", json={"requestId": created.json()["requestId"]}).status_code == 409
