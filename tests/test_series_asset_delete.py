from threading import RLock
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import Character, Script, Series, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline, LibraryAssetInUseError


def make_pipeline():
    series = Series(id="series", title="Series", characters=[Character(id="shared", name="Lead", description="Lead")],
                    episode_ids=["episode"], created_at=1, updated_at=1)
    episode = Script(id="episode", title="Episode", original_text="", series_id="series",
                     created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline._save_series_data_unlocked = Mock()
    pipeline.series_store = {series.id: series}
    pipeline.scripts = {episode.id: episode}
    return pipeline, series, episode


def test_delete_unreferenced_series_character():
    pipeline, series, _ = make_pipeline()
    pipeline.delete_series_asset(series.id, "character", "shared")
    assert series.characters == []
    pipeline._save_series_data_unlocked.assert_called_once()


def test_delete_referenced_series_character_is_rejected():
    pipeline, series, episode = make_pipeline()
    episode.frames.append(StoryboardFrame(id="frame", scene_id="scene", character_ids=["shared"],
                                          action_description="Lead enters"))
    with pytest.raises(LibraryAssetInUseError):
        pipeline.delete_series_asset(series.id, "character", "shared")
    assert len(series.characters) == 1
    pipeline._save_series_data_unlocked.assert_not_called()


def test_force_delete_removes_episode_references():
    pipeline, series, episode = make_pipeline()
    pipeline._save_data = Mock()
    episode.frames.append(StoryboardFrame(id="frame", scene_id="scene", character_ids=["shared"],
                                          action_description="Lead enters"))
    pipeline.delete_series_asset(series.id, "character", "shared", force=True)
    assert series.characters == []
    assert episode.frames[0].character_ids == []
    pipeline._save_data.assert_called_once()
