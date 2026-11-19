from threading import RLock
from unittest.mock import Mock
import pytest
from src.apps.comic_gen.models import Script, ModelSettings
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_greena_new_containers_use_owner_catalog_and_episode_inherits_series(tmp_path, monkeypatch):
    store = Mock(); store.get_public.return_value = {'catalog_name':'greena'}
    store.get_runtime_uniart.return_value = {'catalog_name':'greena','api_key':'mock','base_url':'https://owner.invalid/v1'}
    monkeypatch.setattr('src.apps.user_config.get_user_config_store', lambda:store)
    fetch = Mock(return_value=[{'id':'nsfw/owner-image','capabilities':['t2i','i2i']},
                              {'id':'nsfw/owner-video','capabilities':['t2v','i2v','r2v']}])
    monkeypatch.setattr('src.utils.provider_catalog.fetch_selected_catalog',fetch)
    p=ComicGenPipeline.__new__(ComicGenPipeline);p._save_lock=RLock();p.series_store={};p.scripts={}
    p._save_series_data_unlocked=Mock();p._save_data=Mock();p._record_source_text=Mock();p.stamp_owned_children=Mock()
    p.script_processor=Mock();p.script_processor.create_draft_script.side_effect=lambda title,text:Script(id=title,title=title,original_text=text,created_at=0,updated_at=0)
    p.get_series=lambda ident,*_:p.series_store.get(ident)
    p.get_series_episodes=lambda ident:[];p.add_episode_to_series=Mock()
    series=p.create_series('series',owner_user_id='owner',owner_profile_id='owner')
    project=p.create_project('project','',True,owner_user_id='owner',owner_profile_id='owner')
    episode=p.create_project('episode','',True,series_id=series.id,owner_user_id='owner',owner_profile_id='owner')
    for target in (series,project,episode):
        assert target.model_settings.t2i_model==target.model_settings.i2i_model==target.model_settings.image_model=='nsfw/owner-image'
        assert target.model_settings.i2v_model==target.model_settings.r2v_model=='nsfw/owner-video'
    episode.model_settings.t2i_model='changed'
    assert series.model_settings.t2i_model=='nsfw/owner-image'
    assert fetch.call_count==2


def test_non_greena_owner_preserves_existing_defaults(monkeypatch):
    store=Mock();store.get_public.return_value={'catalog_name':'uniart'}
    monkeypatch.setattr('src.apps.user_config.get_user_config_store',lambda:store)
    assert ComicGenPipeline._initial_model_settings('owner','owner')==ModelSettings()
    store.get_runtime_uniart.assert_not_called()
    assert ComicGenPipeline._initial_model_settings(None,None)==ModelSettings()


def test_greena_missing_image_capability_never_uses_uniart_defaults(monkeypatch):
    store=Mock();store.get_public.return_value={'catalog_name':'greena'}
    monkeypatch.setattr('src.apps.user_config.get_user_config_store',lambda:store)
    monkeypatch.setattr('src.utils.provider_catalog.fetch_selected_catalog',lambda _:[])
    with pytest.raises(ValueError,match='no t2i model'):
        ComicGenPipeline._initial_model_settings('owner','owner')
