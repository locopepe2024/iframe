import pytest
from src.models import uniart


@pytest.mark.parametrize('ratio,tier,size', [('16:9', '1k', '1024x576'), ('9:16', '2k', '1152x2048'), ('1:1', '4k', '4096x4096')])
@pytest.mark.parametrize('quality', ['low', 'medium', 'high'])
def test_image_ratio_quality_outbound(monkeypatch, ratio, tier, size, quality):
    captured = {}
    def post(config, endpoint, body):
        captured.update(body)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *args, **kwargs: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *args: None)
    uniart.UniArtImageModel({}).generate('test', 'unused.png', size=tier, aspect_ratio=ratio, quality=quality)
    assert 'size' not in captured
    assert captured['resolution'] == tier
    assert captured['quality'] == quality
    assert captured['aspect_ratio'] == ratio


def test_text_to_image_does_not_send_reference_material(monkeypatch):
    captured = {}

    def post(config, endpoint, body):
        captured.update(endpoint=endpoint, body=body)
        return {'data': [{'url': 'https://storage.example/result.png'}]}

    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_download_result', lambda *args: None)

    uniart.UniArtImageModel({}).generate(
        'a neutral product still life',
        'unused.png',
        model_name='uniart/gpt-image-2.5-flare-discount',
        size='1k',
    )

    assert captured['endpoint'] == '/images/generations'
    assert 'images' not in captured['body']



def test_image_edit_forwards_reference_and_semantic_size(monkeypatch, tmp_path):
    image = tmp_path / 'reference.png'
    image.write_bytes(b'image')
    monkeypatch.setattr(uniart, '_image_reference_url', lambda path: 'https://storage.example/reference.png')
    captured = {}
    def post(config, endpoint, body):
        captured.update(endpoint=endpoint, body=body)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    uniart.UniArtImageModel({}).generate('edit', 'unused.png', size='2k', aspect_ratio='16:9', ref_image_paths=[str(image)])
    assert captured['endpoint'] == '/images/edits'
    assert captured['body']['images'] == ['https://storage.example/reference.png']
    assert 'image' not in captured['body']
    assert captured['body']['resolution'] == '2k'
    assert 'size' not in captured['body']


def test_local_edit_material_is_uploaded_and_signed(monkeypatch, tmp_path):
    from src.utils import oss_utils
    image = tmp_path / 'large.png'
    image.write_bytes(b'x' * (2 * 1024 * 1024))
    class Storage:
        is_configured = True
        def upload_file(self, path, sub_path):
            assert path == str(image)
            return 'materials/large.png'
        def sign_url_for_api(self, key):
            assert key == 'materials/large.png'
            return 'https://storage.example/large.png?signature=test'
    monkeypatch.setattr(oss_utils, 'OSSImageUploader', Storage)
    assert uniart._image_reference_url(str(image)) == 'https://storage.example/large.png?signature=test'


def test_mask_edit_uses_urls_and_polls_image_task(monkeypatch):
    captured = {}
    def post(config, endpoint, body):
        captured.update(endpoint=endpoint, body=body)
        return {'task_id': 'task-mask'}
    def poll(config, task_id, endpoint):
        assert task_id == 'task-mask'
        assert endpoint == 'images'
        return {'data': [{'url': 'https://storage.example/result.png'}]}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_download_result', lambda *args: None)
    uniart.UniArtImageModel({}).generate('edit', 'unused.png', ref_image_paths=['https://storage.example/source.png'], mask='https://storage.example/mask.png')
    assert captured['endpoint'] == '/images/edits'
    assert captured['body']['images'] == ['https://storage.example/source.png']
    assert captured['body']['mask'] == 'https://storage.example/mask.png'
    assert captured['body']['async'] is True


def test_sync_url_result_does_not_poll(monkeypatch):
    result = {'data': [{'url': 'https://storage.example/result.png'}]}
    monkeypatch.setattr(uniart, '_post', lambda *args: result)
    monkeypatch.setattr(uniart, '_poll', lambda *args, **kwargs: pytest.fail('sync result must not poll'))
    downloaded = []
    monkeypatch.setattr(uniart, '_download_result', lambda config, data, kind, path: downloaded.append(data))
    uniart.UniArtImageModel({}).generate('test', 'unused.png')
    assert downloaded == [result]


