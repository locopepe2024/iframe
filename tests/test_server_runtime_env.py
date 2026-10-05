import importlib.util
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/server_runtime_env.py'
SPEC = importlib.util.spec_from_file_location('server_runtime_env', SCRIPT)
runtime_env = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime_env)


def test_bootstrap_keeps_application_overrides_without_leaking_values(tmp_path, monkeypatch, capsys):
    container = {'Config': {'Image': 'test-image', 'Env': [
        'PATH=/usr/bin', 'NO_PROXY=custom', 'API_KEY=private-value', 'EMPTY=',
    ]}}
    image = {'Config': {'Env': ['PATH=/usr/bin', 'NO_PROXY=default']}}
    monkeypatch.setattr(runtime_env, 'docker_inspect',
                        lambda kind, name: container if kind == 'container' else image)
    path = tmp_path / 'runtime/iframe-backend.env'

    assert runtime_env.bootstrap(path) == ['NO_PROXY', 'API_KEY', 'EMPTY']
    assert path.read_text() == 'NO_PROXY=custom\nAPI_KEY=private-value\nEMPTY=\n'
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert 'private-value' not in capsys.readouterr().out

    with pytest.raises(FileExistsError):
        runtime_env.bootstrap(path)


@pytest.mark.parametrize('content', ['KEY=one\nKEY=two\n', 'bad key=value\n', 'KEY\n'])
def test_validate_rejects_invalid_entries(tmp_path, content):
    folder = tmp_path / 'runtime'
    folder.mkdir(mode=0o700)
    path = folder / 'iframe-backend.env'
    path.write_text(content)
    path.chmod(0o600)

    with pytest.raises(ValueError):
        runtime_env.validate_file(path)


def test_validate_rejects_broad_permissions(tmp_path):
    folder = tmp_path / 'runtime'
    folder.mkdir(mode=0o700)
    path = folder / 'iframe-backend.env'
    path.write_text('API_KEY=secret\n')
    path.chmod(0o644)

    with pytest.raises(ValueError, match='mode 0600'):
        runtime_env.validate_file(path)


def test_validate_rejects_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        runtime_env.validate_file(tmp_path / 'missing')
