from pathlib import Path
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.audio import AudioGenerator
from src.apps.comic_gen.storyboard import StoryboardGenerator
from src.apps.comic_gen.models import Character, Scene, GenerationStatus, StoryboardFrame
from src.apps.studio_access import studio_owner_key


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    cwd = tmp_path / 'cwd'
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    processor = Mock()
    def synthesize(text, output_path, **kwargs):
        Path(output_path).write_bytes(b'audio bytes')
    processor.synthesize.side_effect = synthesize
    monkeypatch.setattr('src.apps.comic_gen.audio.TTSProcessor', lambda: processor)
    model = Mock()
    def generate(prompt, output_path, **kwargs):
        Path(output_path).write_bytes(b'image bytes')
        return output_path, 0
    model.generate.side_effect = generate
    monkeypatch.setattr('src.apps.comic_gen.storyboard.WanxImageModel', lambda _: model)
    return tmp_path / 'media', processor, model


def reference_at(root, suffix='character.png'):
    key = f'users/{studio_owner_key("owner-a")}/studio/uploads/{suffix}'
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'selected root reference')
    return key, path


@pytest.mark.parametrize('owner', ['owner-a', 'owner-b', None])
def test_dialogue_root_and_voice_settings(workspace, owner):
    root, processor, _ = workspace
    generator = AudioGenerator(output_root=root)
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', owner_profile_id=owner, dialogue='Hello')
    character = Character(id='character-1', name='Test', description='Test', voice_id='voice-1')
    generator.generate_dialogue(frame, character, speed=1.2, pitch=0.8, volume=70,
                                instructions='calm', model_override='test-model', family_override='test-family')
    assert frame.status == GenerationStatus.COMPLETED
    prefix = f'users/{studio_owner_key(owner)}/studio/' if owner else ''
    assert frame.audio_url == prefix + 'audio/dialogue/frame-1.mp3'
    assert (root / frame.audio_url).read_bytes() == b'audio bytes'
    assert processor.synthesize.call_args.args[0] == 'Hello'
    assert processor.synthesize.call_args.kwargs == dict(
        voice='voice-1', speech_rate=1.2, pitch_rate=0.8, volume=70,
        instructions='calm', model_override='test-model', family_override='test-family')


@pytest.mark.parametrize('method,field,suffix', [
    ('generate_sfx', 'sfx_url', 'sfx/frame-1.mp3'),
    ('generate_sfx_from_video', 'sfx_url', 'sfx/frame-1_v2a.mp3'),
])
def test_existing_mock_audio_writers_use_root(workspace, monkeypatch, method, field, suffix):
    root, _, _ = workspace
    monkeypatch.setattr('src.apps.comic_gen.audio.time.sleep', lambda _: None)
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', owner_profile_id='owner-a', video_url='video/clip.mp4')
    getattr(AudioGenerator(output_root=root), method)(frame)
    key = getattr(frame, field)
    assert key == f'users/{studio_owner_key("owner-a")}/studio/audio/{suffix}'
    assert (root / key).is_file()  # Existing mock content, not generated provider audio.


@pytest.mark.parametrize('prefix', ['', 'output/', 'outputs/'])
@pytest.mark.parametrize('explicit', [False, True])
def test_storyboard_reference_resolution_uses_selected_root(workspace, prefix, explicit):
    root, _, model = workspace
    key, reference = reference_at(root)
    # A cwd legacy file must not shadow the selected root for explicit aliases.
    if prefix:
        shadow = Path(prefix + key)
        shadow.parent.mkdir(parents=True, exist_ok=True)
        shadow.write_bytes(b'wrong legacy root')
    generator = StoryboardGenerator(output_root=root)
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', owner_profile_id='owner-a', character_ids=['character-1'])
    character = Character(id='character-1', name='Test', description='Test', image_url=prefix + key)
    scene = Scene(id='scene-1', name='Scene', description='Test', image_url=prefix + key)
    kwargs = {'ref_image_paths': [prefix + key]} if explicit else {}
    generator.generate_frame(frame, [character], scene, prompt='Test', **kwargs)
    sent = model.generate.call_args.kwargs['ref_image_paths']
    assert sent == [str(reference)]
    assert Path(sent[0]).read_bytes() == b'selected root reference'
    assert frame.image_url.startswith(f'users/{studio_owner_key("owner-a")}/studio/storyboard/')
    assert frame.rendered_image_url == frame.image_url
    assert frame.rendered_image_asset.variants[0].url == frame.image_url
    assert (root / frame.image_url).read_bytes() == b'image bytes'


def test_storyboard_relative_root_explicit_directory_and_remote_refs(workspace):
    _, _, model = workspace
    root = Path('relative-media')
    key, reference = reference_at(root)
    generator = StoryboardGenerator(output_root=root)
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', owner_profile_id='owner-a')
    chosen_dir = root / 'chosen'
    refs = ['https://example.test/reference.png', 'lumenx/reference.png', str(reference.resolve())]
    generator.generate_frame(frame, [], None, ref_image_paths=refs, prompt='Test', output_dir=str(chosen_dir))
    assert set(model.generate.call_args.kwargs['ref_image_paths']) == set(refs)
    assert frame.image_url.startswith('chosen/')
    assert (root / frame.image_url).is_file()


def test_defaults_and_legacy_overrides(workspace):
    root, _, _ = workspace
    assert AudioGenerator().output_dir == 'output/audio'
    assert StoryboardGenerator().output_dir == 'output/storyboard'
    assert AudioGenerator({'output_dir': 'legacy-audio'}).output_dir == 'legacy-audio'
    assert StoryboardGenerator({'output_dir': 'legacy-frames'}).output_dir == 'legacy-frames'
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1')
    StoryboardGenerator(output_root=root).generate_frame(frame, [], None, prompt='Test')
    assert frame.image_url.startswith('storyboard/')
    assert (root / frame.image_url).is_file()


def test_audio_instances_do_not_share_directory_configuration(workspace):
    root, _, _ = workspace
    roots = [root, root.parent / 'second-media']
    generators = [AudioGenerator(output_root=location) for location in roots]
    speaker = Character(id='character-1', name='Test', description='Test', voice_id='voice-1')
    keys = []
    for generator, location in zip(generators, roots):
        frame = StoryboardFrame(id='frame-1', scene_id='scene-1', owner_profile_id='owner-a', dialogue='Hello')
        generator.generate_dialogue(frame, speaker)
        assert frame.status == GenerationStatus.COMPLETED
        assert (location / frame.audio_url).read_bytes() == b'audio bytes'
        keys.append(frame.audio_url)
    assert keys[0] == keys[1]
