import importlib.util
import os
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('production_runtime_config', Path(__file__).parents[1] / 'scripts/production_runtime_config.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def config(tmp_path, content='LUMENX_MEDIA_SIGNING_KEY=stable-test-key\nNO_PROXY=localhost,127.0.0.1\n'):
    parent = tmp_path / 'runtime'
    parent.mkdir(mode=0o700)
    path = parent / 'iframe-backend.env'
    path.write_text(content)
    path.chmod(0o600)
    return path


def test_uses_only_explicit_file_and_never_changes_it(tmp_path, monkeypatch):
    path = config(tmp_path)
    before = path.read_bytes()
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'host-key-must-not-be-used')
    assert module.validate_production_env(path) == path
    assert path.read_bytes() == before


@pytest.mark.parametrize('content', [
    'OTHER=value\n', 'LUMENX_MEDIA_SIGNING_KEY=\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nOTHER=a\nOTHER=b\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nOTHER\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nOTHER="quoted"\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nOTHER=$HOST_SECRET\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nOTHER=value #comment\n',
    'LUMENX_MEDIA_SIGNING_KEY=x\nexport OTHER=x\n',
])
def test_rejects_ambiguous_or_incomplete_config_without_values_in_errors(tmp_path, content):
    path = config(tmp_path, content)
    with pytest.raises(ValueError) as error:
        module.validate_production_env(path)
    assert 'HOST_SECRET' not in str(error.value)
    assert 'quoted' not in str(error.value)


@pytest.mark.parametrize('which', ['file', 'directory', 'symlink', 'missing'])
def test_requires_existing_private_regular_config(tmp_path, which):
    path = config(tmp_path)
    if which == 'file': path.chmod(0o644)
    elif which == 'directory': path.parent.chmod(0o755)
    elif which == 'symlink':
        target = path.with_suffix('.target'); path.rename(target); path.symlink_to(target)
    else: path.unlink()
    with pytest.raises(ValueError): module.validate_production_env(path)


def test_signing_master_key_and_literal_equals_hash_supported(tmp_path):
    path = config(tmp_path, 'LUMENX_CONFIG_MASTER_KEY=test=key#suffix\n')
    assert module.validate_production_env(path) == path


def test_deploy_and_compose_share_config_and_have_no_old_env_fallback():
    root = Path(__file__).parents[1]
    source = (root / 'scripts/deploy_server_release.py').read_text()
    assert 'envfile = validate_production_env()' in source
    assert "['--env-file', str(envfile)]" in source
    assert "['Config']['Env']" not in source
    assert 'mkstemp' not in source
    assert 'unlink(envfile)' not in source
    compose = (root / 'docker-compose.yml').read_text()
    assert '- /srv/lumenx/runtime/iframe-backend.env' in compose
    assert '      - .env' not in compose
    assert '    environment:' not in compose
