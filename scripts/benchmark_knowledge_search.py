"""Rollback-only keyword latency check on the configured PostgreSQL instance."""

from statistics import quantiles
from time import perf_counter
import uuid

from src.apps.knowledge import store


def main():
    connection = store.connect()
    try:
        store.migrate(connection)
        owner = f"benchmark-{uuid.uuid4()}"
        collection = store.create_owner_collection(connection, owner, "Benchmark", "test")
        source_id, revision_id = uuid.uuid4(), uuid.uuid4()
        cursor = connection.cursor()
        cursor.execute(
            """INSERT INTO knowledge_sources (id, collection_id, source_uri, title, source_type)
               VALUES (%s, %s, 'upload:benchmark', 'Benchmark source', 'manual')""",
            (source_id, collection["id"]),
        )
        cursor.execute(
            """INSERT INTO knowledge_source_revisions
               (id, source_id, raw_sha256, raw_object_key, capture_status)
               VALUES (%s, %s, %s, 'raw/benchmark', 'captured')""",
            (revision_id, source_id, "e" * 64),
        )
        cursor.executemany(
            """INSERT INTO knowledge_content_units
               (id, source_revision_id, kind, locator, body, labels)
               VALUES (%s, %s, 'text', %s, %s, %s)""",
            [(uuid.uuid4(), revision_id, f"section:{index}",
              f"Printing industry policy evidence {index}" if index % 10 == 0
              else f"Other industry evidence {index}", ["policy"])
             for index in range(1000)],
        )
        times = []
        for _ in range(30):
            started = perf_counter()
            hits = store.search(connection, owner, "Printing industry", 10)
            times.append((perf_counter() - started) * 1000)
            assert len(hits) == 10
        print(f"knowledge_search_1000_units_p95_ms={quantiles(times, n=20)[18]:.1f}; fixtures=rolled_back")
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
