from unittest.mock import Mock

import pytest

from src.utils import system_check


@pytest.fixture(autouse=True)
def clean_tool_config(monkeypatch):
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.delenv("FFPROBE_PATH", raising=False)


def executable(tmp_path, name):
    path = tmp_path / name
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o755)
    return str(path)


def test_explicit_paths_override_discovery_and_keep_spaces(tmp_path, monkeypatch):
    ffmpeg = executable(tmp_path, "custom ffmpeg")
    ffprobe = executable(tmp_path, "custom ffprobe")
    monkeypatch.setenv("FFMPEG_PATH", ffmpeg)
    monkeypatch.setenv("FFPROBE_PATH", ffprobe)
    run = Mock()
    monkeypatch.setattr(system_check.subprocess, "run", run)
    assert system_check.get_ffmpeg_path() == ffmpeg
    assert system_check.get_ffprobe_path() == ffprobe
    run.assert_not_called()


@pytest.mark.parametrize("name", ["FFMPEG_PATH", "FFPROBE_PATH"])
@pytest.mark.parametrize("value", ["http://127.0.0.1:8000", "127.0.0.1", "ffmpeg -threads 1", "/missing/media-tool"])
def test_invalid_explicit_path_does_not_fallback(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    monkeypatch.setattr(system_check.shutil, "which", lambda _: "/usr/bin/tool")
    resolver = system_check.get_ffmpeg_path if name == "FFMPEG_PATH" else system_check.get_ffprobe_path
    with pytest.raises(ValueError, match=name):
        resolver()


def test_nonexecutable_is_rejected(tmp_path, monkeypatch):
    path = tmp_path / "ffmpeg"
    path.write_text("not executable")
    monkeypatch.setenv("FFMPEG_PATH", str(path))
    with pytest.raises(ValueError, match="FFMPEG_PATH"):
        system_check.get_ffmpeg_path()


def test_probe_prefers_sibling_then_path(tmp_path, monkeypatch):
    ffmpeg = executable(tmp_path, "ffmpeg")
    sibling = executable(tmp_path, "ffprobe")
    monkeypatch.setattr(system_check.shutil, "which", lambda _: "/path/ffprobe")
    assert system_check.get_ffprobe_path(ffmpeg) == sibling
    from pathlib import Path
    Path(sibling).unlink()
    assert system_check.get_ffprobe_path(ffmpeg) == "/path/ffprobe"


def test_probe_windows_sibling(tmp_path, monkeypatch):
    ffmpeg = executable(tmp_path, "ffmpeg.exe")
    sibling = executable(tmp_path, "ffprobe.exe")
    assert system_check.get_ffprobe_path(ffmpeg) == sibling


def test_blank_settings_preserve_path_discovery(monkeypatch):
    monkeypatch.setenv("FFMPEG_PATH", "  ")
    monkeypatch.setattr(system_check.shutil, "which", lambda _: "/path/ffmpeg")
    assert system_check.get_ffmpeg_path() == "/path/ffmpeg"


def test_status_reports_invalid_configuration_without_crashing(monkeypatch):
    monkeypatch.setenv("FFMPEG_PATH", "http://127.0.0.1")
    monkeypatch.setenv("FFPROBE_PATH", "/missing/probe")
    status = system_check.run_system_checks()
    assert status["status"] == "warning"
    for name in ("ffmpeg", "ffprobe"):
        assert status["dependencies"][name]["available"] is False
        assert status["dependencies"][name]["path"] is None


def test_recreation_commands_use_configured_executable(tmp_path, monkeypatch):
    from src.apps.recreation import analysis
    from src.apps.recreation.service import RecreationService
    ffmpeg = executable(tmp_path, "custom ffmpeg")
    ffprobe = executable(tmp_path, "custom probe")
    monkeypatch.setenv("FFMPEG_PATH", ffmpeg)
    monkeypatch.setenv("FFPROBE_PATH", ffprobe)
    run = Mock(return_value=Mock(returncode=0, stdout=b"", stderr=b""))
    monkeypatch.setattr(analysis.subprocess, "run", run)
    analysis.run(["ffmpeg", "-version"])
    assert run.call_args.args[0] == [ffmpeg, "-version"]
    RecreationService._run_media_command(["ffprobe", "-version"])
    assert run.call_args.args[0] == [ffprobe, "-version"]
