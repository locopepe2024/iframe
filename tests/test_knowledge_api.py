from contextlib import contextmanager
import base64
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.knowledge import api, store


def test_collection_api_uses_authenticated_owner_and_rejects_public_creation(monkeypatch):
    calls = []

    @contextmanager
    def connection():
        yield object()

    monkeypatch.setattr(store, "transaction", connection)
    monkeypatch.setattr(
        store,
        "create_owner_collection",
        lambda db, owner, name, domain: calls.append((owner, name, domain)) or {
            "id": "collection-a", "scope": "owner", "name": name, "domain": domain, "revision": 1
        },
    )
    monkeypatch.setattr(
        store, "visible_collections",
        lambda db, owner: calls.append(("list", owner)) or [],
    )
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "user-a", "owner-a", "A", "token"
    )
    with TestClient(app) as client:
        created = client.post("/knowledge/collections", json={"name": "  拳法  ", "domain": " martial_arts "})
        assert created.status_code == 201
        assert created.json()["scope"] == "owner"
        assert calls == [("owner-a", "拳法", "martial_arts")]
        assert client.get("/knowledge/collections").json() == {"collections": []}
        assert calls[-1] == ("list", "owner-a")
        forbidden = client.post(
            "/knowledge/collections",
            json={"name": "Public", "domain": "finance", "scope": "public_reference"},
        )
        assert forbidden.status_code == 422


def test_missing_database_configuration_fails_closed(monkeypatch):
    for name in (
        "IFRAME_KNOWLEDGE_PG_HOST",
        "IFRAME_KNOWLEDGE_PG_USER",
        "IFRAME_KNOWLEDGE_PG_PASSWORD_FILE",
        "IFRAME_KNOWLEDGE_PG_CA_FILE",
    ):
        monkeypatch.delenv(name, raising=False)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "user-a", "owner-a", "A", "token"
    )
    with TestClient(app) as client:
        assert client.get("/knowledge/collections").status_code == 503
        assert client.post(
            "/knowledge/collections", json={"name": "My library", "domain": "finance"}
        ).status_code == 503


def test_agent_imports_text_image_and_video_with_private_blob_storage(monkeypatch, tmp_path):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_ROOT", str(tmp_path))
    collection_id = uuid.uuid4()
    captured = {}

    @contextmanager
    def connection():
        yield object()

    def import_source(db, owner, collection, source, raw_key, digest, units):
        captured.update(owner=owner, collection=collection, source=source,
                        raw_key=raw_key, digest=digest, units=units)
        return {"source_id": "source-a", "revision_id": "revision-a", "created": True,
                "units": [{"id": "unit-a", "kind": "text", "locator": "section:1"}]}

    monkeypatch.setattr(store, "transaction", connection)
    monkeypatch.setattr(store, "_owner_collection", lambda db, cid, owner: None)
    monkeypatch.setattr(store, "import_source", import_source)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "user-a", "owner-a", "A", "token"
    )
    png = b"\x89PNG\r\n\x1a\n" + b"demo-image"
    mp4 = b"\x00\x00\x00\x18ftypisom" + b"demo-video"
    payload = {
        "source_uri": "https://example.org/article", "title": "Example article",
        "source_type": "web", "rights_status": "owned",
        "units": [
            {"kind": "text", "locator": "section:1", "body": "Printing policy",
             "labels": ["policy"], "annotation": "Source quote"},
            {"kind": "image", "locator": "figure:1", "body": "Printing equipment",
             "media_type": "image/png", "media_base64": base64.b64encode(png).decode()},
            {"kind": "video_segment", "locator": "00:00:01-00:00:03",
             "body": "Production line", "media_type": "video/mp4",
             "media_base64": base64.b64encode(mp4).decode()},
        ],
    }
    with TestClient(app) as client:
        response = client.post(f"/knowledge/collections/{collection_id}/sources", json=payload)
        assert response.status_code == 201
        assert captured["owner"] == "owner-a"
        assert captured["collection"] == str(collection_id)
        assert captured["units"][0]["labels"] == ["policy"]
        assert (tmp_path / captured["units"][1]["asset_key"]).read_bytes() == png
        assert (tmp_path / captured["units"][2]["asset_key"]).read_bytes() == mp4
        assert (tmp_path / captured["raw_key"]).read_bytes()
        payload["units"][1]["media_base64"] = base64.b64encode(b"not a png").decode()
        assert client.post(f"/knowledge/collections/{collection_id}/sources", json=payload).status_code == 422
        payload["scope"] = "public_reference"
        assert client.post(f"/knowledge/collections/{collection_id}/sources", json=payload).status_code == 422


def test_agent_cannot_import_into_foreign_collection_or_read_foreign_media(monkeypatch, tmp_path):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_ROOT", str(tmp_path))
    collection_id = uuid.uuid4()
    unit_id = uuid.uuid4()

    @contextmanager
    def connection():
        yield object()

    def denied(*args):
        raise store.KnowledgeAccessDenied("not available")

    monkeypatch.setattr(store, "transaction", connection)
    monkeypatch.setattr(store, "_owner_collection", denied)
    monkeypatch.setattr(store, "get_media", denied)
    monkeypatch.setattr(store, "search", lambda db, owner, query, limit, domain, kind, cid: [])
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "user-b", "owner-b", "B", "token"
    )
    with TestClient(app) as client:
        response = client.post(f"/knowledge/collections/{collection_id}/sources", json={
            "source_uri": "upload:test", "title": "Private", "source_type": "manual",
            "rights_status": "unknown", "units": [{"kind": "text", "locator": "p:1", "body": "secret"}],
        })
        assert response.status_code == 404
        assert list(tmp_path.rglob("*")) == []
        assert client.get(f"/knowledge/units/{unit_id}/media").status_code == 404
        assert client.post("/knowledge/search", json={"query": "secret", "limit": 21}).status_code == 422
