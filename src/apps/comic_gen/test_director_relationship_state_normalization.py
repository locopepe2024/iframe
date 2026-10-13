from src.apps.comic_gen.models import normalize_director_profile_draft


def test_relationship_changes_within_one_phase_keep_both_states_and_events():
    draft = {"story_map": {"relationship_arcs": [{
        "arc_id": "rel_a_b",
        "states": [
            {"phase_id": "phase_1", "state": "互不信任", "trigger_event_ids": ["event_1"]},
            {"phase_id": "phase_1", "state": "建立合作", "trigger_event_ids": ["event_2"]},
        ],
    }]}}

    arc = normalize_director_profile_draft(draft)["story_map"]["relationship_arcs"][0]

    assert arc["relationship_id"] == "rel_a_b"
    assert arc["states"] == [{
        "phase_id": "phase_1",
        "state": "互不信任 → 建立合作",
        "trigger_event_ids": ["event_1", "event_2"],
        "source_fact_ids": [],
    }]


def test_relationship_states_with_different_evidence_are_not_merged():
    draft = {"story_map": {"relationship_arcs": [{
        "relationship_id": "rel_a_b",
        "states": [
            {"phase_id": "phase_1", "state": "互不信任", "evidence_status": "interpretation"},
            {"phase_id": "phase_1", "state": "建立合作", "evidence_status": "uncertain"},
        ],
    }]}}

    arc = normalize_director_profile_draft(draft)["story_map"]["relationship_arcs"][0]

    assert len(arc["states"]) == 2
