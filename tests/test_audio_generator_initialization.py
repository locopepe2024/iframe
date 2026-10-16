from pathlib import Path
from unittest.mock import Mock

from src.apps.comic_gen.audio import AudioGenerator
from src.apps.comic_gen.models import Character, GenerationStatus, StoryboardFrame


def test_constructor_initializes_tts_and_dialogue_uses_it(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    processor = Mock()
    def synthesize(text, output_path, **kwargs):
        Path(output_path).write_bytes(b'synthesized audio')
    processor.synthesize.side_effect = synthesize
    factory = Mock(return_value=processor)
    monkeypatch.setattr('src.apps.comic_gen.audio.TTSProcessor', factory)
    generator = AudioGenerator()
    factory.assert_called_once_with()
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', dialogue='Hello')
    character = Character(id='char-1', name='Speaker', description='Test', voice_id='voice-1')
    generator.generate_dialogue(frame, character, instructions='calm')
    assert frame.status == GenerationStatus.COMPLETED
    assert Path('output', frame.audio_url).read_bytes() == b'synthesized audio'
    assert frame.dialogue_voice_id == 'voice-1'
    assert frame.dialogue_text_hash
    assert processor.synthesize.call_args.kwargs['instructions'] == 'calm'


def test_initialization_error_leaves_dialogue_failed_without_dummy_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('src.apps.comic_gen.audio.TTSProcessor', Mock(side_effect=RuntimeError('unavailable')))
    generator = AudioGenerator()
    assert generator.tts is None
    frame = StoryboardFrame(id='frame-1', scene_id='scene-1', dialogue='Hello')
    character = Character(id='char-1', name='Speaker', description='Test', voice_id='voice-1')
    generator.generate_dialogue(frame, character)
    assert frame.status == GenerationStatus.FAILED
    assert frame.audio_error
    assert frame.audio_url is None
    assert not Path('output').exists()
