"""Optional disposable PostgreSQL research-job contract check."""

import os

import pg8000.dbapi
import pytest

from src.apps.knowledge import store


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
