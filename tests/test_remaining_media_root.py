from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps import agent_api as agent
from src.apps.identity import UserContext
from src.apps.recreation.service import RecreationService
from src.apps.studio_access import studio_owner_dir, studio_media_url


def test_agent_database_root_and_explicit_override(tmp_path, monkeypatch):
    root = tmp_path / 'selected'
    monkeypatch.setenv('IFRAME_MEDIA_ROOT', str(root))
    monkeypatch.delenv('LUMENX_AGENT_DB', raising=False)
    with agent.database() as db:
        db.execute("INSERT INTO sessions VALUES ('owner', 'session', '{}', 0)")
    with agent.database() as db:
        assert db.execute('SELECT id FROM sessions').fetchone()[0] == 'session'
    assert (root / 'agent.sqlite3').is_file()
    other = tmp_path / 'explicit.sqlite3'
    monkeypatch.setenv('LUMENX_AGENT_DB', str(other))
    with agent.database() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 0
    assert other.is_file()


def test_agent_custom_root_signed_reference_and_owner_boundary(tmp_path, monkeypatch):
    from src.apps.playground import api as playground
    from src.apps.comic_gen import api
    root = tmp_path / 'selected'
    ctx = UserContext('user', 'profile', 'User', '')
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-signing-key')
    monkeypatch.setattr(playground, '_storage_for', lambda ctx: Mock(media_root=str(root)))
    monkeypatch.setattr(api, 'pipeline', Mock(output_root=str(root), get_asset_library_reference_index=Mock(return_value=Mock(assets=[]))))
    owner = Path(studio_owner_dir(ctx.owner_profile_id, output_root=str(root)))
    image = owner / 'assets' / 'image.png'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'image')
    stored = image.relative_to(root).as_posix()
    signed = studio_media_url(ctx.owner_profile_id, stored, output_root=str(root))
    assert Path(agent.reference_path(ctx, stored)).read_bytes() == b'image'
    assert agent.reference_path(ctx, signed) == str(image.resolve())
    assert agent.owned_library_image_key(ctx, signed) == stored
    with pytest.raises(HTTPException):
        agent.reference_path(ctx, signed.replace('signature=', 'signature=wrong'))
    foreign = Path(studio_owner_dir('other', output_root=str(root))) / 'image.png'
    foreign.parent.mkdir(parents=True)
    foreign.write_bytes(b'foreign')
    with pytest.raises(HTTPException):
        agent.reference_path(ctx, foreign.relative_to(root).as_posix())


def test_recreation_root_snapshot_database_and_escape(tmp_path, monkeypatch):
    root = tmp_path / 'selected'
    monkeypatch.setenv('IFRAME_MEDIA_ROOT', str(root))
    ctx = UserContext('user', 'profile', 'User', '')
    service = RecreationService(ctx)
    image = service.root / 'image.png'
    image.write_bytes(b'image')
    stored = image.relative_to(root).as_posix()
    assert service._path(stored).read_bytes() == b'image'
    with service.db() as db:
        db.execute("INSERT INTO projects VALUES (?, ?, ?)", ('p', 'profile', '{"id":"p"}'))
    assert RecreationService(ctx).get('p')['id'] == 'p'
    assert (root / 'recreation.sqlite3').is_file()
    monkeypatch.setenv('IFRAME_MEDIA_ROOT', str(tmp_path / 'other'))
    assert service._path(stored) == image
    with RecreationService(ctx).db() as db:
        assert db.execute('SELECT COUNT(*) FROM projects').fetchone()[0] == 0
    outside = tmp_path / 'outside.png'
    outside.write_bytes(b'outside')
    (service.root / 'escape.png').symlink_to(outside)
    for value in (str(outside), '../outside.png', (service.root / 'escape.png').relative_to(root).as_posix()):
        with pytest.raises(ValueError):
            service._path(value)
