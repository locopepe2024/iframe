import pytest
from src.apps.companion_runtime import registered_read_tools


def test_read_registry_exposes_only_sync_read_tools():
    catalog = {item['name']: item for item in registered_read_tools.read_registry().catalog()}
    assert set(catalog) == {'photo.album.count', 'photo.album.list', 'photo.item.read'}
    assert all(item['execution_mode'] == 'sync' and item['effect'] == 'read' for item in catalog.values())
    assert all(item['confirmation'] == 'none' for item in catalog.values())


def test_count_result_is_validated_at_adapter_boundary(monkeypatch):
    monkeypatch.setattr(registered_read_tools, 'read_photos', lambda owner, name, values: {
        'total': 2, 'spoken_text': '相册里一共有2张照片。'})
    assert registered_read_tools.execute_read('owner-1', 'photo.album.count', {})['total'] == 2


def test_list_result_rejects_unbounded_or_malformed_storage_records(monkeypatch):
    monkeypatch.setattr(registered_read_tools, 'read_photos', lambda owner, name, values: {
        'photos': [{'photo_id': 'p1', 'date': {'year': 2026}}], 'next_after_id': None})
    assert registered_read_tools.execute_read('owner-1', 'photo.album.list', {})['photos'][0]['photo_id'] == 'p1'
    monkeypatch.setattr(registered_read_tools, 'read_photos', lambda owner, name, values: {
        'photos': [{'photo_id': 'p1', 'date': {'year': 2026}}] * 13, 'next_after_id': None})
    with pytest.raises(ValueError):
        registered_read_tools.execute_read('owner-1', 'photo.album.list', {})


def test_read_tool_rejects_unknown_fields_before_storage(monkeypatch):
    called = False
    def fail(*args):
        nonlocal called
        called = True
        return {}
    monkeypatch.setattr(registered_read_tools, 'read_photos', fail)
    with pytest.raises(ValueError):
        registered_read_tools.execute_read('owner-1', 'photo.album.count', {'delete': True})
    assert called is False


def test_item_result_requires_exactly_one_photo(monkeypatch):
    monkeypatch.setattr(registered_read_tools, 'read_photos', lambda owner, name, values: {
        'photos': [], 'next_after_id': None})
    with pytest.raises(ValueError):
        registered_read_tools.execute_read('owner-1', 'photo.item.read', {'photo_id': 'p1'})
