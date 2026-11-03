from copy import deepcopy

from fastapi import HTTPException
import pytest

from src.apps.recreation.shot_review import timeline_key
from tests.test_recreation import completed, service, video


def reviewed(service, video):
    project = completed(service, video)
    cut = project["analysis"]["frame_pts"][5]
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [cut])
    candidate = {"events": [
        {"id": "kick-1", "actor_id": "man", "frame_span": [2, 3], "evidence_frames": [2], "action": "first kick"},
        {"id": "kick-2", "actor_id": "man", "frame_span": [4, 5], "evidence_frames": [5], "action": "second kick"},
    ]}
    saved = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 0, candidate=candidate)
    return saved


def test_shot_review_import_preserves_distinct_actions_and_human_edit(service, video):
    project = reviewed(service, video)
    review = project["shot_review"]
    assert [item["id"] for item in review["items"]] == ["action:kick-1", "action:kick-2"]
    items = deepcopy(review["items"])
    items[0]["decision"] = "edit"
    items[0]["edited_text"] = "left leg kicks forward"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=items)
    assert project["shot_review"]["items"][0]["source"]["action"] == "first kick"
    assert project["shot_review"]["items"][0]["edited_text"] == "left leg kicks forward"


def test_shot_review_rejects_cross_shot_and_outside_evidence(service, video):
    project = reviewed(service, video)
    review = project["shot_review"]
    items = deepcopy(review["items"])
    items[0]["frame_span"] = [2, 7]
    with pytest.raises(HTTPException) as exc:
        service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=items)
    assert exc.value.status_code == 422
    items = deepcopy(review["items"])
    items[0]["evidence_frames"] = [7]
    with pytest.raises(HTTPException) as exc:
        service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=items)
    assert exc.value.status_code == 422


def test_shot_review_stales_after_cut_change(service, video):
    project = reviewed(service, video)
    old_key = timeline_key(project)
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [])
    assert timeline_key(project) != old_key
    with pytest.raises(HTTPException) as exc:
        service.save_shot_review(project["id"], project["analysis_id"], old_key, 1, items=[])
    assert exc.value.status_code == 409


def test_object_track_import_keeps_short_observation_and_original_source(service, video):
    project = completed(service, video)
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [])
    track = {"id": "timer-2", "description": "brief falling object", "first_visible_frame": 2,
             "last_visible_frame": 2, "observations": [{"frame": 2}, {"frame": 3}]}
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 0,
                                       candidate={"object_tracks": [track]})
    item = project["shot_review"]["items"][0]
    assert item["kind"] == "object"
    assert item["frame_span"] == [2, 3]
    assert item["evidence_frames"] == [2, 3]
    assert item["source"] == track
    assert item["decision"] == "pending"


def test_manual_object_annotation_can_start_review_without_model(service, video):
    project = completed(service, video)
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [])
    item = {"id": "manual:timer-2", "kind": "object", "shot_id": project["timeline"]["shots"][0]["id"],
            "frame_span": [2, 3], "evidence_frames": [2, 3], "candidate": "",
            "edited_text": "Possible second object, identity unconfirmed", "decision": "edit",
            "actor_id": "", "source": {"provenance": "human"}}
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 0,
                                       items=[item])
    assert project["shot_review"]["items"] == [item]
    item["decision"] = "accept"
    item["edited_text"] = ""
    with pytest.raises(HTTPException, match="Accepted manual annotations require human text"):
        service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=[item])


def test_scene_candidate_is_scoped_to_each_confirmed_shot(service, video):
    project = completed(service, video)
    cut = project["analysis"]["frame_pts"][5]
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [cut])
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 0,
                                       candidate={"scene": {"visible_elements": ["hallway"]}})
    scenes = project["shot_review"]["items"]
    assert [(item["shot_id"], item["frame_span"]) for item in scenes] == [
        (project["timeline"]["shots"][0]["id"], [1, 5]),
        (project["timeline"]["shots"][1]["id"], [6, len(project["analysis"]["frame_pts"])]),
    ]
