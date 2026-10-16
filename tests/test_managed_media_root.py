import pytest

from src.utils.managed_media_root import ManagedMediaRoot
from src.utils.media_refs import classify_media_ref, resolve_local_media_path


def test_custom_root_roundtrip_and_legacy_aliases(tmp_path):
    store = ManagedMediaRoot(tmp_path / 'media')
    key = 'users/owner/playground/uploads/picture.jpg'
    for locator in (key, 'output/' + key, 'outputs/' + key, str(store.root / key)):
        assert store.resolve(locator) == store.root / key
        assert store.key(locator) == key
    assert not store.resolve(key).exists()  # Supports future writes without creating directories.
    assert not store.root.exists()


@pytest.mark.parametrize('locator', ['', '.', 'output/', 'outputs/', '../secret', 'uploads/../../secret',
                                   'https://example.com/a', 'data:image/png,a', 'blob:abc', 'uploads\\a', '\x00'])
def test_invalid_locator_is_rejected(tmp_path, locator):
    with pytest.raises(ValueError):
        ManagedMediaRoot(tmp_path).resolve(locator)


def test_absolute_outside_and_symlink_escape_are_rejected(tmp_path):
    root = tmp_path / 'media'
    root.mkdir()
    outside = tmp_path / 'outside'
    outside.mkdir()
    (root / 'uploads').symlink_to(outside, target_is_directory=True)
    store = ManagedMediaRoot(root)
    for locator in (str(outside / 'image.jpg'), 'uploads/image.jpg', str(root)):
        with pytest.raises(ValueError):
            store.resolve(locator)


def test_symlink_within_root_canonicalizes_key(tmp_path):
    (tmp_path / 'actual').mkdir()
    (tmp_path / 'uploads').symlink_to(tmp_path / 'actual', target_is_directory=True)
    assert ManagedMediaRoot(tmp_path).key('uploads/picture.jpg') == 'actual/picture.jpg'


def test_existing_adapter_boundary_uses_explicit_custom_root(tmp_path):
    root = tmp_path / 'custom'
    for locator in ('uploads/a.jpg', 'output/uploads/a.jpg', str(root / 'uploads/a.jpg')):
        assert classify_media_ref(locator, output_root=str(root)) == 'local_path'
        assert resolve_local_media_path(locator, output_root=str(root)) == str(root / 'uploads/a.jpg')
    assert classify_media_ref('lumenx/cloud/a.jpg', output_root=str(root)) == 'object_key'
    assert classify_media_ref('arbitrary/file.jpg', output_root=str(root)) == 'unknown'


def test_unsafe_local_refs_are_not_classified_or_resolved(tmp_path):
    root = tmp_path / 'output'
    root.mkdir()
    (root / 'uploads').symlink_to(tmp_path, target_is_directory=True)
    for locator in ('output/../private.jpg', 'uploads/private.jpg', str(tmp_path / 'private.jpg'), 'output/'):
        assert classify_media_ref(locator, output_root=str(root)) == 'unknown'
        assert resolve_local_media_path(locator, output_root=str(root)) is None
