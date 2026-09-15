import base64
from src.models import uniart


def test_sync_image_response_is_saved_without_polling(monkeypatch, tmp_path):
    image = b'generated-image-bytes'
    payload = {'created': 123, 'data': [{'b64_json': base64.b64encode(image).decode()}]}
    class Response:
        status_code = 200
        def raise_for_status(self): return None
        def json(self):
            return payload
    monkeypatch.setattr(uniart.requests, 'post', lambda *args, **kwargs: Response())
    monkeypatch.setattr(uniart, '_poll', lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('synchronous image must not poll')))
    path = tmp_path / 'result.png'
    uniart.UniArtImageModel({'api_key': 'test'}).generate('test', str(path))
    assert path.read_bytes() == image


def test_missing_task_id_error_does_not_embed_provider_payload(monkeypatch):
    class Response:
        status_code = 200
        def raise_for_status(self): return None
        def json(self):
            return {'unexpected': 'sensitive-large-payload' * 1000}
    monkeypatch.setattr(uniart.requests, 'post', lambda *args, **kwargs: Response())
    try:
        uniart._post({'api_key': 'test'}, '/images/generations', {})
    except RuntimeError as error:
        assert len(str(error)) < 300
        assert 'sensitive-large-payload' not in str(error)
    else:
        raise AssertionError('expected invalid response to be rejected')
