"""Gateway selection must preserve credential/endpoint and protocol boundaries."""
from types import SimpleNamespace
import sys

import pytest
from fastapi import HTTPException

from src.apps.identity import UserContext
from src.apps.studio_access import reset_studio_user, set_studio_user
from src.apps.user_config import UserConfigStore, UserConfigUpdate
from src.models.nsfw_new_one import gateway_config


@pytest.mark.parametrize("label", ["provider", "catalog_name"])
def test_greena_uses_saved_endpoint_instead_of_deployment_default(monkeypatch, label):
    monkeypatch.setenv("GREENA_BASE_URL", "https://deployment.example/v1")
    assert gateway_config({label: "greena", "api_key": "owner-key", "base_url": "https://owner.example/v1"}) == {
        "api_key": "owner-key", "base_url": "https://owner.example/v1",
    }


@pytest.mark.parametrize("label", ["provider", "catalog_name"])
def test_greena_rejects_uniart_credentials_before_network(monkeypatch, label):
    monkeypatch.setenv("GREENA_BASE_URL", "https://greena.example/v1")
    with pytest.raises(ValueError, match="provider"):
        gateway_config({label: "uniart", "api_key": "uniart-key", "base_url": "https://uniart.example/v1"})


@pytest.mark.parametrize("kind", ["image", "video"])
def test_uniart_rejects_greena_credentials_before_network(kind):
    from src.models.uniart import UniArtImageModel, UniArtVideoModel
    adapter = UniArtImageModel if kind == "image" else UniArtVideoModel
    with pytest.raises(ValueError, match="provider"):
        adapter({"catalog_name": "greena", "api_key": "greena-key", "base_url": "https://greena.example/v1"})


def test_selected_uniart_key_cannot_be_borrowed_by_greena(tmp_path):
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    store.update(owner, UserConfigUpdate(catalog_name="uniart", UNIART_API_KEY="uniart-only",
                                        UNIART_BASE_URL="https://uniart.example/v1"))
    with pytest.raises(HTTPException) as error:
        store.get_runtime_nsfw(owner)
    assert error.value.status_code == 409


@pytest.mark.parametrize("prefix,provider", [("nsfw", "greena"), ("greena", "greena"), ("uniart", "uniart")])
def test_llm_namespace_selects_own_profile_and_sends_raw_model(monkeypatch, tmp_path, prefix, provider):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    # Select the OTHER gateway, so accidentally using the active key is observable.
    other = "uniart" if provider == "greena" else "greena"
    store.update(owner, UserConfigUpdate(catalog_name=other, UNIART_API_KEY="wrong-key",
                                        UNIART_BASE_URL="https://wrong.example/v1"))
    store.update_provider_profile(owner, provider, api_key="right-key", base_url="https://right.example/v1")
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("GREENA_BASE_URL", "https://deployment.example/v1")
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    adapter = LLMAdapter(default_model=f"{prefix}/shared-model")
    token = set_studio_user(owner)
    try:
        assert adapter.is_configured
        assert adapter.chat([{"role": "user", "content": "write"}]) == "ok"
    finally:
        reset_studio_user(token)
    assert captured["api_key"] == "right-key"
    assert captured["base_url"] == "https://right.example/v1"
    assert captured["model"] == "shared-model"


@pytest.mark.parametrize("selected,requested", [("uniart", "greena"), ("greena", "uniart")])
def test_missing_model_profile_never_falls_back_to_other_gateway(monkeypatch, tmp_path, selected, requested):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    store.update(owner, UserConfigUpdate(catalog_name=selected, UNIART_API_KEY="other-key",
                                        UNIART_BASE_URL="https://other.example/v1"))
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("OPENAI_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(
        OpenAI=lambda **_: pytest.fail("No client may be created for missing profile")))
    adapter = LLMAdapter(default_model=f"{requested}/shared-model")
    token = set_studio_user(owner)
    try:
        assert not adapter.is_configured
        with pytest.raises(HTTPException) as error:
            adapter.chat([{"role": "user", "content": "write"}])
        assert error.value.status_code == 409
    finally:
        reset_studio_user(token)


