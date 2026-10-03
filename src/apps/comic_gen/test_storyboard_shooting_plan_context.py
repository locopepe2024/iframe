from types import SimpleNamespace

from src.apps.comic_gen.models import DirectorPlanScene, DirectorShootingPlan
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_storyboard_context_projects_scene_time_and_bindings():
    plan = DirectorShootingPlan(
        source_revision=1,
        source_revision_id="source-1",
        director_profile_revision=1,
        director_profile_hash="director-1",
        effective_style_hash="style-1",
        scenes=[DirectorPlanScene(
            scene_id="scene-1",
            order=0,
            scene_ref="21、学校 日 外",
            heading="学校",
            location="西安校园",
            time_anchor="2020年冬天",
        )],
    )
    script = SimpleNamespace(
        director_shooting_plan_draft=plan,
        director_shooting_plan_revisions=[],
    )

    context = ComicGenPipeline._storyboard_shooting_plan_context(script)

    assert context["scenes"][0]["time_anchor"] == "2020年冬天"
    assert context["scenes"][0]["location"] == "西安校园"
