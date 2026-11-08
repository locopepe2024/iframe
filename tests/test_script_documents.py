from pathlib import Path

from fastapi.testclient import TestClient


def test_script_document_http_save_restore_and_owner_boundary(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    monkeypatch.setattr(api, "_TRON_SCRIPT_DOCUMENTS_DIR", Path(tmp_path) / "scripts")
    owner = UserContext("user-a", "profile-a", "A", "")
    other = UserContext("user-b", "profile-b", "B", "")

    def resolve(authorization, _cookie, _identity):
        return (other if authorization == "Bearer other" else owner), False

    monkeypatch.setattr(api, "_resolve_request_context", resolve)
    client = TestClient(api.app)
    created = client.post("/script-documents", json={"title": "独立剧本"})
    assert created.status_code == 200
    document_id = created.json()["id"]
    path = f"/script-documents/{document_id}"
    content = {"type": "doc", "content": [{"type": "action", "content": [{"type": "text", "text": "原稿"}]}]}
    saved = client.put(path, json={"content": content, "create_snapshot": True})
    assert saved.status_code == 200
    assert saved.json()["snapshot_created"] is True
    timestamp = saved.json()["snapshot"]["timestamp"]
    assert saved.json()["snapshot"]["document_id"] == document_id
    assert client.get(path).json()["content"] == content
    assert client.get("/script-documents").json()[0]["id"] == document_id

    other_headers = {"Authorization": "Bearer other"}
    assert client.get("/script-documents", headers=other_headers).json() == []
    assert client.get(path, headers=other_headers).status_code == 404
    assert client.put(path, json={"content": content}, headers=other_headers).status_code == 404
    assert client.get(f"{path}/snapshots", headers=other_headers).status_code == 404
    assert client.post(f"{path}/snapshots/{timestamp}/restore", headers=other_headers).status_code == 404

    assert client.post(f"{path}/snapshots/{timestamp}/restore").json()["content"] == content
    assert len(client.get(f"{path}/snapshots").json()) == 2


def test_failed_atomic_write_preserves_previous_script(tmp_path, monkeypatch):
    from fastapi import HTTPException
    import pytest
    from src.apps.comic_gen import api

    document_path = tmp_path / "document.json"
    document_path.write_text('{"original": true}', encoding="utf-8")

    def fail_replace(_self, _target):
        raise OSError("simulated disk error")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(HTTPException):
        api._write_script_document_json(document_path, {"replacement": True})
    assert document_path.read_text(encoding="utf-8") == '{"original": true}'
    assert list(tmp_path.glob("*.tmp")) == []
