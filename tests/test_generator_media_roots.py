"""Image/video writer root propagation without provider or cloud calls."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.video import VideoGenerator
from src.apps.comic_gen.models import Character, Scene, Prop, StoryboardFrame, GenerationStatus
from src.apps.studio_access import studio_owner_key


class RecordingModel:
    def __init__(self):
        self.calls = []

    def generate(self, prompt=None, output_path=None, **kwargs):
        self.calls.append(dict(prompt=prompt, output_path=output_path, **kwargs))
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'generated media')
        return str(path), 0


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    cwd = tmp_path / 'cwd'
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    # Capture all cloud calls without initializing credentials or SDK clients.
    uploader = SimpleNamespace(is_configured=True, upload_file=Mock(return_value=None))
    monkeypatch.setattr('src.utils.oss_utils.OSSImageUploader', lambda: uploader)
    monkeypatch.setattr('src.apps.comic_gen.assets.WanxImageModel', lambda *_: RecordingModel())
    monkeypatch.setattr('src.apps.comic_gen.video.WanxModel', lambda *_: RecordingModel())
    return tmp_path / 'media', uploader


def prepare_reference(root, owner='owner-a'):
    key = f'users/{studio_owner_key(owner)}/studio/uploads/reference.png'
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'reference image')
    return key, path


@pytest.mark.parametrize('asset_type', ['scene', 'prop'])
@pytest.mark.parametrize('owner', ['owner-a', 'owner-b', None])
def test_image_writes_and_reference_reads_share_root(workspace, asset_type, owner):
    root, uploader = workspace
    key, reference = prepare_reference(root)
    generator = AssetGenerator(output_root=str(root))
    asset_class = Scene if asset_type == 'scene' else Prop
    asset = asset_class(id='asset-1', name='Test', description='Test', owner_profile_id=owner)
    getattr(generator, f'generate_{asset_type}')(
        asset, prompt='Clear reference', reference_image_url=key,
        reference_image_urls=[str(reference)], image_generation_mode='reference',
    )
    assert asset.status == GenerationStatus.COMPLETED
    variant = asset.image_asset.variants[0]
    assert asset.image_url == variant.url
    prefix = f'users/{studio_owner_key(owner)}/studio/' if owner else ''
    assert variant.url.startswith(prefix + f'assets/{asset_type}s/')
    assert (root / variant.url).read_bytes() == b'generated media'
    call = generator.model.calls[0]
    assert Path(call['ref_image_path']) == reference
    assert call['ref_image_paths'] == [str(reference)]
    assert uploader.upload_file.call_args.kwargs['output_root'] == str(root)


@pytest.mark.parametrize('generation_type', ['full_body', 'three_view', 'headshot', 'reference_sheet'])
def test_character_view_outputs_and_explicit_reference(workspace, generation_type):
    root, uploader = workspace
    key, reference = prepare_reference(root)
    generator = AssetGenerator(output_root=str(root))
    character = Character(id='character-1', name='Test', description='Test', owner_profile_id='owner-a')
    generator.generate_character(character, generation_type=generation_type,
                                 reference_image_url=key, prompt='User prompt')
    assert generator.model.calls
    for call in generator.model.calls:
        assert Path(call['output_path']).is_relative_to(root)
        assert Path(call['output_path']).read_bytes() == b'generated media'
        assert Path(call['ref_image_path']) == reference
    assert uploader.upload_file.call_count == len(generator.model.calls)
    assert all(c.kwargs['output_root'] == str(root) for c in uploader.upload_file.call_args_list)
    # Persisted character media must not include the physical root.
    import json
    saved = json.dumps(character.model_dump(mode='json'))
    assert str(root) not in saved
    assert f'users/{studio_owner_key("owner-a")}/studio/assets/characters/' in saved


@pytest.mark.parametrize('mode', ['motion', 'clip'])
def test_video_source_output_key_and_upload_root(workspace, mode):
    root, uploader = workspace
    key, reference = prepare_reference(root)
    generator = VideoGenerator(output_root=str(root))
    if mode == 'motion':
        result = generator.generate_i2v(key, 'slow pan', owner_profile_id='owner-a')
        stored_key = result['video_url']
    else:
        frame = StoryboardFrame(id='frame-1', scene_id='scene-1', image_url=key, owner_profile_id='owner-a')
        generator.generate_clip(frame)
        assert frame.status == GenerationStatus.COMPLETED
        stored_key = frame.video_url
    assert stored_key.startswith(f'users/{studio_owner_key("owner-a")}/studio/video/')
    assert (root / stored_key).read_bytes() == b'generated media'
    assert Path(generator.model.calls[0]['img_path']) == reference
    assert generator.model.calls[0]['img_url'] is None
    assert uploader.upload_file.call_args.kwargs['output_root'] == str(root)


def test_defaults_overrides_and_remote_references(workspace):
    root, uploader = workspace
    assert AssetGenerator().output_dir == 'output/assets'
    assert VideoGenerator().output_dir == 'output/video'
    assert AssetGenerator({'output_dir': 'legacy-images'}).output_dir == 'legacy-images'
    assert VideoGenerator({'output_dir': 'legacy-videos'}).output_dir == 'legacy-videos'
    generator = AssetGenerator(output_root=str(root))
    assert generator._reference_path('https://example.test/image.png') == 'https://example.test/image.png'
    assert generator._reference_path('lumenx/assets/image.png') == 'lumenx/assets/image.png'
    video = VideoGenerator(output_root=str(root))
    result = video.generate_i2v('https://example.test/image.png', 'slow pan')
    assert result['video_url'].startswith('video/')
    assert video.model.calls[0]['img_url'] == 'https://example.test/image.png'


def test_relative_root_character_derivation_and_video_roundtrip(workspace):
    _, uploader = workspace
    root = Path('managed-media')
    key, reference = prepare_reference(root)
    generator = AssetGenerator(output_root=root)
    character = Character(id='character-1', name='Test', description='Test', owner_profile_id='owner-a')
    generator.generate_character(character, generation_type='all', reference_image_url=key, prompt='User prompt')
    # Derived views must read the newly generated full body without prepending
    # the configured root twice when it is itself a relative path.
    assert len(generator.model.calls) == 3
    for call in generator.model.calls:
        assert Path(call['ref_image_path']).is_file()
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', image_url=character.image_url,
                            owner_profile_id='owner-a')
    video = VideoGenerator(output_root=root)
    video.generate_clip(frame)
    assert frame.status == GenerationStatus.COMPLETED
    assert (root / frame.video_url).read_bytes() == b'generated media'
    assert Path(video.model.calls[0]['img_path']).read_bytes() == b'generated media'


def test_same_key_is_portable_between_independent_roots(workspace):
    root, uploader = workspace
    keys = []
    for location, payload in [(root, b'first source'), (root.parent / 'other-media', b'second source')]:
        key, path = prepare_reference(location)
        path.write_bytes(payload)
        generator = VideoGenerator(output_root=location)
        frame = StoryboardFrame(id='same-frame', scene_id='scene-1', image_url=key, owner_profile_id='owner-a')
        generator.generate_clip(frame)
        assert Path(generator.model.calls[0]['img_path']).read_bytes() == payload
        keys.append(frame.video_url)
    assert keys[0] == keys[1]
    assert (root / keys[0]).is_file()
    assert (root.parent / 'other-media' / keys[1]).is_file()


def test_cloud_result_keeps_object_key_semantics(workspace):
    root, uploader = workspace
    uploader.upload_file.return_value = 'lumenx/cloud/generated.png'
    generator = AssetGenerator(output_root=root)
    scene = Scene(id='scene-1', name='Test', description='Test', owner_profile_id='owner-a')
    generator.generate_scene(scene, prompt='Test')
    assert scene.image_url == scene.image_asset.variants[0].url == 'lumenx/cloud/generated.png'
    video = VideoGenerator(output_root=root)
    uploader.upload_file.return_value = 'lumenx/cloud/generated.mp4'
    result = video.generate_i2v('https://example.test/source.png', 'Test', owner_profile_id='owner-a')
    assert result['video_url'] == 'lumenx/cloud/generated.mp4'
