from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from PIL import Image

from src.apps.playground.models import GenerateRequest
from src.apps.playground.service import PlaygroundService


def image_bytes(size=(32, 24), mode='RGBA'):
    result = BytesIO()
    Image.new(mode, size, 'white').save(result, format='PNG')
    return result.getvalue()


def service_with_images(tmp_path):
    root = tmp_path / 'owner'
    uploads = root / 'uploads'
    uploads.mkdir(parents=True)
    (uploads / 'source.png').write_bytes(image_bytes())
    (uploads / 'mask.png').write_bytes(image_bytes())
    storage = SimpleNamespace(
        owner_user_id='owner', owner_profile_id='owner', output_dir=str(root),
        resolve_media_reference=lambda ref: str(uploads / ref.removeprefix('/playground/input-media/')),
        ensure_session=lambda *args: SimpleNamespace(id='session'),
        add_generation=lambda *args: None,
        save_session_draft=lambda *args: None,
    )
    return PlaygroundService(storage), uploads


def request(mask='/playground/input-media/mask.png'):
    return GenerateRequest(mode='i2i', model_id='uniart/gpt-image-2.5-flare', prompt='Change selected area',
        input_media=['/playground/input-media/source.png'], parameters={'mask': mask})


def test_owned_mask_is_validated_and_forwarded_to_uniart(tmp_path, monkeypatch):
    service, uploads = service_with_images(tmp_path)
    generation = service.create_generation(request())
    assert generation.parameters['mask'] == '/playground/input-media/mask.png'
    from src.models import uniart
    captured = Mock(return_value=('output.png', 0))
    monkeypatch.setattr(uniart.UniArtImageModel, 'generate', captured)
    service._generate_image_mulerouter(generation, 'output.png', 0)
    assert captured.call_args.kwargs['mask'] == str(uploads / 'mask.png')


@pytest.mark.parametrize('change', ['wrong_size', 'not_rgba', 'not_owner', 'wrong_model'])
def test_mask_rejects_mismatched_or_unowned_input(tmp_path, change):
    service, uploads = service_with_images(tmp_path)
    if change == 'wrong_size':
        (uploads / 'mask.png').write_bytes(image_bytes((16, 16)))
    if change == 'not_rgba':
        (uploads / 'mask.png').write_bytes(image_bytes(mode='RGB'))
    candidate = request('/playground/input-media/../mask.png' if change == 'not_owner' else '/playground/input-media/mask.png')
    if change == 'wrong_model':
        candidate.model_id = 'gpt-image-2'
    with pytest.raises(HTTPException) as exc:
        service.create_generation(candidate)
    assert exc.value.status_code == 422