def test_llm_reloads_saved_gateway_after_owner_and_settings_switch(monkeypatch, tmp_path):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    store = UserConfigStore(str(tmp_path / "users.db"))
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    calls = []

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: (
                calls.append((api_key, base_url, kwargs["model"])) or
                SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
            )))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    adapter = LLMAdapter()
    for user_id, provider, key in [("a", "greena", "a-green"), ("b", "uniart", "b-uni"), ("a", "greena", "a-rotated")]:
        owner = UserContext(user_id, f"owner-{user_id}", "", "")
        store.update(owner, UserConfigUpdate(catalog_name=provider, UNIART_API_KEY=key,
                                            UNIART_BASE_URL=f"https://{key}.example/v1"))
        token = set_studio_user(owner)
        try:
            assert adapter.chat([{"role": "user", "content": "write"}], model=f"{provider}/shared-model") == "ok"
        finally:
            reset_studio_user(token)
    assert calls == [(key, f"https://{key}.example/v1", "shared-model") for key in ("a-green", "b-uni", "a-rotated")]

@pytest.mark.parametrize('provider,model_id', [('greena', 'nsfw/seedream_5.0Pro_nsfw'), ('uniart', 'uniart/gpt-image-2')])
def test_asset_image_namespace_uses_own_gateway_when_other_is_active(monkeypatch, tmp_path, provider, model_id):
    from src.apps import studio_access as access, user_config
    from src.apps.comic_gen.assets import AssetGenerator
    from src.models.uniart import UniArtImageModel
    from src.models.nsfw_new_one import GreenAImageModel
    store = UserConfigStore(str(tmp_path / 'users.db'))
    owner = UserContext('user', 'owner', '', '')
    other = 'uniart' if provider == 'greena' else 'greena'
    store.update(owner, UserConfigUpdate(catalog_name=other, UNIART_API_KEY='wrong-key', UNIART_BASE_URL='https://wrong.example/v1'))
    store.update_provider_profile(owner, provider, api_key='right-key', base_url='https://right.example/v1')
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: store)
    token = set_studio_user(owner)
    configured = access.set_studio_uniart_config(store.get_runtime_uniart(owner))
    try:
        adapter = AssetGenerator()._get_model_for(model_id)
        assert isinstance(adapter, GreenAImageModel if provider == 'greena' else UniArtImageModel)
        assert adapter.config['base_url'] == 'https://right.example/v1'
        assert adapter.config['api_key'] == 'right-key'
    finally:
        access.reset_studio_uniart_config(configured)
        reset_studio_user(token)


def test_asset_image_missing_uniart_profile_does_not_send_gpt_model_to_greena(monkeypatch, tmp_path):
    from src.apps import studio_access as access, user_config
    from src.apps.comic_gen.assets import AssetGenerator
    store = UserConfigStore(str(tmp_path / 'users.db'))
    owner = UserContext('user', 'owner', '', '')
    store.update(owner, UserConfigUpdate(catalog_name='greena', UNIART_API_KEY='green-key', UNIART_BASE_URL='https://green.example/v1'))
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: store)
    token = set_studio_user(owner)
    configured = access.set_studio_uniart_config(store.get_runtime_uniart(owner))
    try:
        with pytest.raises(HTTPException) as error:
            AssetGenerator()._get_model_for('uniart/gpt-image-2')
        assert error.value.status_code == 409
    finally:
        access.reset_studio_uniart_config(configured)
        reset_studio_user(token)


@pytest.mark.parametrize('surface', ['asset', 'storyboard'])
@pytest.mark.parametrize('provider,model_id', [('greena','nsfw/seedream_5.0Pro_nsfw'),('uniart','uniart/gpt-image-2'),('uniart','uniart/seedream_5.0Pro_nsfw')])
def test_each_image_surface_uses_model_adapter_profile(monkeypatch,tmp_path,surface,provider,model_id):
    from src.apps import user_config
    from src.apps.comic_gen.assets import AssetGenerator
    from src.apps.comic_gen.storyboard import StoryboardGenerator
    from src.models.greena import GreenAImageModel
    from src.models.uniart import UniArtImageModel
    owner=UserContext('user','owner','','');store=UserConfigStore(str(tmp_path/'users.db'))
    other='uniart' if provider=='greena' else 'greena'
    store.update(owner,UserConfigUpdate(catalog_name=other,UNIART_API_KEY='wrong-key',UNIART_BASE_URL='https://wrong.test/v1'))
    store.update_provider_profile(owner,provider,api_key='right-key',base_url='https://right.test/v1')
    monkeypatch.setattr(user_config,'get_user_config_store',lambda:store)
    token=set_studio_user(owner)
    try:
        adapter=(AssetGenerator() if surface=='asset' else StoryboardGenerator())._get_model_for(model_id)
        assert isinstance(adapter,GreenAImageModel if provider=='greena' else UniArtImageModel)
        assert adapter.config['api_key']=='right-key'
        assert adapter.config['base_url']=='https://right.test/v1'
    finally:reset_studio_user(token)


