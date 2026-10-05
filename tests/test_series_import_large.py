"""Large numbered series imports preserve every episode's original text."""

import pytest
from unittest.mock import patch

from src.apps.comic_gen.llm import ScriptProcessor, split_numbered_episodes
from src.apps.comic_gen.models import Script
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _sixty_episode_text():
    preamble = "剧本梗概：一部武侠漫剧。\n"
    episodes = [f"第 {number} 集：剑影{number}\n" + f"本集剧情{number}。" * 500
                for number in range(1, 61)]
    return preamble + "\n".join(episodes), episodes


def test_numbered_sixty_episode_import_keeps_exact_source():
    text, source_episodes = _sixty_episode_text()
    assert len(text) > 80000
    processor = ScriptProcessor.__new__(ScriptProcessor)
    preview_source = text[text.index("第 1 集"):]
    preview = processor.split_into_episodes(preview_source, 60)
    assert len(preview) == 60
    assert preview[0]["start_offset"] == 0
    assert preview[-1]["end_offset"] == len(preview_source)

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    context, screenplay = pipeline._split_import_series_context(text)
    assert context["preamble"] == "剧本梗概：一部武侠漫剧。"
    assert context["synopsis"] == "一部武侠漫剧。"
    chunks = pipeline._split_text_by_markers(screenplay, preview)
    assert "".join(chunks) == screenplay
    assert len(chunks) == 60
    for number, (chunk, source) in enumerate(zip(chunks, source_episodes), 1):
        assert chunk.startswith(f"第 {number} 集：剑影{number}")
        assert source.strip() in chunk


def test_confirm_sixty_episodes_persists_separate_scripts(tmp_path):
    text, source_episodes = _sixty_episode_text()
    with patch("src.apps.comic_gen.pipeline.ScriptProcessor"), \
         patch("src.apps.comic_gen.pipeline.AssetGenerator"), \
         patch("src.apps.comic_gen.pipeline.StoryboardGenerator"), \
         patch("src.apps.comic_gen.pipeline.VideoGenerator"), \
         patch("src.apps.comic_gen.pipeline.AudioGenerator"), \
         patch("src.apps.comic_gen.pipeline.ExportManager"):
        pipeline = ComicGenPipeline()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.series_data_file = str(tmp_path / "series.json")
    pipeline.scripts = {}
    pipeline.series_store = {}
    pipeline.script_processor.create_draft_script.side_effect = (
        lambda title, source: Script(id=f"episode-{len(pipeline.scripts) + 1}",
                                     title=title, original_text=source,
                                     created_at=1, updated_at=1)
    )
    _, screenplay = pipeline._split_import_series_context(text)
    preview = split_numbered_episodes(screenplay, 60)
    result = pipeline.create_series_from_import("剑影", text, preview)

    assert len(result["episodes"]) == 60
    assert len(pipeline.scripts) == 60
    for number, source in enumerate(source_episodes, 1):
        saved = pipeline.scripts[f"episode-{number}"]
        assert saved.episode_number == number
        assert saved.original_text.strip() == source.strip()


def test_numbered_import_rejects_missing_episode_and_invalid_offsets():
    text, _ = _sixty_episode_text()
    screenplay = text[text.index("第 1 集"):]
    with pytest.raises(ValueError, match="不一致"):
        split_numbered_episodes(screenplay, 59)
    with pytest.raises(ValueError, match="编号不连续"):
        split_numbered_episodes(screenplay.replace("第 30 集", "第 31 集"), 60)

    preview = split_numbered_episodes(screenplay, 60)
    preview[1]["start_offset"] += 1
    with pytest.raises(ValueError, match="位置无效"):
        ComicGenPipeline._split_text_by_markers(None, screenplay, preview)


def test_markdown_and_chinese_numbered_headings():
    text = "## 第一集：相遇\n正文一\n### 第二集：离别\n正文二"
    episodes = split_numbered_episodes(text, 2)
    assert [episode["title"] for episode in episodes] == ["第一集：相遇", "第二集：离别"]
    assert text[episodes[0]["start_offset"]:episodes[0]["end_offset"]].endswith("正文一\n")
