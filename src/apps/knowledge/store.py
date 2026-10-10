"""PostgreSQL ownership boundary for shared and personal collections."""

from contextlib import contextmanager
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
    for version, filename in ((1, "schema.sql"), (2, "schema_v2.sql")):
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
