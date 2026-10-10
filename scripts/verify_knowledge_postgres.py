"""Verify the live knowledge schema and owner visibility without persisting fixtures."""

import uuid

from src.apps.knowledge import store


def verify():
    connection = store.connect()
    try:
        store.migrate(connection)
        store.migrate(connection)
        cursor = connection.cursor()
        cursor.execute("SELECT count(*) FROM knowledge_schema_versions WHERE version = 1")
        assert cursor.fetchone()[0] == 1
        cursor.execute("SELECT count(*) FROM knowledge_schema_versions WHERE version = 2")
        assert cursor.fetchone()[0] == 1

        owner_a = f"test-a-{uuid.uuid4()}"
        owner_b = f"test-b-{uuid.uuid4()}"
        public_id, unpublished_id, source_id, revision_id = (uuid.uuid4() for _ in range(4))
        for collection_id, name in ((public_id, "published"), (unpublished_id, "unpublished")):
            cursor.execute(
                """INSERT INTO knowledge_collections (id, scope, name, domain)
                   VALUES (%s, 'public_reference', %s, 'test')""",
                (collection_id, name),
            )
        cursor.execute(
            """INSERT INTO knowledge_sources (id, collection_id, source_uri, title, source_type)
               VALUES (%s, %s, 'test://article', 'Test article', 'web')""",
            (source_id, public_id),
        )
        cursor.execute(
            """INSERT INTO knowledge_source_revisions
               (id, source_id, raw_sha256, raw_object_key, capture_status)
               VALUES (%s, %s, %s, 'test/unused', 'captured')""",
            (revision_id, source_id, "a" * 64),
        )
        cursor.execute(
            """INSERT INTO knowledge_content_units
               (id, source_revision_id, kind, locator, body, labels)
               VALUES (%s, %s, 'text', 'section:public', 'Public print market evidence', %s)""",
            (uuid.uuid4(), revision_id, ["public"]),
        )
        cursor.execute(
            """INSERT INTO knowledge_publications
               (id, collection_id, source_revision_id, curator_id, rights_decision, status)
               VALUES (%s, %s, %s, 'test-curator', 'test-fixture', 'published')""",
            (uuid.uuid4(), public_id, revision_id),
        )
        a_collection = store.create_owner_collection(connection, owner_a, "A private", "test")
        b_collection = store.create_owner_collection(connection, owner_b, "B private", "test")

        a_ids = {item["id"] for item in store.visible_collections(connection, owner_a)}
        b_ids = {item["id"] for item in store.visible_collections(connection, owner_b)}
        assert a_ids == {str(public_id), a_collection["id"]}
        assert b_ids == {str(public_id), b_collection["id"]}
        assert str(unpublished_id) not in a_ids | b_ids
        assert len(store.search(connection, owner_a, "Public print", 10)) == 1
        assert len(store.search(connection, owner_b, "Public print", 10)) == 1

        source = {"source_uri": "upload:integration-check", "title": "Printing industry",
                  "source_type": "manual", "rights_status": "owned"}
        units = [
            {"kind": "text", "locator": "section:1", "body": "Printing policy 2026",
             "labels": ["policy"], "annotation": "Reviewed source quote"},
            {"kind": "image", "locator": "figure:1", "body": "Printing press",
             "labels": ["equipment"], "annotation": "Image label", "asset_key": "media/" + "b" * 64,
             "media_sha256": "b" * 64, "media_type": "image/png"},
            {"kind": "video_segment", "locator": "00:00:01-00:00:03", "body": "Production line",
             "labels": ["production"], "annotation": "Video label", "asset_key": "media/" + "c" * 64,
             "media_sha256": "c" * 64, "media_type": "video/mp4"},
        ]
        imported = store.import_source(connection, owner_a, a_collection["id"], source,
                                       "raw/" + "a" * 64, "a" * 64, units)
        repeated = store.import_source(connection, owner_a, a_collection["id"], source,
                                       "raw/" + "a" * 64, "a" * 64, units)
        assert imported["created"] and not repeated["created"]
        assert imported["revision_id"] == repeated["revision_id"]
        assert len(imported["units"]) == 3
        changed = store.import_source(connection, owner_a, a_collection["id"], source,
                                      "raw/" + "d" * 64, "d" * 64, units)
        assert changed["created"] and changed["revision_id"] != imported["revision_id"]
        assert store.get_source(connection, owner_a, imported["source_id"])["revision_id"] in {
            imported["revision_id"], changed["revision_id"]
        }
        try:
            store.get_source(connection, owner_b, imported["source_id"])
        except store.KnowledgeAccessDenied:
            pass
        else:
            raise AssertionError("Owner B could read owner A's source")
        text_hits = store.search(connection, owner_a, "Printing", 10)
        assert len(text_hits) == 3
        assert {hit["kind"] for hit in text_hits} == {"text", "image", "video_segment"}
        assert store.search(connection, owner_a, "Image label", 10)[0]["kind"] == "image"
        assert store.search(connection, owner_a, "Production", 10, kind="video_segment")[0]["kind"] == "video_segment"
        assert store.search(connection, owner_b, "Printing", 10) == []
        image_id = next(unit["id"] for unit in imported["units"] if unit["kind"] == "image")
        assert store.get_media(connection, owner_a, image_id)[1] == "image/png"
        try:
            store.get_media(connection, owner_b, image_id)
        except store.KnowledgeAccessDenied:
            pass
        else:
            raise AssertionError("Owner B could read owner A's media")
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    verify()
    print("knowledge_postgres=ok; fixtures=rolled_back")
