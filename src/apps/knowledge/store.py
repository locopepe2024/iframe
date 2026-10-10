"""PostgreSQL ownership boundary for shared and personal collections."""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import ssl
import uuid

import pg8000.dbapi


def connect():
    required = (
        "IFRAME_KNOWLEDGE_PG_HOST",
        "IFRAME_KNOWLEDGE_PG_USER",
        "IFRAME_KNOWLEDGE_PG_PASSWORD_FILE",
        "IFRAME_KNOWLEDGE_PG_CA_FILE",
    )
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("Knowledge database is not configured: " + ", ".join(missing))
    password_path = Path(os.environ["IFRAME_KNOWLEDGE_PG_PASSWORD_FILE"])
    ca_path = Path(os.environ["IFRAME_KNOWLEDGE_PG_CA_FILE"])
    context = ssl.create_default_context(cafile=str(ca_path))
    return pg8000.dbapi.connect(
        host=os.environ["IFRAME_KNOWLEDGE_PG_HOST"],
        port=int(os.getenv("IFRAME_KNOWLEDGE_PG_PORT", "5432")),
        database=os.getenv("IFRAME_KNOWLEDGE_PG_DATABASE", "iframe_knowledge"),
        user=os.environ["IFRAME_KNOWLEDGE_PG_USER"],
        password=password_path.read_text().strip(),
        ssl_context=context,
        timeout=10,
    )


