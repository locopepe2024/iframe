import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('media_signing_config', Path(__file__).parents[1] / 'scripts/media_signing_config.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_missing_key_is_private_and_stable(tmp_path):
    path = tmp_path / 'secrets/media-signing.key'
    first = module.media_signing_env(['OTHER=value', 'LUMENX_MEDIA_SIGNING_KEY='], path)
    assert first == module.media_signing_env(['OTHER=value'], path)
    assert path.stat().st_mode & 0o777 == 0o600
    assert len(first[-1].split('=', 1)[1]) >= 32


def test_existing_signing_keys_are_not_rotated(tmp_path):
    for name in ('LUMENX_MEDIA_SIGNING_KEY', 'LUMENX_CONFIG_MASTER_KEY'):
        env = [name + '=existing-secret']
        path = tmp_path / 'unused'
        assert module.media_signing_env(env, path) == env
        assert not path.exists()
