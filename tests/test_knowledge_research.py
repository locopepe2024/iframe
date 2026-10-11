from contextlib import contextmanager
import json
from datetime import date, timedelta
from unittest.mock import Mock
import socket
import subprocess
import sys
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


def test_fed_rss_discovers_only_matching_official_html_in_window(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    feed = b"""<rss><channel>
      <item><title>2025 Survey of Consumer Finances results</title>
        <link>https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
      <item><title>Consumer Finances outside host</title>
        <link>https://example.org/newsevents/pressreleases/other20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
      <item><title>Monetary policy statement</title>
        <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
    </channel></rss>"""
    response = Mock(status_code=200)
    response.iter_content.return_value = [feed]
    get = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "get", get)
    results = discovery.discover("Survey of Consumer Finances", "2026-10-01", "2026-10-12")
    assert len(results) == 1
    assert results[0]["provider"] == "fed_rss"
    assert results[0]["access_status"] == "public"
    assert results[0]["published_at"] == "2026-10-09T14:00:00+00:00"
    assert results[0]["seen_at"] != results[0]["published_at"]
    assert get.call_args.kwargs["allow_redirects"] is False
    assert discovery.discover("Survey of Consumer Finances", "2026-10-10", "2026-10-12") == []


def test_fed_rss_rate_limit_and_invalid_xml_are_visible(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    response = Mock(status_code=429)
    monkeypatch.setattr(discovery.requests, "get", Mock(return_value=response))
    with pytest.raises(discovery.DiscoveryUnavailable, match="rate_limited"):
        discovery.discover("consumer finances")
    response.status_code = 200
    response.iter_content.return_value = [b"not xml"]
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_failed"):
        discovery.discover("consumer finances")


def test_fed_rss_uses_own_budget_and_owner_gate(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "owner-a")
    assert api.research_enabled_for("owner-a") is True
    assert api.research_enabled_for("owner-b") is False
    cursor = Mock()
    cursor.fetchone.side_effect = [None, None]
    connection = Mock()
    connection.cursor.return_value = cursor
    assert store.reserve_discovery(connection, "owner-a", "fed_rss") is True
    assert any(call.args[1][0] == "provider:fed_rss" and call.args[1][1] == "60 seconds"
               for call in cursor.execute.call_args_list
               if len(call.args) == 2 and len(call.args[1]) > 1)


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
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "owner-a")
    run_id = uuid.uuid4()
    owner_calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda connection, owner: owner_calls.append(owner) or str(uuid.uuid4()))
    monkeypatch.setattr(store, "create_research_run", lambda connection, owner, sid, query, cid, intent: owner_calls.append((owner, sid, query, cid)) or str(run_id))
    monkeypatch.setattr(store, "reserve_discovery", lambda connection, owner, provider: True)
    monkeypatch.setattr(store, "finish_discovery", lambda connection, owner, rid, candidates, error: owner_calls.append((owner, rid, candidates, error)))
    monkeypatch.setattr(store, "get_research_run", lambda connection, owner, rid: {"id": rid, "status": "awaiting_selection", "candidates": [{"url": "https://example.org/a", "access_status": "public"}], "jobs": []})
    monkeypatch.setattr(store, "select_research_sources", lambda connection, owner, rid, urls: owner_calls.append((owner, urls)) or {"id": rid, "status": "capturing", "jobs": []})
    monkeypatch.setattr(discovery, "discover", lambda query, start, end: [{"url": "https://example.org/a", "access_status": "public"}])
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner-a", "A", "token")
    with TestClient(app) as client:
        assert client.get("/knowledge/research-capability").json() == {"enabled": True}
        created = client.post("/knowledge/research", json={"query": "NVIDIA March 2026", "session_id": "session-a"})
        assert created.status_code == 201
        assert created.json()["id"] == str(run_id)
        selected = client.post(f"/knowledge/research/{run_id}/sources", json={"urls": ["https://example.org/a"]})
        assert selected.status_code == 200
        assert owner_calls[0] == "owner-a"
        assert owner_calls[-1] == ("owner-a", ["https://example.org/a"])


def test_research_smoke_gate_rejects_other_owners_before_storage_or_discovery(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "owner-a")
    calls = []
    monkeypatch.setattr(store, "transaction", lambda: calls.append("storage"))
    monkeypatch.setattr(discovery, "discover", lambda *args: calls.append("discovery"))
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner-b", "B", "token")
    with TestClient(app) as client:
        assert client.get("/knowledge/research-capability").json() == {"enabled": False}
        assert client.post("/knowledge/research", json={
            "query": "NVIDIA", "session_id": "session-b",
        }).status_code == 403
        assert client.post(f"/knowledge/research/{uuid.uuid4()}/sources", json={
            "urls": ["https://example.org/a"],
        }).status_code == 403
    assert calls == []


def test_research_smoke_gate_fails_closed_without_owner_list(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.delenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", raising=False)
    assert api.research_enabled_for("owner-a") is False
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "*")
    assert api.research_enabled_for("owner-a") is False


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


def test_idle_worker_exits_cleanly_on_sigterm():
    process = subprocess.Popen([sys.executable, "-c",
        "from src.apps.knowledge import worker; "
        "worker.run_once = lambda: (print('ready', flush=True), False)[1]; "
        "worker.main()"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "ready"
        process.terminate()
        _, errors = process.communicate(timeout=5)
        assert process.returncode == 0, errors
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


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
