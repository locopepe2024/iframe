"""Subtitle round-trip, safe serialization and authenticated export boundaries."""
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from src.apps.comic_gen.models import AssemblyClip, AssemblyLane, AssemblyEditPlan
from src.apps.comic_gen.assembly_subtitles import export_srt


def plan():
    return AssemblyEditPlan(scope="project", target_duration_ms=5000, lanes=[
        AssemblyLane(id="zh", kind="subtitle", clips=[
            AssemblyClip(id="second", timeline_start_ms=2000, timeline_end_ms=3201, text="第二句"),
            AssemblyClip(id="first", timeline_start_ms=12, timeline_end_ms=1000, text="你好\n\n<b>世界</b>"),
        ])])


def test_roundtrip_and_sorted_plain_text_srt():
    value = AssemblyEditPlan.model_validate(plan().model_dump())
    result = export_srt(value, "zh")
    assert result == ('1\r\n00:00:00,012 --> 00:00:01,000\r\n你好\r\n&lt;b&gt;世界&lt;/b&gt;\r\n\r\n'
                      '2\r\n00:00:02,000 --> 00:00:03,201\r\n第二句\r\n\r\n')


def test_muted_and_disabled_cues():
    value = plan()
    value.lanes[0].clips[0].enabled = False
    assert "第二句" not in export_srt(value, "zh")
    value.lanes[0].muted = True
    assert export_srt(value, "zh") == ""
    with pytest.raises(ValueError, match="not found"):
        export_srt(value, "foreign")


@pytest.mark.parametrize("text", ["", "  ", "hello\x00world"])
def test_invalid_subtitle_text(text):
    value = plan().model_dump()
    value['lanes'][0]['clips'][0]['text'] = text
    with pytest.raises(ValidationError):
        AssemblyEditPlan.model_validate(value)


def test_subtitle_overlap_rejected_even_if_audio_overlap_enabled():
    value = plan().model_dump()
    value['lanes'][0]['allow_overlap'] = True
    value['lanes'][0]['clips'][0]['timeline_start_ms'] = 100
    with pytest.raises(ValidationError, match="overlapping"):
        AssemblyEditPlan.model_validate(value)


@pytest.mark.parametrize("scope", ["project", "series"])
def test_export_checks_owner_and_missing_resource(monkeypatch, scope):
    from src.apps.comic_gen import api
    mock_pipeline = Mock()
    getter = mock_pipeline.get_script if scope == 'project' else mock_pipeline.get_series
    getter.return_value = SimpleNamespace(assembly_plan=plan())
    monkeypatch.setattr(api, 'pipeline', mock_pipeline)
    user = SimpleNamespace(owner_profile_id='owner-a')
    response = api._export_assembly_subtitles(scope, 'p1', 'zh', user)
    getter.assert_called_once_with('p1', 'owner-a')
    assert response.body.decode('utf-8').startswith('1\r\n')
    assert response.headers['cache-control'] == 'private, no-store'
    getter.return_value = None
    with pytest.raises(HTTPException) as error:
        api._export_assembly_subtitles(scope, 'p1', 'zh', user)
    assert error.value.status_code == 404


def test_burn_lane_requires_enabled_subtitle_lane():
    value = plan().model_dump()
    value['burn_subtitle_lane_id'] = 'missing'
    with pytest.raises(ValidationError, match='enabled subtitle lane'):
        AssemblyEditPlan.model_validate(value)
    value['burn_subtitle_lane_id'] = 'zh'
    value['lanes'][0]['muted'] = True
    with pytest.raises(ValidationError, match='enabled subtitle lane'):
        AssemblyEditPlan.model_validate(value)


def test_burn_rejects_ass_controls_before_running_ffmpeg(monkeypatch):
    from src.apps.comic_gen.assembly_subtitles import render_with_subtitles
    value = plan()
    value.burn_subtitle_lane_id = 'zh'
    value.lanes[0].clips[0].text = r'{\pos(10,10)}hello'
    run = Mock()
    monkeypatch.setattr('subprocess.run', run)
    with pytest.raises(ValueError, match='backslashes or braces'):
        render_with_subtitles(['ffmpeg'], value)
    run.assert_not_called()


def test_burn_fails_on_missing_glyphs_and_cleans_temporary_files(monkeypatch):
    import subprocess
    from pathlib import Path
    from src.apps.comic_gen.assembly_subtitles import render_with_subtitles
    value = plan()
    value.burn_subtitle_lane_id = 'zh'
    paths = []
    def run(command, **kwargs):
        if '-filters' in command:
            return subprocess.CompletedProcess(command, 0, stdout=b' ... subtitles V->V Render subtitles', stderr=b'')
        filter_text = command[command.index('-vf') + 1]
        probe = Path(filter_text.split('filename=')[1].split(':')[0])
        assert probe.exists()
        paths.append(probe)
        return subprocess.CompletedProcess(command, 0, stdout=b'', stderr=b'Glyph 0x4F60 not found, failed to find any fallback')
    monkeypatch.setattr(subprocess, 'run', run)
    with pytest.raises(ValueError, match='missing required glyphs'):
        render_with_subtitles(['ffmpeg'], value)
    assert paths and not paths[0].parent.exists()


def test_burn_reports_unavailable_filter(monkeypatch):
    import subprocess
    from src.apps.comic_gen.assembly_subtitles import render_with_subtitles
    value = plan()
    value.burn_subtitle_lane_id = 'zh'
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a, 0, stdout=b'no filter', stderr=b''))
    with pytest.raises(ValueError, match='libass'):
        render_with_subtitles(['ffmpeg'], value)


def test_successful_burn_maps_captioned_video_and_cleans_files(monkeypatch):
    import subprocess
    from pathlib import Path
    from src.apps.comic_gen.assembly_subtitles import render_with_subtitles
    value = plan()
    value.burn_subtitle_lane_id = 'zh'
    commands = []
    files = []
    def run(command, **kwargs):
        commands.append(command)
        if '-filters' in command:
            return subprocess.CompletedProcess(command, 0, stdout=b' ... subtitles V->V', stderr=b'')
        if '-vf' in command:
            path = Path(command[command.index('-vf') + 1].split('filename=')[1].split(':')[0])
            files.append(path)
            assert path.exists()
        else:
            path = Path(command[command.index('-filter_complex') + 1].split('filename=')[1].split(':')[0])
            files.append(path)
            assert path.exists()
            assert command[command.index('-map') + 1] == '[captioned]'
            assert '第二句' in path.read_text()
        return subprocess.CompletedProcess(command, 0, stdout=b'', stderr=b'')
    monkeypatch.setattr(subprocess, 'run', run)
    render_with_subtitles(['ffmpeg', '-filter_complex', '[0:v]null[outv]', '-map', '[outv]', 'out.mp4'], value)
    assert len(commands) == 3
    assert all(not file.exists() for file in files)