@pytest.mark.parametrize('provider,model_id',[('greena','nsfw/wan3.0'),('uniart','uniart/seedance-2.5-vip'),('uniart','uniart/wan3.0')])
def test_storyboard_video_task_uses_explicit_model_adapter_profile(monkeypatch,tmp_path,provider,model_id):
    from unittest.mock import Mock
    from src.apps import user_config
    from src.apps.comic_gen.models import Script,VideoTask
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.models import nsfw_new_one,uniart
    owner=UserContext('user','owner','','');store=UserConfigStore(str(tmp_path/'users.db'))
    other='uniart' if provider=='greena' else 'greena'
    store.update(owner,UserConfigUpdate(catalog_name=other,UNIART_API_KEY='wrong-key',UNIART_BASE_URL='https://wrong.test/v1'))
    store.update_provider_profile(owner,provider,api_key='right-key',base_url='https://right.test/v1')
    monkeypatch.setattr(user_config,'get_user_config_store',lambda:store)
    script=Script(id='project',title='test',original_text='',created_at=0,updated_at=0,owner_user_id='user',owner_profile_id='owner')
    task=VideoTask(id='take',project_id='project',image_url='',prompt='motion',model=model_id,generation_mode='t2v',duration=5)
    script.video_tasks=[task]
    pipe=ComicGenPipeline.__new__(ComicGenPipeline);pipe.get_script=lambda _:script;pipe._save_data=Mock()
    pipe._owner_output_dir=lambda *_:str(tmp_path);pipe.output_root=str(tmp_path)
    capture=[]
    def generate(adapter,prompt,output_path,**kw):
        capture.append((adapter.config,kw));return output_path,0.1
    target=nsfw_new_one.GreenAVideoModel if provider=='greena' else uniart.UniArtVideoModel
    monkeypatch.setattr(target,'generate',generate)
    pipe.process_video_task('project','take')
    assert task.status=='completed',task.error
    assert capture[0][0]['api_key']=='right-key'
    assert capture[0][0]['base_url']=='https://right.test/v1'
    assert capture[0][1]['model']==model_id


@pytest.mark.parametrize('model_id',['uniart/wan3.0','uniart/wan3.0-Prime'])
def test_playground_uniart_wan_id_does_not_select_greena(monkeypatch,tmp_path,model_id):
    from unittest.mock import Mock
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.models import PlaygroundGeneration,PlaygroundMode
    service=PlaygroundService(Mock(output_dir=str(tmp_path)),provider_config_loader=lambda:{'provider':'uniart','api_key':'right','base_url':'https://uniart.test/v1'},
        nsfw_config_loader=lambda:pytest.fail('GreenA credentials requested'))
    model=Mock();model.generate.return_value=('video.mp4',0.1)
    create=Mock(return_value=model);monkeypatch.setattr('src.models.uniart.UniArtVideoModel',create)
    gen=PlaygroundGeneration(id='video',mode=PlaygroundMode.T2V,model_id=model_id,prompt='motion',parameters={'resolution':'480p','duration':5},created_at='2026-11-19T00:00:00Z')
    service._process_video_generation(gen)
    assert create.call_args.args[0]['api_key']=='right'
    assert model.generate.call_args.kwargs['model']==model_id


def test_optimizer_presentation_is_owned_by_adapter(monkeypatch):
    from src.apps.comic_gen import api
    from src.models import greena
    from src.utils.provider_catalog import gateway_adapter
    monkeypatch.setattr(api,'_video_polish_catalog',lambda:'greena')
    monkeypatch.setattr(greena,'OPTIMIZERS',({'id':'llm','label':'Adapter-defined optimizer'},))
    monkeypatch.setattr(greena,'DEFAULT_OPTIMIZER','llm')
    assert api.get_video_polish_optimizers()['providers']==list(greena.OPTIMIZERS)
    assert api.get_video_polish_optimizers()['default_provider']=='llm'
    assert gateway_adapter({'catalog_name':'greena'}) is greena
