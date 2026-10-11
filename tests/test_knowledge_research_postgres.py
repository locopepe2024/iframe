"""Optional disposable PostgreSQL research-job contract check."""

import os
import subprocess
import sys

import pg8000.dbapi
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.knowledge import api, blob_store, discovery, store


@pytest.mark.skipif(not os.getenv("IFRAME_KNOWLEDGE_TEST_PG_SOCKET"),
                    reason="Disposable PostgreSQL socket is not configured")
def test_research_job_survives_separate_transactions_and_is_owner_scoped():
    connection = pg8000.dbapi.connect(
        unix_sock=os.environ["IFRAME_KNOWLEDGE_TEST_PG_SOCKET"],
        user=os.environ["USER"], database="postgres",
    )
    try:
        store.migrate(connection)
        collection = store.create_owner_collection(connection, "owner-a", "Research", "research")
        run_id = store.create_research_run(connection, "owner-a", "session-a", "NVIDIA March",
                                           collection["id"], {"search_query": "NVIDIA"})
        store.finish_discovery(connection, "owner-a", run_id, [
            {"url": "https://example.org/a", "title": "Article", "access_status": "public"},
        ])
        selected = store.select_research_sources(connection, "owner-a", run_id,
                                                  ["https://example.org/a"])
        assert selected["status"] == "capturing"
        with pytest.raises(store.KnowledgeAccessDenied):
            store.get_research_run(connection, "owner-b", run_id)
        job = store.claim_capture_job(connection)
        assert job["owner"] == "owner-a"
        source = store.import_source(connection, "owner-a", collection["id"], {
            "source_uri": job["source_url"], "title": "Article", "source_type": "web",
            "rights_status": "unknown",
        }, "raw/" + "a" * 64, "a" * 64, [{"kind": "text", "locator": "block:1",
                                           "body": "NVIDIA report", "labels": [], "annotation": None}])
        store.finish_capture_job(connection, job, source["source_id"], source["revision_id"])
        run, evidence = store.research_evidence(connection, "owner-a", run_id)
        assert run["status"] == "ready"
        assert evidence[0]["revision_id"] == source["revision_id"]
        with pytest.raises(store.KnowledgeAccessDenied):
            store.research_evidence(connection, "owner-b", run_id)
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.skipif(not os.getenv("IFRAME_KNOWLEDGE_TEST_PG_SOCKET"),
                    reason="Disposable PostgreSQL socket is not configured")
def test_fed_rss_budget_is_distinct_from_gdelt_budget():
    connection = pg8000.dbapi.connect(
        unix_sock=os.environ["IFRAME_KNOWLEDGE_TEST_PG_SOCKET"],
        user=os.environ["USER"], database="postgres",
    )
    try:
        store.migrate(connection)
        assert store.reserve_discovery(connection, "fed-owner", "fed_rss") is True
        assert store.reserve_discovery(connection, "fed-owner", "fed_rss") is False
        assert store.reserve_discovery(connection, "gdelt-owner", "gdelt") is True
        cursor = connection.cursor()
        cursor.execute("SELECT key FROM knowledge_discovery_limits WHERE key LIKE 'provider:%'")
        assert {row[0] for row in cursor.fetchall()} == {"provider:fed_rss", "provider:gdelt"}
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.skipif(not (os.getenv("IFRAME_KNOWLEDGE_TEST_PG_DISPOSABLE")
                         and os.getenv("IFRAME_KNOWLEDGE_TEST_PG_SOCKET")),
                    reason="Committed integration fixtures require a disposable PostgreSQL cluster")
def test_api_and_independent_worker_complete_fixture_capture(monkeypatch, tmp_path):
    socket_path = os.environ["IFRAME_KNOWLEDGE_TEST_PG_SOCKET"]

    def connect():
        return pg8000.dbapi.connect(unix_sock=socket_path, user=os.environ["USER"],
                                    database="postgres")

    monkeypatch.setattr(store, "connect", connect)
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_BACKEND", "local")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_ROOT", str(tmp_path))
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "fixture-owner-a")
    monkeypatch.setattr(discovery, "discover", lambda *args: [
        {"url": "https://example.org/fixture", "title": "Fixture article",
         "access_status": "public"},
    ])
    with connect() as connection:
        store.migrate(connection)
        connection.commit()

    app = FastAPI()
    app.include_router(api.router)
    owner = UserContext("user", "fixture-owner-a", "A", "token")
    app.dependency_overrides[require_user_context] = lambda: owner
    with TestClient(app) as client:
        created = client.post("/knowledge/research", json={
            "query": "Fixture article", "session_id": "fixture-session",
        })
        assert created.status_code == 201
        run_id = created.json()["id"]
        selected = client.post(f"/knowledge/research/{run_id}/sources", json={
            "urls": ["https://example.org/fixture"],
        })
        assert selected.status_code == 200
        assert selected.json()["status"] == "capturing"

    worker_script = """
import os
import pg8000.dbapi
from src.apps.knowledge import capture, store, worker
store.connect = lambda: pg8000.dbapi.connect(
    unix_sock=os.environ['IFRAME_KNOWLEDGE_TEST_PG_SOCKET'],
    user=os.environ['USER'], database='postgres')
capture.capture_article = lambda url: (
    b'<h1>Fixture article</h1><p>Verified fixture evidence</p>',
    [{'kind': 'text', 'locator': 'block:1', 'body': 'Verified fixture evidence',
      'labels': [], 'annotation': None}])
assert worker.run_once() is True
"""
    result = subprocess.run([sys.executable, "-c", worker_script],
                            check=False, capture_output=True, text=True, timeout=20,
                            env=os.environ.copy())
    assert result.returncode == 0, result.stderr

    with TestClient(app) as client:
        ready = client.get(f"/knowledge/research/{run_id}")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"
        app.dependency_overrides[require_user_context] = lambda: UserContext(
            "user", "fixture-owner-b", "B", "token")
        assert client.get(f"/knowledge/research/{run_id}").status_code == 404

    with store.transaction() as connection:
        run, evidence = store.research_evidence(connection, owner.owner_profile_id, run_id)
        assert run["status"] == "ready"
        assert len(evidence) == 1
        assert evidence[0]["excerpt"] == "Verified fixture evidence"
        cursor = connection.cursor()
        cursor.execute("SELECT raw_object_key FROM knowledge_source_revisions WHERE id = %s",
                       (evidence[0]["revision_id"],))
        assert b"Verified fixture evidence" in blob_store.get(cursor.fetchone()[0])