@contextmanager
def transaction():
    connection = connect()
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def migrate(connection):
    cursor = connection.cursor()
    cursor.execute("SELECT pg_advisory_xact_lock(42820101)")
    cursor.execute("CREATE TABLE IF NOT EXISTS knowledge_schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
    for version, filename in ((1, "schema.sql"), (2, "schema_v2.sql"), (3, "schema_v3.sql")):
        cursor.execute("SELECT 1 FROM knowledge_schema_versions WHERE version = %s", (version,))
        if cursor.fetchone():
            continue
        cursor.execute((Path(__file__).parent / filename).read_text())
        cursor.execute("INSERT INTO knowledge_schema_versions (version) VALUES (%s)", (version,))


def create_owner_collection(connection, owner_profile_id: str, name: str, domain: str):
    collection_id = str(uuid.uuid4())
    cursor = connection.cursor()
    cursor.execute(
        """INSERT INTO knowledge_collections
           (id, scope, owner_profile_id, name, domain)
           VALUES (%s, 'owner', %s, %s, %s)
           RETURNING id::text, scope, name, domain, revision""",
        (collection_id, owner_profile_id, name, domain),
    )
    return dict(zip(("id", "scope", "name", "domain", "revision"), cursor.fetchone()))


def visible_collections(connection, owner_profile_id: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT id::text, scope, name, domain, revision
           FROM knowledge_collections
           WHERE status = 'active'
             AND ((scope = 'public_reference' AND EXISTS (
               SELECT 1 FROM knowledge_publications p
               WHERE p.collection_id = knowledge_collections.id AND p.status = 'published'
             )) OR (scope = 'owner' AND owner_profile_id = %s))
           ORDER BY scope, name, id""",
        (owner_profile_id,),
    )
    columns = ("id", "scope", "name", "domain", "revision")
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


class KnowledgeAccessDenied(Exception):
    pass


def _owner_collection(connection, collection_id: str, owner_profile_id: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT id FROM knowledge_collections
           WHERE id = %s AND scope = 'owner' AND owner_profile_id = %s AND status = 'active'""",
        (collection_id, owner_profile_id),
    )
    if not cursor.fetchone():
        raise KnowledgeAccessDenied("Collection is not available")


def create_research_run(connection, owner: str, session_id: str, query: str,
                        collection_id: str, intent: dict | None = None):
    _owner_collection(connection, collection_id, owner)
    run_id = str(uuid.uuid4())
    cursor = connection.cursor()
    cursor.execute(
        """INSERT INTO knowledge_research_runs
           (id, owner_profile_id, session_id, query, intent, collection_id, status)
           VALUES (%s, %s, %s, %s, %s::jsonb, %s, 'discovering')""",
        (run_id, owner, session_id, query, json.dumps(intent or {}), collection_id),
    )
    return run_id


def ensure_research_collection(connection, owner: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT id::text FROM knowledge_collections
           WHERE scope = 'owner' AND owner_profile_id = %s AND domain = 'research'
             AND status = 'active' ORDER BY created_at, id LIMIT 1""", (owner,),
    )
    row = cursor.fetchone()
    if row:
        return row[0]
    return create_owner_collection(connection, owner, "研究资料", "research")["id"]


def get_research_run(connection, owner: str, run_id: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT id::text, session_id, query, intent, collection_id::text, status,
                  candidates, error_code, created_at, updated_at
           FROM knowledge_research_runs WHERE id = %s AND owner_profile_id = %s""",
        (run_id, owner),
    )
    row = cursor.fetchone()
    if not row:
        raise KnowledgeAccessDenied("Research run is not available")
    keys = ("id", "session_id", "query", "intent", "collection_id", "status", "candidates",
            "error_code", "created_at", "updated_at")
    result = dict(zip(keys, row))
    if isinstance(result["candidates"], str):
        result["candidates"] = json.loads(result["candidates"])
    if isinstance(result["intent"], str):
        result["intent"] = json.loads(result["intent"])
    cursor.execute(
        """SELECT id::text, source_url, state, attempts, source_id::text,
                  revision_id::text, error_code
           FROM knowledge_capture_jobs WHERE run_id = %s AND owner_profile_id = %s
           ORDER BY created_at, id""",
        (run_id, owner),
    )
    result["jobs"] = [dict(zip(("id", "source_url", "state", "attempts", "source_id",
                                "revision_id", "error_code"), item)) for item in cursor.fetchall()]
    return result


def finish_discovery(connection, owner: str, run_id: str, candidates: list[dict], error_code: str | None = None):
    cursor = connection.cursor()
    cursor.execute(
        """UPDATE knowledge_research_runs SET candidates = %s::jsonb, error_code = %s,
                  status = %s, updated_at = now()
           WHERE id = %s AND owner_profile_id = %s AND status = 'discovering'""",
        (json.dumps(candidates), error_code,
         "failed" if error_code else "awaiting_selection", run_id, owner),
    )
    if cursor.rowcount != 1:
        raise KnowledgeAccessDenied("Research run is not available")


def select_research_sources(connection, owner: str, run_id: str, urls: list[str]):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT id FROM knowledge_research_runs
           WHERE id = %s AND owner_profile_id = %s FOR UPDATE""", (run_id, owner),
    )
    if not cursor.fetchone():
        raise KnowledgeAccessDenied("Research run is not available")
    run = get_research_run(connection, owner, run_id)
    if run["status"] != "awaiting_selection":
        raise ValueError("Research run is not awaiting source selection")
    allowed = {item["url"] for item in run["candidates"] if item.get("access_status") == "public"}
    if not urls or len(urls) > 5 or len(set(urls)) != len(urls) or any(url not in allowed for url in urls):
        raise ValueError("Selected sources are not available candidates")
    for url in urls:
        cursor.execute(
            """INSERT INTO knowledge_capture_jobs
               (id, run_id, owner_profile_id, source_url, state)
               VALUES (%s, %s, %s, %s, 'queued')""",
            (str(uuid.uuid4()), run_id, owner, url),
        )
    cursor.execute(
        """UPDATE knowledge_research_runs SET status = 'capturing', updated_at = now()
           WHERE id = %s AND owner_profile_id = %s""", (run_id, owner),
    )
    return get_research_run(connection, owner, run_id)


def reserve_discovery(connection, owner: str) -> bool:
    cursor = connection.cursor()
    cursor.execute("SELECT pg_advisory_xact_lock(42820102)")
    for key, daily_limit in (("provider:gdelt", 200), ("owner:" + owner, 20)):
        cursor.execute(
            """SELECT CASE WHEN day = current_date THEN used ELSE 0 END,
                      next_at > now() FROM knowledge_discovery_limits WHERE key = %s""", (key,),
        )
        row = cursor.fetchone()
        if row and (row[0] >= daily_limit or row[1]):
            return False
    for key, delay in (("provider:gdelt", "5 seconds"), ("owner:" + owner, "0 seconds")):
        cursor.execute(
            """INSERT INTO knowledge_discovery_limits (key, day, used, next_at)
               VALUES (%s, current_date, 1, now() + %s::interval)
               ON CONFLICT (key) DO UPDATE SET
                 day = current_date,
                 used = CASE WHEN knowledge_discovery_limits.day = current_date
                             THEN knowledge_discovery_limits.used + 1 ELSE 1 END,
                 next_at = now() + %s::interval""", (key, delay, delay),
        )
    return True


def claim_capture_job(connection):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT j.id::text, j.run_id::text, j.owner_profile_id, j.source_url,
                  r.collection_id::text, r.candidates, j.attempts
           FROM knowledge_capture_jobs j
           JOIN knowledge_research_runs r ON r.id = j.run_id
           WHERE j.state = 'queued' OR
                 (j.state = 'running' AND j.lease_until < now() AND j.attempts < 3)
           ORDER BY j.created_at, j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1"""
    )
    row = cursor.fetchone()
    if not row:
        return None
    keys = ("id", "run_id", "owner", "source_url", "collection_id", "candidates", "attempts")
    job = dict(zip(keys, row))
    if isinstance(job["candidates"], str):
        job["candidates"] = json.loads(job["candidates"])
    cursor.execute(
        """UPDATE knowledge_capture_jobs
           SET state = 'running', attempts = attempts + 1,
               lease_until = now() + interval '90 seconds', updated_at = now()
           WHERE id = %s""", (job["id"],),
    )
    return job


