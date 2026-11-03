from copy import deepcopy

import pytest

from scripts.director3d.export_reviewed_shot_handoff import build_handoff
from src.apps.recreation.shot_review import timeline_key


def reviewed_record():
    record = {
        "id": "project-1", "analysis_id": "analysis-1", "source_fingerprint": "source-hash",
        "analysis": {"frame_pts": [0, 512], "time_base": [1, 12800]},
        "timeline": {"shots": [{"id": "shot-1", "start_pts": 0, "end_pts": 1024}]},
    }
    record["shot_review"] = {
        "analysis_id": "analysis-1", "source_fingerprint": "source-hash",
        "timeline_key": timeline_key(record), "review_revision": 7,
        "items": [{
            "id": "human:optics", "kind": "optics", "shot_id": "shot-1",
            "frame_span": [1, 2], "evidence_frames": [1], "actor_id": "",
            "candidate": "", "edited_text": "Fixed camera, zoom out",
            "decision": "accept", "source": {"provenance": "human"},
        }],
    }
    return record


def test_export_preserves_accepted_human_annotation():
    handoff = build_handoff(reviewed_record(), 0, 7)
    assert handoff["review_revision"] == 7
    assert handoff["frame_range"] == [1, 2]
    assert handoff["events"][0]["reviewed_text"] == "Fixed camera, zoom out"


def test_export_rejects_empty_accepted_text_and_stale_revision():
    record = reviewed_record()
    with pytest.raises(ValueError, match="review revision changed"):
        build_handoff(record, 0, 6)
    record = deepcopy(record)
    record["shot_review"]["items"][0]["source"] = {"provenance": "model_candidate"}
    record["shot_review"]["items"][0]["edited_text"] = ""
    with pytest.raises(ValueError, match="has no text"):
        build_handoff(record, 0, 7)
