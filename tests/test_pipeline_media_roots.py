from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import pytest

from src.apps.comic_gen.pipeline import ComicGenPipeline, InvalidAssetReference
from src.apps.comic_gen.export import ExportManager
from src.apps.comic_gen.models import Script, Scene, ImageAsset, ImageVariant
from src.apps.media_registry import get_media
from src.apps.studio_access import studio_media_url, studio_owner_key


@pytest.fixture
def factory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-signing-key')
    monkeypatch.delenv('LUMENX_LEGACY_OWNER_USER_ID', raising=False)
    with ExitStack() as stack:
        mocks = {name: stack.enter_context(patch('src.apps.comic_gen.pipeline.' + name)) for name in (
            'ScriptProcessor', 'AssetGenerator', 'StoryboardGenerator', 'VideoGenerator', 'AudioGenerator', 'ExportManager')}
        stack.enter_context(patch.object(ComicGenPipeline, '_warmup_demucs_model'))
        yield lambda root: ComicGenPipeline(output_root=root), mocks


def test_root_injection_and_project_series_library_reload(factory):
    create, mocks = factory
    pipeline = create('managed-media')
    for name in ('AssetGenerator', 'StoryboardGenerator', 'VideoGenerator', 'AudioGenerator', 'ExportManager'):
        assert mocks[name].call_args.kwargs['output_root'] == 'managed-media'
    project = Script(id='project-1', title='Test', original_text='Source', created_at=1, updated_at=1,
                     owner_user_id='user-a', owner_profile_id='owner-a')
    pipeline.scripts[project.id] = project
    pipeline._save_data()
    series = pipeline.create_series('Test series', owner_user_id='user-a', owner_profile_id='owner-a')
    pipeline.library_store.scenes.append(Scene(id='scene-1', name='Test scene', description='Test',
                                               owner_profile_id='owner-a', owner_user_id='user-a'))
    pipeline._save_library_data()
    reloaded = create('managed-media')
    assert reloaded.get_script(project.id, 'owner-a').title == 'Test'
    assert reloaded.get_script(project.id, 'owner-b') is None
    assert reloaded.get_series(series.id, 'owner-a').title == 'Test series'
    assert reloaded.library_store.scenes[0].id == 'scene-1'
    for filename in ('projects.json', 'series.json', 'library_assets.json'):
        assert (Path('managed-media') / filename).is_file()
    other = create('other-media')
    assert other.scripts == {}
    assert other.series_store == {}
    assert other.library_store.scenes == []
    assert not Path('output').exists()


@pytest.mark.parametrize('prefix', ['', 'output/', 'outputs/'])
def test_reference_and_registry_share_selected_root(factory, prefix):
    create, _ = factory
    pipeline = create('managed-media')
    owner = 'owner-a'
    key = f'users/{studio_owner_key(owner)}/studio/assets/scenes/reference.png'
    source = Path(pipeline.output_root) / key
    source.parent.mkdir(parents=True)
    source.write_bytes(b'selected source')
    if prefix:
        shadow = Path(prefix + key)
        shadow.parent.mkdir(parents=True, exist_ok=True)
        shadow.write_bytes(b'wrong cwd source')
    assert Path(pipeline._resolve_stored_reference_value(prefix + key, owner)).read_bytes() == b'selected source'
    signed = studio_media_url(owner, key, ttl_seconds=-10, output_root=pipeline.output_root)
    assert Path(pipeline._resolve_stored_reference_value(signed, owner)).read_bytes() == b'selected source'
    with pytest.raises(InvalidAssetReference):
        pipeline._resolve_stored_reference_value(signed, 'owner-b')
    variant = ImageVariant(id='v', url=key)
    scene = Scene(id='scene-1', name='Test', description='Test', image_asset=ImageAsset(variants=[variant]))
    pipeline._register_asset_media(scene, owner)
    record = get_media(owner, variant.media_id, output_root=pipeline.output_root)
    assert record['storage_key'] == key
    assert get_media(owner, variant.media_id, output_root='other-media') is None


def test_local_reads_reject_escaping_paths_and_symlinks(factory, tmp_path):
    create, _ = factory
    pipeline = create('managed-media')
    outside = tmp_path / 'private.jpg'
    outside.write_bytes(b'private')
    root = Path(pipeline.output_root)
    root.mkdir()
    (root / 'escape.jpg').symlink_to(outside)
    for locator in ('output/../private.jpg', str(outside), 'escape.jpg'):
        with pytest.raises(InvalidAssetReference):
            pipeline._resolve_stored_reference_value(locator, 'owner-a')


def test_legacy_media_migration_uses_selected_root(factory):
    create, _ = factory
    pipeline = create('managed-media')
    source = Path(pipeline.output_root) / 'assets/portrait.jpg'
    source.parent.mkdir(parents=True)
    source.write_bytes(b'legacy portrait')
    payload = {'image_url': 'assets/portrait.jpg'}
    assert pipeline._migrate_legacy_media_references(payload, 'owner-a', output_root=pipeline.output_root)
    assert payload['image_url'].startswith(f'users/{studio_owner_key("owner-a")}/studio/legacy/')
    assert (Path(pipeline.output_root) / payload['image_url']).read_bytes() == b'legacy portrait'
    assert source.read_bytes() == b'legacy portrait'
    assert not Path('output').exists()


def test_legacy_export_path_only_uses_selected_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    manager = ExportManager(output_root='managed-media')
    script = Script(id='project-1', title='Test', original_text='', created_at=1, updated_at=1)
    key = manager.render_project(script, {})
    assert key.startswith('export/')
    # This legacy exporter is still a mock, not real video output.
    assert (Path('managed-media') / key).read_bytes() == b'dummy video content'
    assert not Path('output').exists()