def fail_exhausted_jobs(connection):
    cursor = connection.cursor()
    cursor.execute(
        """UPDATE knowledge_capture_jobs SET state = 'failed', error_code = 'lease_exhausted',
                  lease_until = NULL, updated_at = now()
           WHERE state = 'running' AND lease_until < now() AND attempts >= 3
           RETURNING run_id::text"""
    )
    for run_id in {row[0] for row in cursor.fetchall()}:
        cursor.execute(
            """UPDATE knowledge_research_runs SET status = CASE
                 WHEN EXISTS (SELECT 1 FROM knowledge_capture_jobs
                              WHERE run_id = %s AND state IN ('queued', 'running')) THEN 'capturing'
                 WHEN EXISTS (SELECT 1 FROM knowledge_capture_jobs
                              WHERE run_id = %s AND state = 'ready') THEN 'partial'
                 ELSE 'failed' END, updated_at = now() WHERE id = %s""",
            (run_id, run_id, run_id),
        )


def finish_capture_job(connection, job: dict, source_id: str | None = None,
                       revision_id: str | None = None, error_code: str | None = None):
    cursor = connection.cursor()
    cursor.execute(
        """UPDATE knowledge_capture_jobs SET state = %s, source_id = %s,
                  revision_id = %s, error_code = %s, lease_until = NULL,
                  updated_at = now()
           WHERE id = %s AND state = 'running' AND lease_until > now()""",
        ("failed" if error_code else "ready", source_id, revision_id, error_code, job["id"]),
    )
    if cursor.rowcount != 1:
        raise RuntimeError("Capture job lease expired")
    cursor.execute(
        """UPDATE knowledge_research_runs SET status = CASE
               WHEN EXISTS (SELECT 1 FROM knowledge_capture_jobs
                            WHERE run_id = %s AND state IN ('queued', 'running')) THEN 'capturing'
               WHEN EXISTS (SELECT 1 FROM knowledge_capture_jobs
                            WHERE run_id = %s AND state = 'ready')
                    AND EXISTS (SELECT 1 FROM knowledge_capture_jobs
                                WHERE run_id = %s AND state = 'failed') THEN 'partial'
               WHEN EXISTS (SELECT 1 FROM knowledge_capture_jobs
                            WHERE run_id = %s AND state = 'ready') THEN 'ready'
               ELSE 'failed' END, updated_at = now() WHERE id = %s""",
        (job["run_id"], job["run_id"], job["run_id"], job["run_id"], job["run_id"]),
    )


