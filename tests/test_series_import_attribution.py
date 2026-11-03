"""Mixed series submissions keep detailed source in the assigned episodes."""

import json
from threading import RLock
from types import SimpleNamespace

import pytest

from src.apps.comic_gen.import_attribution import materialize, structured_assignments, validate_assignments
from src.apps.comic_gen.models import Script, Series
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


STRUCTURED_SOURCE = (
    "全剧规则：第一视角。\n"
    "五、角色详细设定\n"
    "甲（第1—2集）｜旧城\n"
    "角色锚点：甲保留一枚徽章。\n"
    "月读牢笼：甲初次见面就把主角按在赌桌上。\n"
    "第1集·进入：甲在旧城遇到主角。\n"
    "第2集·离开：甲把徽章交给主角。\n"
    "关系节点：甲在离开时改变想法。\n"
    "信物：徽章。\n"
    "乙（第3—4集）｜新城\n"
    "角色锚点：乙守着一扇门。\n"
    "第3集·进入：主角来到新城。\n"
    "第4集·离开：乙打开门。\n"
    "六、4集分集标题速览\n"
    "第1集 旧城相遇：甲出现。\n"
    "第2集 徽章：甲交出徽章。\n"
    "第3集 新城：乙出现。\n"
    "第4集 门打开：乙打开门。\n"
    "七、结尾与制作备注\n"
    "第4集结尾画面：门后是清晨。\n"
    "制作备注：镜头保持稳定。\n"
)


def test_structured_series_routes_shared_and_episode_source_without_model_assignment():
    assignments = structured_assignments(STRUCTURED_SOURCE, 4)
    assert assignments is not None
    series, episodes, _ = materialize(STRUCTURED_SOURCE, assignments, 4)
    assert "全剧规则" in series and "分集标题速览" in series
    assert "制作备注" in series
    assert "关系节点" in series and "信物：徽章" in series
    assert "角色锚点：甲" in episodes[0] and "角色锚点：甲" in episodes[1]
    assert "初次见面就把主角按在赌桌上" in episodes[0]
    assert "初次见面就把主角按在赌桌上" not in episodes[1]
    assert "关系节点" not in episodes[0] and "信物：徽章" not in episodes[0]
    assert "第1集·进入" in episodes[0] and "第1集·进入" not in episodes[1]
    assert "第2集·离开" in episodes[1] and "第2集·离开" not in episodes[0]
    assert "第4集结尾画面" in episodes[3] and "第4集结尾画面" not in series
    assert all("标题速览" not in episode for episode in episodes)


def test_structured_series_preview_only_asks_model_for_episode_metadata():
    answers = {"episodes": [
        {"episode_number": number, "title": f"第{number}集标题", "summary": f"第{number}集摘要"}
        for number in range(1, 5)
    ]}
    prompts = []
    llm = SimpleNamespace(chat=lambda **kwargs: prompts.append(kwargs) or json.dumps(answers, ensure_ascii=False))
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.script_processor = SimpleNamespace(llm=llm)

    preview = pipeline.preview_series_import(STRUCTURED_SOURCE, 3)
    assert len(preview["episodes"]) == 4
    assert preview["episodes"][0]["title"] == "第1集标题"
    assert len(prompts) == 1
    assert "不需要重新判定段落归属" in prompts[0]["messages"][0]["content"]
    _, episodes, _ = materialize(STRUCTURED_SOURCE, preview["assignments"], 4)
    assert "第3集·进入" in episodes[2]


def test_structured_series_confirm_creates_episode_drafts_from_attributed_source():
    assignments = structured_assignments(STRUCTURED_SOURCE, 4)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {}
    pipeline._save_lock = RLock()
    pipeline.create_series = lambda title, description, **kwargs: Series(
        id="series", title=title, description=description, created_at=1, updated_at=1,
    )
    pipeline.script_processor = SimpleNamespace(create_draft_script=lambda title, text: Script(
        id=f"episode-{len(pipeline.scripts) + 1}", title=title, original_text=text,
        created_at=1, updated_at=1,
    ))
    pipeline.stamp_owned_children = lambda script: None
    pipeline._save_data = lambda: None
    pipeline._save_series_data_unlocked = lambda: None
    episodes = [{"episode_number": number, "title": f"第{number}集"} for number in range(1, 5)]

    result = pipeline.create_series_from_import("示例", STRUCTURED_SOURCE, episodes, assignments=assignments)

    first = pipeline.scripts["episode-1"]
    second = pipeline.scripts["episode-2"]
    assert first.episode_number == 1 and first.series_id == "series"
    assert "第1集·进入" in first.original_text
    assert "第2集·离开" not in first.original_text
    assert "第2集·离开" in second.original_text
    assert result["series"]["source_context"]["source_layout"] == "attributed"
    assert "分集标题速览" in result["series"]["source_context"]["preamble"]


def test_structured_series_declines_incomplete_group():
    incomplete = STRUCTURED_SOURCE.replace("第2集·离开：甲把徽章交给主角。\n", "")
    assert structured_assignments(incomplete, 4) is None
    non_pair = STRUCTURED_SOURCE.replace("甲（第1—2集）", "甲（第1—3集）")
    assert structured_assignments(non_pair, 4) is None


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