@pytest.mark.parametrize('model', ['uniart/gpt-image-2', 'uniart/nano-banana-2-special', 'uniart/gpt-image-2.5-flare-special'])
@pytest.mark.parametrize('asynchronous', [True, False])
def test_url_array_edit_contract_and_response_lifecycle(monkeypatch, model, asynchronous):
    references = ['https://storage.example/a.png', 'https://storage.example/b.png']
    result = {'data': [{'url': 'https://storage.example/result.png'}]}
    def post(config, endpoint, body):
        assert endpoint == '/images/edits'
        assert body['images'] == references
        assert 'async' not in body  # Gateway route owns provider sync/async choice.
        return {'task_id': 'accepted-task'} if asynchronous else result
    def poll(config, task_id, endpoint):
        assert asynchronous, 'synchronous result must not be polled'
        assert (task_id, endpoint) == ('accepted-task', 'images')
        return result
    downloaded = []
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_download_result', lambda config, data, kind, path: downloaded.append(data))
    uniart.UniArtImageModel({}).generate('edit', 'unused.png', model_name=model, ref_image_paths=references)
    assert downloaded == [result]


@pytest.mark.parametrize('model', ['gpt-image-2.5-flare-discount', 'gpt-image-2.5-sunburst-discount'])
def test_discount_preserves_structured_reference_contract(monkeypatch, model):
    def post(config, endpoint, body):
        assert body['images'] == [{'image_url': 'https://storage.example/reference.png'}]
        return {'data': [{'url': 'https://storage.example/result.png'}]}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: pytest.fail('sync result must not poll'))
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    uniart.UniArtImageModel({}).generate('edit', 'unused.png', model_name=model, ref_image_paths=['https://storage.example/reference.png'])


@pytest.mark.parametrize('tier', ['1k', '2k', '4k'])
@pytest.mark.parametrize('quality', ['high', '4k'])
@pytest.mark.parametrize('model', ['uniart/nano-banana-2-special', 'uniart/gpt-image-2-special'])
def test_special_quality_is_forwarded_for_uniart_to_adapt(monkeypatch, tier, quality, model):
    def post(config, endpoint, body):
        assert body['resolution'] == tier
        assert body['quality'] == quality
        assert 'size' not in body
        return {'data': [{'url': 'https://storage.example/result.png'}]}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    uniart.UniArtImageModel({}).generate('edit', 'unused.png',
        model_name=model, size=tier, quality=quality,
        ref_image_paths=['https://storage.example/source.png'])


@pytest.mark.parametrize('size,tier,ratio', [('576*1024','1k','9:16'),('1024*576','1k','16:9'),('1024*1024','1k','1:1'),('1536*2048','2k','3:4')])
def test_legacy_studio_gpt_size_uses_gateway_resolution_contract(monkeypatch,size,tier,ratio):
    def post(config,endpoint,body):
        assert 'size' not in body
        assert body['resolution']==tier
        assert body['aspect_ratio']==ratio
        return {'data':[{'url':'https://example.test/result.png'}]}
    monkeypatch.setattr(uniart,'_post',post)
    monkeypatch.setattr(uniart,'_download_result',lambda *a:None)
    uniart.UniArtImageModel({}).generate('reference','unused.png',model_name='uniart/gpt-image-2',size=size)


def test_explicit_pixel_size_remains_explicit(monkeypatch):
    def post(config,endpoint,body):
        assert body['size']=='1024x1536'
        assert 'resolution' not in body
        return {'data':[{'url':'https://example.test/result.png'}]}
    monkeypatch.setattr(uniart,'_post',post)
    monkeypatch.setattr(uniart,'_download_result',lambda *a:None)
    uniart.UniArtImageModel({}).generate('reference','unused.png',size='1024x1536')