def research_evidence(connection, owner: str, run_id: str):
    run = get_research_run(connection, owner, run_id)
    if run["status"] not in ("ready", "partial"):
        raise ValueError("Research capture is not complete")
    cursor = connection.cursor()
    cursor.execute(
           """SELECT u.id::text, j.revision_id::text, j.source_id::text,
                  u.kind, u.locator, left(coalesce(u.body, ''), 1200),
                  j.source_url, s.title, r.captured_at
           FROM knowledge_capture_jobs j
           JOIN knowledge_sources s ON s.id = j.source_id
           JOIN knowledge_source_revisions r ON r.id = j.revision_id AND r.source_id = s.id
           JOIN knowledge_content_units u ON u.source_revision_id = r.id
           WHERE j.run_id = %s AND j.owner_profile_id = %s AND j.state = 'ready'
           ORDER BY j.created_at, u.created_at LIMIT 20""", (run_id, owner),
    )
    columns = ("unit_id", "revision_id", "source_id", "kind", "locator", "excerpt",
               "source_uri", "title", "captured_at")
    return run, [{**dict(zip(columns, row)), "captured_at": row[-1].isoformat()}
                 for row in cursor.fetchall()]


def import_source(connection, owner_profile_id: str, collection_id: str, source: dict,
                  raw_key: str, raw_sha256: str, units: list[dict]):
    _owner_collection(connection, collection_id, owner_profile_id)
    cursor = connection.cursor()
    source_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO knowledge_sources
           (id, collection_id, source_uri, title, source_type, rights_status)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (collection_id, source_uri) DO NOTHING""",
        (source_id, collection_id, source["source_uri"], source["title"],
         source["source_type"], source["rights_status"]),
    )
    cursor.execute(
        "SELECT id::text FROM knowledge_sources WHERE collection_id = %s AND source_uri = %s",
        (collection_id, source["source_uri"]),
    )
    source_id = cursor.fetchone()[0]
    proposed_revision_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO knowledge_source_revisions
           (id, source_id, raw_sha256, raw_object_key, capture_status)
           VALUES (%s, %s, %s, %s, 'captured')
           ON CONFLICT (source_id, raw_sha256) DO NOTHING RETURNING id::text""",
        (proposed_revision_id, source_id, raw_sha256, raw_key),
    )
    inserted = cursor.fetchone()
    if inserted:
        revision_id = inserted[0]
        for unit in units:
            cursor.execute(
                """INSERT INTO knowledge_content_units
                   (id, source_revision_id, kind, locator, body, asset_key,
                    labels, annotation, media_type, media_sha256)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (str(uuid.uuid4()), revision_id, unit["kind"], unit["locator"],
                 unit.get("body"), unit.get("asset_key"), unit["labels"],
                 unit.get("annotation"), unit.get("media_type"), unit.get("media_sha256")),
            )
        created = True
    else:
        cursor.execute(
            """SELECT id::text FROM knowledge_source_revisions
               WHERE source_id = %s AND raw_sha256 = %s""",
            (source_id, raw_sha256),
        )
        revision_id = cursor.fetchone()[0]
        created = False
    cursor.execute(
        """SELECT id::text, kind, locator FROM knowledge_content_units
           WHERE source_revision_id = %s ORDER BY created_at, id""",
        (revision_id,),
    )
    return {"source_id": source_id, "revision_id": revision_id,
            "created": created, "units": [dict(zip(("id", "kind", "locator"), row))
                                         for row in cursor.fetchall()]}


_VISIBLE_JOINS = """
    JOIN knowledge_source_revisions r ON r.source_id = s.id
    JOIN knowledge_collections c ON c.id = s.collection_id
"""

_VISIBLE_RULE = """c.status = 'active' AND (
        (c.scope = 'owner' AND c.owner_profile_id = %s AND r.id = (
            SELECT latest.id FROM knowledge_source_revisions latest
            WHERE latest.source_id = s.id
            ORDER BY latest.captured_at DESC, latest.id DESC LIMIT 1
        ))
        OR (c.scope = 'public_reference' AND EXISTS (
            SELECT 1 FROM knowledge_publications p
            WHERE p.collection_id = c.id AND p.source_revision_id = r.id
              AND p.status = 'published'
        ))
    )"""


def get_source(connection, owner_profile_id: str, source_id: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT s.id::text, s.source_uri, s.title, s.source_type, s.rights_status,
                  c.id::text, c.scope, c.domain, r.id::text, r.captured_at
           FROM knowledge_sources s """ + _VISIBLE_JOINS + """
           WHERE """ + _VISIBLE_RULE + """ AND s.id = %s
           ORDER BY r.captured_at DESC, r.id DESC LIMIT 1""",
        (owner_profile_id, source_id),
    )
    row = cursor.fetchone()
    if not row:
        raise KnowledgeAccessDenied("Source is not available")
    keys = ("id", "source_uri", "title", "source_type", "rights_status",
            "collection_id", "scope", "domain", "revision_id", "captured_at")
    result = dict(zip(keys, row))
    cursor.execute(
        """SELECT id::text, kind, locator, body, labels, annotation, media_type,
                  asset_key IS NOT NULL AS has_media
           FROM knowledge_content_units WHERE source_revision_id = %s
           ORDER BY created_at, id""",
        (result["revision_id"],),
    )
    columns = ("id", "kind", "locator", "body", "labels", "annotation", "media_type", "has_media")
    result["units"] = [dict(zip(columns, unit)) for unit in cursor.fetchall()]
    return result


