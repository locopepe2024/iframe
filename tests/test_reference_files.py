import base64
import subprocess

import pytest

from src.apps import agent_api as agent
from src.utils.reference_files import chat_audio


def test_m4a_reference_is_converted_and_sent_as_valid_mp3(tmp_path, monkeypatch):
    original = tmp_path / 'voice.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                    '-c:a', 'aac', str(original)], check=True)
    before = original.read_bytes()
    monkeypatch.setattr(agent, 'reference_path', lambda *args: str(original))
    content = agent.reference_content(None, 'owned-reference')
    assert content['type'] == 'input_audio'
    assert content['input_audio']['format'] == 'mp3'
    result = tmp_path / 'result.mp3'
    result.write_bytes(base64.b64decode(content['input_audio']['data']))
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(result)], text=True))
    assert 1 <= duration < 1.2
    assert original.read_bytes() == before


def test_invalid_audio_reports_decode_failure_without_raw_ffmpeg_output(tmp_path):
    bad = tmp_path / 'private-name.m4a'
    bad.write_bytes(b'invalid-container')
    with pytest.raises(ValueError, match='无法解码') as error:
        chat_audio(str(bad))
    assert str(bad) not in str(error.value)
