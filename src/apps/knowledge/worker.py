"""Independent knowledge capture worker; run as a separate process."""

import logging
import time

from . import blob_store, capture, store

logger = logging.getLogger(__name__)


def run_once() -> bool:
    with store.transaction() as connection:
        store.fail_exhausted_jobs(connection)
        job = store.claim_capture_job(connection)
    if not job:
        return False
    try:
        raw, units = capture.capture_article(job["source_url"])
        candidate = next(item for item in job["candidates"] if item["url"] == job["source_url"])
        raw_key, raw_digest = blob_store.put("raw", raw)
        for unit in units:
            media = unit.pop("media_bytes", None)
            if media is not None:
                unit["asset_key"], unit["media_sha256"] = blob_store.put("media", media)
        source = {"source_uri": job["source_url"], "title": candidate["title"],
                  "source_type": "web", "rights_status": "unknown"}
        with store.transaction() as connection:
            result = store.import_source(connection, job["owner"], job["collection_id"],
                                         source, raw_key, raw_digest, units)
            store.finish_capture_job(connection, job, result["source_id"], result["revision_id"])
    except (capture.CaptureRejected, StopIteration) as exc:
        code = str(exc) if isinstance(exc, capture.CaptureRejected) else "candidate_missing"
        with store.transaction() as connection:
            store.finish_capture_job(connection, job, error_code=code)
    except Exception:
        logger.exception("Knowledge capture failed: job=%s", job["id"])
        with store.transaction() as connection:
            store.finish_capture_job(connection, job, error_code="capture_failed")
    return True


def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        if not run_once():
            time.sleep(2)


if __name__ == "__main__":
    main()
