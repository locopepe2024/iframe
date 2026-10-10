from contextlib import contextmanager
import json
from datetime import date, timedelta
from unittest.mock import Mock
import socket
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.knowledge import api, capture, discovery, store, worker


def test_discovery_requires_configured_provider(monkeypatch):
    monkeypatch.delenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", raising=False)
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_not_configured"):
        discovery.discover("NVIDIA")


def test_gdelt_rejects_windows_older_than_provider_retention(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_date_window_unsupported"):
        discovery.discover("NVIDIA", "2026-03-01", "2026-03-31")


def test_discovery_keeps_seen_date_separate_from_publication_date(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps({"articles": [{"url": "https://example.org/news",
        "title": "Company report", "domain": "example.org", "seendate": "20260301T120000Z"}]}).encode()]
    monkeypatch.setattr(discovery.requests, "get", Mock(return_value=response))
    end = date.today()
    start = end - timedelta(days=10)
    result = discovery.discover("NVIDIA", start.isoformat(), end.isoformat())
    assert result[0]["access_status"] == "public"
    assert result[0]["seen_at"] == "20260301T120000Z"
    assert result[0]["published_at"] is None


def test_capture_rejects_private_destination_and_extracts_text(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setattr(capture.socket, "getaddrinfo", lambda *args, **kwargs:
                        [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 443))])
    with pytest.raises(capture.CaptureRejected, match="non_public_destination"):
        capture.validate_url("https://example.org/report")
    with pytest.raises(capture.CaptureRejected, match="source_not_allowlisted"):
        capture.validate_url("https://127.0.0.1/report")
    parser = capture.ArticleParser()
    parser.feed("<html><script>ignore</script><h1>Title</h1><p>Policy <b>update</b></p><img src='/figure.png' alt='Chart'></html>")
    assert parser.blocks == ["Title", "Policy update"]
    assert parser.images == [("/figure.png", "Chart", "")]
    parser = capture.ArticleParser()
    parser.feed("<figure><img src='/figure.png' alt='Revenue'><figcaption>Quarterly revenue</figcaption></figure>")
    assert parser.images == [("/figure.png", "Revenue", "Quarterly revenue")]


def test_capture_rechecks_redirect_destination(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setattr(capture.socket, "getaddrinfo", lambda *args, **kwargs:
                        [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 443))])
    response = Mock(status=302)
    response.getheader.return_value = "https://127.0.0.1/private"
    connection = Mock()
    connection.getresponse.return_value = response
    monkeypatch.setattr(capture, "PinnedHTTPSConnection", lambda host, ip: connection)
    with pytest.raises(capture.CaptureRejected, match="source_not_allowlisted"):
        capture.fetch("https://example.org/article", {"text/html"}, 1000)
    connection.request.assert_called_once()
    connection.close.assert_called_once()


def test_capture_pins_checked_ip_and_verifies_original_hostname(monkeypatch):
    context = Mock()
    raw_socket = Mock()
    monkeypatch.setattr(capture.ssl, "create_default_context", lambda: context)
    monkeypatch.setattr(capture.socket, "create_connection", lambda address, timeout: raw_socket)
    connection = capture.PinnedHTTPSConnection("example.org", "93.184.215.14")
    connection.connect()
    context.wrap_socket.assert_called_once_with(raw_socket, server_hostname="example.org")
    assert connection._pinned_ip == "93.184.215.14"


def test_research_api_uses_authenticated_owner_and_selected_candidates(monkeypatch):
    run_id = uuid.uuid4()
    owner_calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda connection, owner: owner_calls.append(owner) or str(uuid.uuid4()))
    monkeypatch.setattr(store, "create_research_run", lambda connection, owner, sid, query, cid, intent: owner_calls.append((owner, sid, query, cid)) or str(run_id))
    monkeypatch.setattr(store, "finish_discovery", lambda connection, owner, rid, candidates, error: owner_calls.append((owner, rid, candidates, error)))
    monkeypatch.setattr(store, "get_research_run", lambda connection, owner, rid: {"id": rid, "status": "awaiting_selection", "candidates": [{"url": "https://example.org/a", "access_status": "public"}], "jobs": []})
    monkeypatch.setattr(store, "select_research_sources", lambda connection, owner, rid, urls: owner_calls.append((owner, urls)) or {"id": rid, "status": "capturing", "jobs": []})
    monkeypatch.setattr(discovery, "discover", lambda query, start, end: [{"url": "https://example.org/a", "access_status": "public"}])
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner-a", "A", "token")
    with TestClient(app) as client:
        created = client.post("/knowledge/research", json={"query": "NVIDIA March 2026", "session_id": "session-a"})
        assert created.status_code == 201
        assert created.json()["id"] == str(run_id)
        selected = client.post(f"/knowledge/research/{run_id}/sources", json={"urls": ["https://example.org/a"]})
        assert selected.status_code == 200
        assert owner_calls[0] == "owner-a"
        assert owner_calls[-1] == ("owner-a", ["https://example.org/a"])


def test_worker_imports_raw_capture_and_finishes_job(monkeypatch):
    job = {"id": "job-a", "run_id": "run-a", "owner": "owner-a", "source_url": "https://example.org/a",
           "collection_id": "collection-a", "candidates": [{"url": "https://example.org/a", "title": "Article"}], "attempts": 0}
    calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "fail_exhausted_jobs", lambda connection: None)
    monkeypatch.setattr(store, "claim_capture_job", lambda connection: job)
    monkeypatch.setattr(capture, "capture_article", lambda url: (b"<p>Evidence</p>", [{"kind": "text", "locator": "block:1", "body": "Evidence", "labels": [], "annotation": None}]))
    monkeypatch.setattr(worker.blob_store, "put", lambda kind, raw: ("raw/key", "digest"))
    monkeypatch.setattr(store, "import_source", lambda connection, owner, cid, source, key, digest, units: calls.append((owner, cid, source, key, units)) or {"source_id": "source-a", "revision_id": "revision-a"})
    monkeypatch.setattr(store, "finish_capture_job", lambda connection, job, source_id=None, revision_id=None, error_code=None: calls.append((source_id, revision_id, error_code)))
    assert worker.run_once() is True
    assert calls[0][0:2] == ("owner-a", "collection-a")
    assert calls[0][3] == "raw/key"
    assert calls[1] == ("source-a", "revision-a", None)


def test_selection_rejects_unlisted_or_blocked_sources(monkeypatch):
    connection = Mock()
    connection.cursor.return_value.fetchone.return_value = ("run-a",)
    monkeypatch.setattr(store, "get_research_run", lambda connection, owner, rid: {
        "status": "awaiting_selection", "candidates": [
            {"url": "https://example.org/a", "access_status": "public"},
            {"url": "https://blocked.example/a", "access_status": "not_allowlisted"},
        ],
    })
    with pytest.raises(ValueError, match="not available"):
        store.select_research_sources(connection, "owner-a", "run-a", ["https://blocked.example/a"])
    with pytest.raises(ValueError, match="not available"):
        store.select_research_sources(connection, "owner-a", "run-a", ["https://example.org/a", "https://example.org/a"])
