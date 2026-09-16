from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps.playground import api
from src.apps import identity


@pytest.fixture(params=['png', 'mp4'])
def client(tmp_path, monkeypatch, request):
    image = tmp_path / f'media.{request.param}'
    image.write_bytes(b'owned-image')
    output = SimpleNamespace(id='output', media_path=str(image), thumbnail_path=None)
    generation = SimpleNamespace(outputs=[output])
    monkeypatch.setattr(api, '_storage_for', lambda owner: SimpleNamespace(
        get_generation=lambda gid: generation if owner.owner_profile_id == 'browser-owner' and gid == 'generation' else None))
    monkeypatch.setattr(api, '_storages', {})
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    with TestClient(app) as session:
        yield session


def test_browser_owner_can_download_original_without_signed_preview(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    response = client.get('/playground/media/generation/output')
    assert response.status_code == 200
    assert response.content == b'owned-image'


def test_browser_owner_cannot_download_another_owners_file(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'other')
    assert client.get('/playground/media/generation/output').status_code == 404


def test_no_identity_does_not_create_anonymous_owner_to_download(client):
    assert client.get('/playground/media/generation/output').status_code == 401


def test_expired_signed_preview_is_not_rescued_by_cookie(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    assert client.get('/playground/media/generation/output?expires=1&signature=expired').status_code == 401


def test_invalid_bearer_is_not_rescued_by_cookie(client, monkeypatch):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    monkeypatch.setattr(identity.UniArtIdentityClient, 'me', Mock(side_effect=HTTPException(401, 'expired')))
    assert client.get('/playground/media/generation/output', headers={'Authorization': 'Bearer invalid'}).status_code == 401
