"""Saved default synchronization; no inference of legacy override provenance."""
import json
import threading
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from src.apps.comic_gen.models import ModelSettings, Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def workspace(tmp_path):
    pipeline = object.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.data_file = str(tmp_path / 'projects.json')
    pipeline.series_data_file = str(tmp_path / 'series.json')
    series = Series(id='series', title='Series', owner_profile_id='owner', created_at=1, updated_at=1)
    episode = Script(id='episode', title='Episode', original_text='text', series_id=series.id,
                     owner_profile_id='owner', created_at=1, updated_at=1,
                     model_settings=series.model_settings.model_copy(deep=True))
    series.episode_ids = [episode.id]
    pipeline.series_store = {series.id: series}
    pipeline.scripts = {episode.id: episode}
    return pipeline, series, episode


def test_changed_defaults_persist_and_differing_episode_fields_survive_reload(workspace):
    pipeline, series, episode = workspace
    episode.model_settings.i2i_model = 'custom-i2i'
    episode.model_settings.scene_aspect_ratio = '1:1'
    new = series.model_settings.model_copy(update={'t2i_model': 'new-image', 'i2i_model': 'new-edit',
                                                  'scene_aspect_ratio': '9:16', 'r2v_model': 'new-video'})
    pipeline.update_series(series.id, {'model_settings': new})
    reloaded = pipeline._load_data()[episode.id]
    assert reloaded.model_settings.t2i_model == 'new-image'
    assert reloaded.model_settings.r2v_model == 'new-video'
    assert reloaded.model_settings.i2i_model == 'custom-i2i'
    assert reloaded.model_settings.scene_aspect_ratio == '1:1'
    assert reloaded.updated_at > 1
    assert json.loads(open(pipeline.series_data_file).read())[series.id]['model_settings']['t2i_model'] == 'new-image'
    assert episode.model_settings is not series.model_settings
    new.t2i_model = 'caller-mutated'
    assert episode.model_settings.t2i_model == 'new-image'
    assert series.model_settings.t2i_model == 'new-image'


@pytest.mark.parametrize('invalid_member', ['unlisted', 'wrong-series', 'wrong-owner'])
def test_only_same_owner_bidirectional_members_are_updated(workspace, invalid_member):
    pipeline, series, episode = workspace
    if invalid_member == 'unlisted':
        series.episode_ids = []
    elif invalid_member == 'wrong-series':
        episode.series_id = 'another-series'
    else:
        episode.owner_profile_id = 'another-owner'
    old = episode.model_settings.model_dump()
    pipeline._save_data = Mock()
    pipeline.update_series(series.id, {'model_settings': series.model_settings.model_copy(update={'t2i_model': 'new'})})
    assert episode.model_settings.model_dump() == old
    assert episode.updated_at == 1
    pipeline._save_data.assert_not_called()


def test_repeated_changes_advance_matching_fields_only(workspace):
    pipeline, series, episode = workspace
    for choice in ('first', 'second'):
        pipeline.update_series(series.id, {'model_settings': series.model_settings.model_copy(update={'t2i_model': choice})})
        assert episode.model_settings.t2i_model == choice
    episode.model_settings.t2i_model = 'episode-custom'
    pipeline.update_series(series.id, {'model_settings': series.model_settings.model_copy(update={'t2i_model': 'third'})})
    assert episode.model_settings.t2i_model == 'episode-custom'


def test_unrelated_and_noop_series_edits_do_not_rewrite_projects(workspace):
    pipeline, series, episode = workspace
    pipeline._save_data = Mock()
    pipeline.update_series(series.id, {'title': 'Renamed'})
    pipeline.update_series(series.id, {'model_settings': series.model_settings.model_copy()})
    assert episode.updated_at == 1
    pipeline._save_data.assert_not_called()


def test_settings_dictionary_is_validated_before_mutating_series(workspace):
    pipeline, series, episode = workspace
    old = series.model_settings.model_dump()
    with pytest.raises(ValidationError):
        pipeline.update_series(series.id, {'title': 'Must not apply', 'model_settings': {'t2i_model': []}})
    assert series.title == 'Series'
    assert series.model_settings.model_dump() == old
    assert episode.model_settings.model_dump() == old
    updated = dict(old, t2i_model='valid-dict')
    pipeline.update_series(series.id, {'model_settings': updated})
    assert isinstance(series.model_settings, ModelSettings)
    assert episode.model_settings.t2i_model == 'valid-dict'
