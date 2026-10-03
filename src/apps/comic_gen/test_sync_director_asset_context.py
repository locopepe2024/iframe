from types import SimpleNamespace

from src.apps.comic_gen.models import (
    Character,
    DirectorPlanBeat,
    DirectorPlanCastBinding,
    DirectorPlanScene,
    DirectorPlanShot,
    DirectorProfile,
    Scene,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_sync_descriptions_includes_admitted_scene_and_time_character_context():
    shot = DirectorPlanShot(
        shot_id="shot-1",
        order=0,
        character_ids=["char-shenxia"],
        cast_bindings=[{
            "person_id": "char-shenxia",
            "era_variant_id": "shenxia-university",
            "scene_look_id": "shenxia-winter-outdoor",
            "continuity_state": {"outerwear": "on"},
        }],
        scene_binding={
            "interior_exterior": "exterior",
            "time_of_day": "day",
            "season": "winter",
            "weather": "clear",
        },
    )
    plan = SimpleNamespace(
        scenes=[SimpleNamespace(
            scene_ref="21、学校 日 外",
            heading="学校",
            scene_id="scene-1",
            location="西安校园",
            time_anchor="2020年冬天",
            beats=[SimpleNamespace(shots=[shot])],
        )]
    )
    profile = DirectorProfile(revision=2, setting={"time": "2020年冬天", "geography": "西安"})
    script = SimpleNamespace(
        director_shooting_plan_draft=plan,
        director_shooting_plan_revisions=[],
    )
    character = Character(id="char-shenxia", name="沈夏", description="基础身份：女大学生，温婉。")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.effective_director_profile = lambda _script: profile

    pipeline._sync_director_character_context(script, character)

    assert "基础身份：女大学生，温婉。" in character.description
    assert "2020年冬天" in character.description
    assert "西安校园" in character.description
    assert "shenxia-winter-outdoor" in character.description
    assert character.digital_avatar["director_context"]["scene_variants"][0]["season"] == "winter"


def test_sync_scene_description_includes_plan_time_and_environment():
    planned = SimpleNamespace(
        scene_id="scene-1", scene_ref="学校 日 外", heading="学校", location="西安校园",
        time_anchor="2020年冬天", environment_atmosphere="清冷冬日",
        continuity_in="", continuity_out="", beats=[],
    )
    script = SimpleNamespace(
        director_shooting_plan_draft=SimpleNamespace(scenes=[planned]),
        director_shooting_plan_revisions=[],
    )
    scene = Scene(id="scene-1", name="学校", description="校园基础环境")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)

    pipeline._sync_director_scene_context(script, scene)

    assert "校园基础环境" in scene.description
    assert "2020年冬天" in scene.description
    assert "清冷冬日" in scene.description
