import pytest
from src.apps.companion_runtime.media_asset_tools import AssetBinding, AssetBindArgs, PhotoSelected


def test_source_and_bind_are_separate_registered_tools():
    binding = AssetBinding(photo_exists=lambda owner, photo: photo == 'photo-owned')
    catalog = {item['name']: item for item in binding.registry().catalog()}
    assert set(catalog) == {'media.source.request', 'media.asset.bind'}
    assert catalog['media.source.request']['waits'][0]['card_type'] == 'media_source_picker'
    assert 'photo_selected' in catalog['media.source.request']['waits'][0]['events']


def test_card_display_does_not_claim_asset_binding():
    binding = AssetBinding(photo_exists=lambda owner, photo: True)
    source = binding.registry().get('media.source.request')
    result = source.result_model.model_validate({
        'card_id': 'task:1:source', 'task_id': 'task', 'revision': 1,
        'source': 'album', 'status': 'waiting_user'})
    assert result.status == 'waiting_user'
    assert not hasattr(result, 'photo_id')


def test_selection_event_requires_card_task_and_revision():
    with pytest.raises(ValueError):
        PhotoSelected.model_validate({'photo_id': 'p1', 'card_id': 'c', 'task_id': 't', 'revision': 0})
    event = PhotoSelected.model_validate({'photo_id': 'p1', 'card_id': 'c', 'task_id': 't', 'revision': 2})
    assert event.photo_id == 'p1'


def test_bind_requires_owner_scoped_photo_and_selection_event():
    binding = AssetBinding(photo_exists=lambda owner, photo: owner == 'alice' and photo == 'p1')
    args = {'task_id': 't', 'photo_id': 'p1', 'slot': 'source', 'selection_event_id': 'evt-1'}
    assert binding.validate_bind('alice', args)['photo_id'] == 'p1'
    with pytest.raises(ValueError):
        binding.validate_bind('bob', args)
    with pytest.raises(ValueError):
        binding.validate_bind('alice', {**args, 'selection_event_id': ''})


def test_source_wait_then_asset_bind_is_two_operations(tmp_path):
    from src.apps.companion_runtime.operation_store import OperationStore
    from src.apps.companion_runtime.tool_runtime import ToolRuntime
    binding = AssetBinding(photo_exists=lambda owner, photo: owner == 'alice' and photo == 'p1')
    registry = binding.registry()
    store = OperationStore(tmp_path / 'ops.db', initialize=True)
    store.create_task('alice', 's', 'task', {'type': 'image_edit'})
    runtime = ToolRuntime(store, registry)
    source = runtime.accept('alice', 's', 'source-op', 'task', 1,
                            'media.source.request', {'source': 'album'})
    waiting = runtime.change('alice', 's', 'source-op', 'source-wait', 1, 1, 'waiting_user', wait={
        'wait_id': 'wait-1', 'card_type': 'media_source_picker', 'allowed_events': ['photo_selected']})
    assert waiting.status == 'waiting_user'
    resumed = runtime.resume('alice', 's', 'source-op', 'source-select', 2, 1,
        wait_id='wait-1', event='photo_selected', payload={
            'photo_id': 'p1', 'card_id': 'task:1:source', 'task_id': 'task', 'revision': 1})
    assert resumed.status == 'running'
    bind = runtime.accept('alice', 's', 'bind-op', 'task', 1,
                          'media.asset.bind', binding.validate_bind('alice', {
                              'task_id': 'task', 'photo_id': 'p1', 'slot': 'source',
                              'selection_event_id': 'source-select'}))
    done = runtime.change('alice', 's', 'bind-op', 'bind-done', 1, 1, 'succeeded',
                          result={'task_id': 'task', 'photo_id': 'p1', 'slot': 'source',
                                  'bound': True, 'task_revision': 2})
    assert done.status == 'succeeded'
