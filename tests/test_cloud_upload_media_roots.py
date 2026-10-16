"""Exercise both upload adapters without credentials or network calls."""
from types import SimpleNamespace

import pytest

from src.utils import cos_storage, oss_utils


@pytest.fixture(params=['cos', 'oss'])
def uploader(request, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # Keep the system-temp allowance distinct from pytest's media test paths.
    temporary = tmp_path / 'temporary'
    temporary.mkdir()
    monkeypatch.setattr('tempfile.gettempdir', lambda: str(temporary))
    sent = []
    if request.param == 'cos':
        adapter = object.__new__(cos_storage.COSImageUploader)
        adapter.bucket_name = 'test-bucket'
        adapter.region = 'test-region'
        adapter.base_path = 'media'
        def put_object(**kwargs):
            sent.append((kwargs['Key'], kwargs['Body'].read()))
        adapter.client = SimpleNamespace(
            put_object=put_object,
            head_object=lambda **kwargs: {'content-length': len(sent[-1][1])},
        )
    else:
        adapter = object.__new__(oss_utils.OSSImageUploader)
        adapter.base_path = 'media'
        def put_object(key, body):
            sent.append((key, body.read()))
            return SimpleNamespace(status=200)
        adapter.bucket = SimpleNamespace(put_object=put_object)
        monkeypatch.setattr(oss_utils, 'is_oss_enabled', lambda: True)
    return adapter, sent, temporary


def file_at(root, key='image.jpg'):
    target = root / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'actual media bytes')
    return target


def test_custom_root_and_no_configuration_leak(uploader, tmp_path):
    adapter, sent, _ = uploader
    root = tmp_path / 'custom-media'
    path = file_at(root)
    assert adapter.upload_file(str(path), sub_path='assets', output_root=root) == 'media/assets/image.jpg'
    assert sent == [('media/assets/image.jpg', path.read_bytes())]
    # An explicit root on the preceding call must not mutate singleton policy.
    assert adapter.upload_file(str(path)) is None
    assert adapter.upload_file(str(path), output_root=tmp_path / 'other') is None
    assert len(sent) == 1


def test_default_relative_paths_and_temporary_files(uploader, tmp_path):
    adapter, sent, temporary = uploader
    file_at(tmp_path / 'output')
    assert adapter.upload_file('output/image.jpg') == 'media/image.jpg'
    temp_path = file_at(temporary, 'transient.jpg')
    assert adapter.upload_file(str(temp_path), output_root=tmp_path / 'custom') == 'media/transient.jpg'
    assert len(sent) == 2


def test_canonical_containment_and_regular_files(uploader, tmp_path):
    adapter, sent, _ = uploader
    root = tmp_path / 'custom'
    root.mkdir()
    outside = file_at(tmp_path / 'custom-neighbor')
    (root / 'escape.jpg').symlink_to(outside)
    for path in [root, root / 'missing.jpg', root / 'escape.jpg', outside]:
        assert adapter.upload_file(str(path), output_root=root) is None
    inside = file_at(root)
    (root / 'inside-link.jpg').symlink_to(inside)
    assert adapter.upload_file(str(root / 'inside-link.jpg'), output_root=root) == 'media/image.jpg'
    assert len(sent) == 1


def test_upload_aliases_accept_explicit_root(uploader, tmp_path):
    adapter, sent, _ = uploader
    root = tmp_path / 'custom'
    path = file_at(root)
    for method in [adapter.upload_image, adapter.upload_video]:
        assert method(str(path), sub_path="assets", output_root=root) == 'media/assets/image.jpg'
    assert len(sent) == 2
