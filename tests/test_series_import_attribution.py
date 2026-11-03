"""Mixed series submissions keep detailed source in the assigned episodes."""

import json
from types import SimpleNamespace

import pytest

from src.apps.comic_gen.import_attribution import materialize, validate_assignments
from src.apps.comic_gen.pipeline import ComicGenPipeline


MIXED_SOURCE = (
    "全剧规则：第一视角。\n"
    "纲手（第1—2集）｜赌局牢笼\n"
    "原著锚点：浅黄长发。\n"
    "月读牢笼：赌桌永远亮着灯。\n"
    "第1集·调教：她让你掷骰，观察你有没有流血。\n"
    "第2集·破局：她摘下项链。\n"
    "分集标题速览\n"
    "第1集 月读之下\n"
    "第2集 筹码不能流血\n"
    "制作备注：竖版构图。\n"
)


def _assignments():
    return [
        {"start_line": 1, "end_line": 1, "scope": "series", "episodes": []},
        {"start_line": 2, "end_line": 4, "scope": "episode", "episodes": [1, 2]},
        {"start_line": 5, "end_line": 5, "scope": "episode", "episodes": [1]},
        {"start_line": 6, "end_line": 6, "scope": "episode", "episodes": [2]},
        {"start_line": 7, "end_line": 10, "scope": "series", "episodes": []},
    ]


def test_preview_and_materialize_mixed_source():
    answer = {"episodes": [
        {"episode_number": 1, "title": "月读之下", "summary": "赌桌"},
        {"episode_number": 2, "title": "筹码不能流血", "summary": "项链"},
    ], "assignments": _assignments()}
    prompts = []
    llm = SimpleNamespace(chat=lambda **kwargs: prompts.append(kwargs) or json.dumps(answer, ensure_ascii=False))
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.script_processor = SimpleNamespace(llm=llm)

    preview = pipeline.preview_series_import(MIXED_SOURCE, 1)
    assert preview["episodes"][0]["source_layout"] == "attributed"
    assert len(preview["episodes"]) == 2
    assert len(prompts) == 1
    assert "第1集·调教" in prompts[0]["messages"][0]["content"]
    series, episodes, checked = materialize(MIXED_SOURCE, preview["assignments"], 2)
    assert "第1集·调教" in episodes[0]
    assert "第2集·破局" not in episodes[0]
    assert "原著锚点" in episodes[0] and "原著锚点" in episodes[1]
    assert "第1集 月读之下" in series
    assert "全剧规则" in series
    assert checked[2]["source"] == "第1集·调教：她让你掷骰，观察你有没有流血。\n"


def test_user_correction_changes_saved_episode_source():
    assignments = _assignments()
    assignments[2] = {**assignments[2], "scope": "episode", "episodes": [2]}
    _, episodes, _ = materialize(MIXED_SOURCE, assignments, 2)
    assert "第1集·调教" not in episodes[0]
    assert "第1集·调教" in episodes[1]


def test_incomplete_or_unassigned_source_cannot_be_confirmed():
    with pytest.raises(ValueError, match="不完整"):
        validate_assignments(MIXED_SOURCE, _assignments()[:-1], 2)
    assignments = _assignments()
    assignments[2] = {**assignments[2], "scope": "unassigned", "episodes": []}
    with pytest.raises(ValueError, match="未分配"):
        materialize(MIXED_SOURCE, assignments, 2)


def test_preview_keeps_uncertain_source_for_user_correction():
    answer = {"episodes": [
        {"episode_number": 1, "title": "第一集"},
        {"episode_number": 2, "title": "第二集"},
    ], "assignments": [
        {"start_line": 1, "end_line": 10, "scope": "unassigned", "episodes": []},
    ]}
    llm = SimpleNamespace(chat=lambda **kwargs: json.dumps(answer, ensure_ascii=False))
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.script_processor = SimpleNamespace(llm=llm)
    preview = pipeline.preview_series_import(MIXED_SOURCE, 2)
    assert preview["assignments"][0]["scope"] == "unassigned"
    assert preview["assignments"][0]["source"] == MIXED_SOURCE


def test_mixed_import_requires_assignments_even_without_client_marker():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    with pytest.raises(ValueError, match="缺少原文归属"):
        pipeline.create_series_from_import(
            "月读", MIXED_SOURCE,
            [{"episode_number": 1, "title": "第一集"}, {"episode_number": 2, "title": "第二集"}],
        )


def test_contiguous_episode_script_uses_existing_split_path():
    source = "第1集 开场\n正文一\n第2集 结尾\n正文二\n"
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.script_processor = SimpleNamespace(split_into_episodes=lambda text, count: [
        {"episode_number": number, "title": f"第{number}集"} for number in range(1, count + 1)
    ])
    preview = pipeline.preview_series_import(source, 2)
    assert "assignments" not in preview
    assert len(preview["episodes"]) == 2
