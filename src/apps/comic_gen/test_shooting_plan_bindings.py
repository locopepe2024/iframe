import pytest

from src.apps.comic_gen.models import DirectorPlanCastBinding, DirectorPlanShot


def test_shot_accepts_timeline_look_and_continuity_bindings():
    shot = DirectorPlanShot(
        shot_id="shot-1",
        order=0,
        character_ids=["character-1"],
        cast_bindings=[{
            "person_id": "person-1",
            "era_variant_id": "university",
            "scene_look_id": "winter-outdoor",
            "continuity_state": {"outerwear": "on"},
            "binding_status": "selected",
        }],
        scene_binding={
            "scene_asset_id": "campus-winter",
            "interior_exterior": "exterior",
            "season": "winter",
            "binding_status": "suggested",
        },
        prop_bindings=[{"prop_id": "luggage", "state": "present", "binding_status": "confirmed"}],
    )

    assert shot.cast_bindings[0].person_id == "person-1"
    assert shot.cast_bindings[0].scene_look_id == "winter-outdoor"
    assert shot.scene_binding.interior_exterior == "exterior"
    assert shot.prop_bindings[0].state == "present"


def test_shot_rejects_duplicate_cast_binding_person_ids():
    with pytest.raises(ValueError, match="cast binding person IDs"):
        DirectorPlanShot(
            shot_id="shot-1",
            order=0,
            cast_bindings=[
                {"person_id": "person-1"},
                {"person_id": "person-1"},
            ],
        )
