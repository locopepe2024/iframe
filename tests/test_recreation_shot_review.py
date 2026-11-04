from copy import deepcopy
from io import BytesIO
import json
from zipfile import ZipFile

from fastapi import HTTPException
import pytest

from src.apps.recreation.shot_review import timeline_key
from src.apps.recreation.candidate_completion import candidate_digest, model_candidate_ids, valid_completion
from scripts.director3d.export_reviewed_shot_handoff import build_handoff
from scripts.recreation.second_pass_infer import infer_pack
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


def test_second_pass_uses_adjacent_source_frames_and_imports_model_result(service, video):
    project = reviewed(service, video)
    pack = service.second_pass_frame_pack(project["id"], project["analysis_id"], timeline_key(project))
    with ZipFile(BytesIO(pack)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["source_fingerprint"] == project["source_fingerprint"]
        first = manifest["candidates"][0]
        assert first["frame_span"] == [2, 3]
        assert first["reference_frames"] == [1, 2, 3, 4]
        assert first["first_analysis_source"]["action"] == "first kick"
        assert first["context"][0]["first_analysis"] == "second kick"
        assert all(archive.read(frame["file"]) for frame in manifest["frames"])

    calls = []
    def model(messages, **kwargs):
        parts = messages[1]["content"]
        calls.append(parts)
        frame = int(next(part["text"].split()[2].rstrip(",") for part in parts
                         if part["type"] == "text" and part["text"].startswith("Source frame")))
        return json.dumps({"status": "predicted", "prediction": "motion continues",
                           "reason": "ordered adjacent frames", "evidence_frames": [frame]})

    result = infer_pack(pack, "test-vision", chat=model)
    assert len(calls) == len(manifest["candidates"])
    assert sum(part["type"] == "image_url" for part in calls[0]) == 4
    saved = service.import_candidate_completion(project["id"], project["analysis_id"],
                                                timeline_key(project), result)
    assert valid_completion(saved)


def test_second_pass_rejects_stale_timeline_and_model_evidence(service, video):
    project = reviewed(service, video)
    with pytest.raises(HTTPException, match="source changed"):
        service.second_pass_frame_pack(project["id"], project["analysis_id"], "stale")
    pack = service.second_pass_frame_pack(project["id"], project["analysis_id"], timeline_key(project))
    def model(_messages, **_kwargs):
        return json.dumps({"status": "predicted", "prediction": "unsupported",
                           "reason": "guess", "evidence_frames": [999]})
    with pytest.raises(ValueError, match="Invalid model result"):
        infer_pack(pack, "test-vision", chat=model)


def test_import_surfaces_unknown_analysis_without_overwriting_review(service, video):
    project = reviewed(service, video)
    items = deepcopy(project["shot_review"]["items"])
    items[0]["decision"] = "edit"
    items[0]["edited_text"] = "Reviewed left kick"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=items)
    candidate = {"events": [
        {"id": "kick-1", "actor_id": "man", "frame_span": [2, 3], "evidence_frames": [2],
         "action": "model kick", "contact": "unknown", "left_right_basis": "unknown: blurred leg",
         "uncertainty": "sole hidden"}],
        "transitions": [{"from": "a", "to": "b", "evidence_frames": [2, 3], "unknown": "landing frame unclear"}],
        "unresolved": ["camera motion cannot be separated from subject motion"]}
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 2,
                                       candidate=candidate)
    rows = project["shot_review"]["items"]
    assert rows[0]["edited_text"] == "Reviewed left kick"
    assert rows[0]["source"]["action"] == "first kick"
    assert {row["source"].get("field") for row in rows if row["kind"] == "uncertainty"} >= {
        "contact", "left_right_basis", "uncertainty", "unknown", "unresolved"}
    assert all(row["decision"] == "pending" for row in rows[2:])


def test_model_uncertainties_need_source_bound_completion_before_macro_freeze(service, video):
    project = reviewed(service, video)
    candidate = {"events": [{"id": "new", "actor_id": "man", "frame_span": [2, 3],
                             "evidence_frames": [2], "action": "turn", "contact": "unknown"}]}
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                       candidate=candidate)
    items = cover_macro_shots(project, deepcopy(project["shot_review"]["items"]))
    for item in items:
        item["decision"] = "unknown"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 2, items=items)
    with pytest.raises(HTTPException, match="Complete second analysis"):
        service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 3)
    uncertainty = next(item for item in items if item["kind"] == "uncertainty")
    package = {"schema_version": "shot-candidate-completion.v2", "run_id": "temporal-1",
               "source_fingerprint": project["source_fingerprint"], "analysis_id": project["analysis_id"],
               "timeline_key": timeline_key(project), "candidate_digest": candidate_digest(project),
               "items": [{"item_id": item["id"], "status": "predicted",
                          "prediction": "Contact is most likely brief" if item == uncertainty else item["candidate"],
                          "reason": "Adjacent source frames bound the motion", "method": "temporal_llm",
                          "evidence_frames": item["evidence_frames"] or [item["frame_span"][0]]}
                         for item in items if item["id"] in model_candidate_ids(project)]}
    partial = deepcopy(package)
    partial["schema_version"] = "shot-candidate-completion.v1"
    partial["items"] = [row for row in partial["items"] if row["item_id"] == uncertainty["id"]]
    with pytest.raises(HTTPException, match="every model candidate"):
        service.import_candidate_completion(project["id"], project["analysis_id"], timeline_key(project), partial)
    invalid = deepcopy(package)
    next(row for row in invalid["items"] if row["item_id"] == uncertainty["id"])["evidence_frames"] = [
        1, len(project["analysis"]["frame_pts"])]
    with pytest.raises(HTTPException, match="same confirmed shot"):
        service.import_candidate_completion(project["id"], project["analysis_id"], timeline_key(project), invalid)
    project = service.import_candidate_completion(project["id"], project["analysis_id"], timeline_key(project), package)
    assert valid_completion(project)
    project = service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 3)
    assert project["macro_review"]["macro_revision"] == 3
    changed = deepcopy(project["shot_review"]["items"])
    next(item for item in changed if item["kind"] == "uncertainty")["candidate"] = "different model claim"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 3, items=changed)
    assert not valid_completion(project)


