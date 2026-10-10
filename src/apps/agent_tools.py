"""Bounded, owner-scoped read-only tools for Agent chat."""

from fastapi import HTTPException
from pg8000.dbapi import Error as PostgresError

from .knowledge import store


def search_knowledge(owner_profile_id: str, query: str) -> list[dict]:
    try:
        with store.transaction() as connection:
            hits = store.search(connection, owner_profile_id, query, 5)
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "知识库检索暂不可用，本次消息未发送") from exc
    return [
        {
            "unit_id": hit["unit_id"],
            "revision_id": hit["revision_id"],
            "source_id": hit["source_id"],
            "collection_id": hit["collection_id"],
            "scope": hit["scope"],
            "kind": hit["kind"],
            "locator": hit["locator"],
            "title": hit["title"],
            "source_uri": hit["source_uri"],
            "rights_status": hit["rights_status"],
            "has_media": hit["has_media"],
            "excerpt": (hit.get("excerpt") or "")[:1200],
            "annotation": (hit.get("annotation") or "")[:500],
        }
        for hit in hits[:5]
    ]
