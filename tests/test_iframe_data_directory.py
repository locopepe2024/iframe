from pathlib import Path
from src.utils import get_user_data_dir, get_log_dir


def test_copies_legacy_data_once_without_overwriting(monkeypatch, tmp_path):
    for key in ('IFRAME_DATA_DIR', 'LUMENX_DATA_DIR', 'IFRAME_LOG_DIR', 'LUMENX_LOG_DIR'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr('os.path.expanduser', lambda value: str(tmp_path / value.removeprefix('~/')))
    legacy = tmp_path / '.lumen-x'
    legacy.mkdir()
    (legacy / 'config.json').write_text('original')
    new = Path(get_user_data_dir())
    assert new == tmp_path / '.iframe'
    assert (new / 'config.json').read_text() == 'original'
    (new / 'config.json').write_text('new')
    assert get_user_data_dir() == str(new)
    assert (new / 'config.json').read_text() == 'new'
    assert (legacy / 'config.json').read_text() == 'original'
    assert get_log_dir() == str(new / 'logs')


def test_new_and_legacy_overrides_remain_supported(monkeypatch, tmp_path):
    monkeypatch.delenv('IFRAME_DATA_DIR', raising=False)
    monkeypatch.setenv('LUMENX_DATA_DIR', str(tmp_path / 'old'))
    assert get_user_data_dir() == str(tmp_path / 'old')
    monkeypatch.setenv('IFRAME_DATA_DIR', str(tmp_path / 'new'))
    assert get_user_data_dir() == str(tmp_path / 'new')