def test_handoff_requires_separate_support_and_contact_review(service, video):
    project = reviewed(service, video)
    items = deepcopy(project["shot_review"]["items"])
    for item in items:
        item["decision"] = "accept"
        item["source"]["contact"] = "forefoot"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1, items=items)
    with pytest.raises(ValueError, match="frozen macro review is missing"):
        build_handoff(project, 0, 2)
    for item in items:
        item["reviewed_support_side"] = "right"
        item["reviewed_contact_type"] = "unknown"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 2, items=items)
    with pytest.raises(ValueError, match="frozen macro review is missing"):
        build_handoff(project, 0, 3)


def detail_candidate(project):
    items = []
    for shot in project["timeline"]["shots"]:
        frames = [n for n, pts in enumerate(project["analysis"]["frame_pts"], 1)
                  if shot["start_pts"] <= pts < shot["end_pts"]]
        for kind in ("body", "camera", "foot"):
            sides = ("screen_left", "screen_right") if kind == "foot" else (None,)
            for side in sides:
                source = {"provenance": "model_candidate"}
                if side:
                    source.update(screen_foot=side, anatomical_foot="unknown",
                                  support_state="unknown", sole_contact="unknown",
                                  contact_target="unknown", uncertainty="occluded")
                items.append({"id": f"{shot['id']}:{kind}:{side}", "kind": kind,
                              "shot_id": shot["id"], "frame_span": [frames[0], frames[-1]],
                              "evidence_frames": [frames[0]], "candidate": "uncertain",
                              "edited_text": "", "decision": "pending", "actor_id": "A1", "source": source})
    return {"run_id": "detail-pass-1", "macro_digest": project["macro_review"]["digest"],
            "source_fingerprint": project["source_fingerprint"], "items": items}


def cover_macro_shots(project, items):
    covered = {item["shot_id"] for item in items}
    for shot in project["timeline"]["shots"]:
        if shot["id"] not in covered:
            frames = [n for n, pts in enumerate(project["analysis"]["frame_pts"], 1)
                      if shot["start_pts"] <= pts < shot["end_pts"]]
            items.append({"id": f"manual:{shot['id']}", "kind": "action", "shot_id": shot["id"],
                          "frame_span": [frames[0], frames[-1]], "evidence_frames": [frames[0]],
                          "candidate": "", "edited_text": "Phase uncertain", "decision": "unknown",
                          "actor_id": "A1", "source": {"provenance": "human"}})
    return items


def complete_second_analysis(service, project):
    package = {"schema_version": "shot-candidate-completion.v2", "run_id": "second-pass-test",
               "source_fingerprint": project["source_fingerprint"], "analysis_id": project["analysis_id"],
               "timeline_key": timeline_key(project), "candidate_digest": candidate_digest(project),
               "items": [{"item_id": item["id"], "status": "predicted", "prediction": item["candidate"],
                          "reason": "Adjacent source frames agree", "method": "temporal-review",
                          "evidence_frames": item["evidence_frames"] or [item["frame_span"][0]]}
                         for item in project["shot_review"]["items"] if item["id"] in model_candidate_ids(project)]}
    return service.import_candidate_completion(project["id"], project["analysis_id"], timeline_key(project), package)