def get_media(connection, owner_profile_id: str, unit_id: str):
    cursor = connection.cursor()
    cursor.execute(
        """SELECT u.asset_key, u.media_type FROM knowledge_content_units u
           JOIN knowledge_source_revisions r ON r.id = u.source_revision_id
           JOIN knowledge_sources s ON s.id = r.source_id
           JOIN knowledge_collections c ON c.id = s.collection_id
           WHERE u.id = %s AND u.asset_key IS NOT NULL AND c.status = 'active'
             AND ((c.scope = 'owner' AND c.owner_profile_id = %s)
                  OR (c.scope = 'public_reference' AND EXISTS (
                      SELECT 1 FROM knowledge_publications p
                      WHERE p.collection_id = c.id AND p.source_revision_id = r.id
                        AND p.status = 'published')))
           """,
        (unit_id, owner_profile_id),
    )
    row = cursor.fetchone()
    if not row:
        raise KnowledgeAccessDenied("Media is not available")
    return row


def search(connection, owner_profile_id: str, query: str, limit: int,
           domain: str | None = None, kind: str | None = None,
           collection_id: str | None = None):
    cursor = connection.cursor()
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    filters = ["(u.body ILIKE %s OR u.annotation ILIKE %s OR s.title ILIKE %s OR array_to_string(u.labels, ' ') ILIKE %s)"]
    params = [query, owner_profile_id, pattern, pattern, pattern, pattern]
    if domain:
        filters.append("c.domain = %s")
        params.append(domain)
    if kind:
        filters.append("u.kind = %s")
        params.append(kind)
    if collection_id:
        filters.append("c.id = %s")
        params.append(collection_id)
    params.append(limit)
    cursor.execute(
        """SELECT u.id::text, u.kind, u.locator,
                  substr(u.body, greatest(1, strpos(lower(u.body), lower(%s)) - 150), 1200),
                  u.labels, u.annotation,
                  u.asset_key IS NOT NULL AS has_media, s.id::text, s.title,
                  s.source_uri, s.rights_status, r.id::text, c.id::text, c.scope, c.domain
           FROM knowledge_sources s """ + _VISIBLE_JOINS + """
           JOIN knowledge_content_units u ON u.source_revision_id = r.id
           WHERE """ + _VISIBLE_RULE + " AND " + " AND ".join(filters) + """
           ORDER BY r.captured_at DESC, u.created_at, u.id LIMIT %s""",
        tuple(params),
    )
    columns = ("unit_id", "kind", "locator", "excerpt", "labels", "annotation",
               "has_media", "source_id", "title", "source_uri", "rights_status",
               "revision_id", "collection_id", "scope", "domain")
    return [dict(zip(columns, row)) for row in cursor.fetchall()]
