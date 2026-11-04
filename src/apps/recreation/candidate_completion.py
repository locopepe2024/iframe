"""Source-bound completion of model uncertainties before macro review."""

import hashlib
import json

from fastapi import HTTPException

from .shot_review import timeline_key


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def candidate_digest(record):
    review = record.get("shot_review") or {}
    candidates = [{key: item[key] for key in ("id", "kind", "shot_id", "frame_span", "candidate", "source")}
                  for item in review.get("items", []) if item.get("source", {}).get("provenance") != "human"]
    return _digest({"analysis_id": record.get("analysis_id"), "timeline_key": timeline_key(record),
                    "candidates": candidates})


def uncertainty_ids(record):
    return {item["id"] for item in (record.get("shot_review") or {}).get("items", [])
            if item["kind"] == "uncertainty" and item["source"].get("provenance") != "human"}


def model_candidate_ids(record):
    return {item["id"] for item in (record.get("shot_review") or {}).get("items", [])
            if item["source"].get("provenance") != "human"}


def required_ids(record, schema_version):
    if schema_version == "shot-candidate-completion.v2":
        return model_candidate_ids(record)
    if schema_version == "shot-candidate-completion.v1" and model_candidate_ids(record) == uncertainty_ids(record):
        return uncertainty_ids(record)
    return set()


def valid_completion(record):
    completion = record.get("candidate_completion") or {}
    return bool(completion.get("status") == "completed"
                and completion.get("source_fingerprint") == record.get("source_fingerprint")
                and completion.get("analysis_id") == record.get("analysis_id")
                and completion.get("timeline_key") == timeline_key(record)
                and completion.get("candidate_digest") == candidate_digest(record)
                and required_ids(record, completion.get("schema_version"))
                and {row["item_id"] for row in completion.get("items", [])} ==
                    required_ids(record, completion.get("schema_version")))


def import_completion(record, package):
    if not isinstance(package, dict) or package.get("schema_version") not in {
            "shot-candidate-completion.v1", "shot-candidate-completion.v2"}:
        raise HTTPException(422, "Invalid candidate completion schema")
    if package["schema_version"] == "shot-candidate-completion.v1" and model_candidate_ids(record) != uncertainty_ids(record):
        raise HTTPException(422, "Second pass must cover every model candidate")
    for key, value in (("source_fingerprint", record.get("source_fingerprint")),
                       ("analysis_id", record.get("analysis_id")),
                       ("timeline_key", timeline_key(record)),
                       ("candidate_digest", candidate_digest(record))):
        if package.get(key) != value:
            raise HTTPException(409, f"Candidate completion {key} changed")
    run_id = package.get("run_id")
    if not isinstance(run_id, str) or not run_id or len(run_id) > 100:
        raise HTTPException(422, "Candidate completion run ID is required")
    items = package.get("items")
    if not isinstance(items, list) or len(items) > 300 or any(not isinstance(row, dict) for row in items):
        raise HTTPException(422, "Invalid candidate completion items")
    expected_ids = (model_candidate_ids(record) if package["schema_version"] == "shot-candidate-completion.v2"
                    else uncertainty_ids(record))
    originals = {item["id"]: item for item in record["shot_review"]["items"]
                 if item["id"] in expected_ids}
    ids = [row.get("item_id") for row in items]
    if len(ids) != len(set(ids)) or set(ids) != set(originals):
        raise HTTPException(422, "Every model candidate needs one second-pass result")
    frames = record["analysis"]["frame_pts"]
    shots = {shot["id"]: shot for shot in record["timeline"]["shots"]}
    for row in items:
        status = row.get("status")
        if status not in {"predicted", "unresolved"}:
            raise HTTPException(422, "Invalid candidate completion status")
        for field in ("prediction", "reason", "method"):
            if not isinstance(row.get(field), str) or len(row[field]) > 6000:
                raise HTTPException(422, f"Invalid candidate completion {field}")
        if not row["reason"].strip() or not row["method"].strip() or (status == "predicted" and not row["prediction"].strip()):
            raise HTTPException(422, "Completion needs a prediction or a specific unresolved reason")
        evidence = row.get("evidence_frames")
        if not isinstance(evidence, list) or not evidence or len(evidence) > 80:
            raise HTTPException(422, "Completion needs source-frame evidence")
        shot = shots[originals[row["item_id"]]["shot_id"]]
        if any(type(n) is not int or n < 1 or n > len(frames) or
               not shot["start_pts"] <= frames[n - 1] < shot["end_pts"] for n in evidence):
            raise HTTPException(422, "Completion evidence must remain in the same confirmed shot")
    return {"schema_version": package["schema_version"], "status": "completed",
            "source_fingerprint": record["source_fingerprint"], "analysis_id": record["analysis_id"],
            "timeline_key": timeline_key(record), "candidate_digest": candidate_digest(record),
            "run_id": run_id, "model": str(package.get("model") or ""),
            "prompt_revision": str(package.get("prompt_revision") or ""), "items": items}