def test_two_stage_review_gates_handoff_and_keeps_unknown_explicit(service, video):
    project = reviewed(service, video)
    with pytest.raises(HTTPException, match="pending decisions"):
        service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 1)
    items = deepcopy(project["shot_review"]["items"])
    for item in items:
        item.update(decision="unknown", reviewed_support_side="unknown", reviewed_contact_type="unknown")
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                       items=cover_macro_shots(project, items))
    project = complete_second_analysis(service, project)
    project = service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 2)
    candidate = detail_candidate(project)
    candidate["macro_digest"] = "stale"
    with pytest.raises(HTTPException, match="frozen macro"):
        service.import_detail_review(project["id"], project["analysis_id"], timeline_key(project), candidate)
    candidate = detail_candidate(project)
    candidate["items"].pop()
    with pytest.raises(HTTPException, match="coverage is incomplete"):
        service.import_detail_review(project["id"], project["analysis_id"], timeline_key(project), candidate)
    project = service.import_detail_review(project["id"], project["analysis_id"], timeline_key(project), detail_candidate(project))
    with pytest.raises(HTTPException, match="pending decisions"):
        service.save_detail_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                   project["detail_review"]["items"], approve=True)
    detail = deepcopy(project["detail_review"]["items"])
    for item in detail:
        item["decision"] = "unknown"
    project = service.save_detail_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                         detail, approve=True)
    handoff = build_handoff(project, 0, 2)
    assert handoff["detail_run_id"] == "detail-pass-1"
    assert handoff["detail_review_revision"] == 2
    assert handoff["constraints"]["hard_ik_intervals"] == []


def test_detail_preserves_one_to_three_frame_foot_transition(service, video):
    project = reviewed(service, video)
    items = deepcopy(project["shot_review"]["items"])
    for item in items:
        item["decision"] = "unknown"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                       items=cover_macro_shots(project, items))
    project = complete_second_analysis(service, project)
    project = service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 2)
    candidate = detail_candidate(project)
    first_shot = project["timeline"]["shots"][0]["id"]
    left = next(item for item in candidate["items"] if item["shot_id"] == first_shot and
                item["kind"] == "foot" and item["source"]["screen_foot"] == "screen_left")
    left["frame_span"] = [1, 1]
    left["source"].update(support_state="supporting", sole_contact="full_sole", contact_target="ground")
    second = deepcopy(left)
    second["id"] += ":heel-rise"
    second["frame_span"] = [2, 3]
    second["evidence_frames"] = [2, 3]
    second["source"].update(sole_contact="forefoot")
    candidate["items"].append(second)
    with pytest.raises(HTTPException, match="coverage is incomplete"):
        service.import_detail_review(project["id"], project["analysis_id"], timeline_key(project), candidate)


def test_detail_edit_replaces_model_values_in_handoff(service, video):
    project = reviewed(service, video)
    macro_items = cover_macro_shots(project, deepcopy(project["shot_review"]["items"]))
    for item in macro_items:
        item["decision"] = "unknown"
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                       items=macro_items)
    project = complete_second_analysis(service, project)
    project = service.freeze_macro_review(project["id"], project["analysis_id"], timeline_key(project), 2)
    project = service.import_detail_review(project["id"], project["analysis_id"], timeline_key(project),
                                           detail_candidate(project))
    items = deepcopy(project["detail_review"]["items"])
    foot = next(item for item in items if item["kind"] == "foot" and item["source"]["screen_foot"] == "screen_left")
    foot["decision"] = "edit"
    foot["edited_text"] = "Left screen foot supports on full sole"
    foot["reviewed_values"] = {
        "screen_foot": "screen_left", "anatomical_foot": "unknown",
        "support_state": "supporting", "sole_contact": "full_sole", "contact_target": "ground",
        "uncertainty": "Anatomical side is not visible",
    }
    for item in items:
        if item is not foot:
            item["decision"] = "unknown"
            item["edited_text"] = "Evidence does not resolve this interval"
    tampered = deepcopy(items)
    tampered_foot = next(item for item in tampered if item["id"] == foot["id"])
    tampered_foot["source"]["sole_contact"] = "toe"
    with pytest.raises(HTTPException, match="Model candidates cannot be changed"):
        service.save_detail_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                   tampered, approve=False)
    project = service.save_detail_review(project["id"], project["analysis_id"], timeline_key(project), 1,
                                         items, approve=True)
    exported = build_handoff(project, 0, 2)
    actual = next(item for item in exported["detail_items"] if item["id"] == foot["id"])
    assert actual["reviewed_text"] == "Left screen foot supports on full sole"
    assert actual["reviewed_values"]["sole_contact"] == "full_sole"
    assert set(actual["reviewed_values"]) == {
        "screen_foot", "anatomical_foot", "support_state", "sole_contact", "contact_target", "uncertainty"}
    assert "source" not in actual and "candidate" not in actual
    assert foot["source"]["sole_contact"] == "unknown"
    other = next(item for item in exported["detail_items"] if item["id"] != foot["id"])
    assert other["reviewed_text"] == "Evidence does not resolve this interval"
    assert other["reviewed_values"] is None


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


def test_partial_analysis_does_not_spread_global_claims_to_later_shots(service, video):
    project = completed(service, video)
    cut = project["analysis"]["frame_pts"][5]
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [cut])
    candidate = {"scene": {"visible_elements": ["garden"]}, "unresolved": ["camera uncertain"],
                 "events": [{"id": "opening", "actor_id": "A1", "frame_span": [1, 5],
                             "evidence_frames": [1, 5], "action": "turn"}]}
    project = service.save_shot_review(project["id"], project["analysis_id"], timeline_key(project), 0,
                                       candidate=candidate)
    assert {item["shot_id"] for item in project["shot_review"]["items"]} == {project["timeline"]["shots"][0]["id"]}
