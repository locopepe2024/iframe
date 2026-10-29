"""Registered fake tools exercise the durable lifecycle, not live media APIs."""
import pytest
from pydantic import Field
from src.apps.companion_runtime.operation_protocol import Strict
from src.apps.companion_runtime.operation_store import OperationStore, Missing
from src.apps.companion_runtime.tool_runtime import ToolSpec, ToolRegistry, ToolRuntime, WaitSpec


class Args(Strict):
    source: str


class Selected(Strict):
    photo_id: str = Field(min_length=1)


class Output(Strict):
    photo_id: str
    saved: bool


def setup_runtime(tmp_path):
    spec = ToolSpec(name='fake.select', description='Select a synthetic photo',
        input_model=Args, result_model=Output, execution_mode='async', effect='draft',
        confirmation='none', timeout_seconds=30, retry='same_operation', cancellation='acknowledged',
        preconditions=('active task',),
        waits=(WaitSpec(card_type='fake_photo_picker', events={'photo_selected': Selected}),))
    registry = ToolRegistry([spec])
    store = OperationStore(tmp_path / 'test.db', initialize=True)
    store.create_task('user', 'session', 'task', {'brief': '人物不变'})
    return ToolRuntime(store, registry), store, registry


def begin(runtime):
    return runtime.accept('user', 'session', 'op', 'task', 1, 'fake.select', {'source': 'album'})


def wait_for_photo(runtime):
    begin(runtime)
    return runtime.change('user', 'session', 'op', 'wait', 1, 1, 'waiting_user', wait={
        'wait_id': 'w', 'card_type': 'fake_photo_picker', 'allowed_events': ['photo_selected']})


def test_fake_tool_chain_wait_bind_complete_and_replay(tmp_path):
    runtime, store, registry = setup_runtime(tmp_path)
    wait_for_photo(runtime)
    def bind(db, payload):
        return {**payload, 'photo_id': 'photo-owned'}
    selected = runtime.resume('user', 'session', 'op', 'select', 2, 1,
        wait_id='w', event='photo_selected', payload={'photo_id': 'photo-owned'}, mutate=bind)
    assert selected.revision == 2 and selected.status == 'running'
    assert store.task('user', 'session', 'task')['payload'] == {
        'brief': '人物不变', 'photo_id': 'photo-owned'}
    done = runtime.change('user', 'session', 'op', 'done', 3, 2, 'succeeded',
                          result={'photo_id': 'photo-owned', 'saved': True})
    restarted = ToolRuntime(OperationStore(store.path), registry)
    assert restarted.change('user', 'session', 'op', 'done', 3, 2, 'succeeded',
        result={'photo_id': 'photo-owned', 'saved': True}) == done
    assert [e['receipt']['status'] for e in store.events('user', 'session')] == [
        'accepted', 'waiting_user', 'running', 'succeeded']


@pytest.mark.parametrize('tool,args', [('unknown', {'source': 'album'}),
    ('fake.select', {'source': 'album', 'execute': 'anything'}),
    ('fake.select', {'source': 1})])
def test_unregistered_tool_or_invalid_input_not_accepted(tmp_path, tool, args):
    runtime, store, _ = setup_runtime(tmp_path)
    with pytest.raises(ValueError):
        runtime.accept('user', 'session', 'op', 'task', 1, tool, args)
    assert store.events('user', 'session') == []


@pytest.mark.parametrize('values', [
    {'result': {'saved': 'yes', 'photo_id': 'photo'}},
    {'result': {'saved': True, 'photo_id': 'photo', 'extra': 1}},
])
def test_invalid_result_cannot_be_persisted_as_success(tmp_path, values):
    runtime, store, _ = setup_runtime(tmp_path)
    begin(runtime)
    with pytest.raises(ValueError):
        runtime.change('user', 'session', 'op', 'done', 1, 1, 'succeeded', **values)
    assert store.get('user', 'session', 'op').status == 'accepted'


@pytest.mark.parametrize('card,event', [('arbitrary_html', 'photo_selected'),
                                       ('fake_photo_picker', 'run_script')])
def test_wait_must_use_registered_card_and_events(tmp_path, card, event):
    runtime, store, _ = setup_runtime(tmp_path)
    begin(runtime)
    with pytest.raises(ValueError):
        runtime.change('user', 'session', 'op', 'wait', 1, 1, 'waiting_user', wait={
            'wait_id': 'w', 'card_type': card, 'allowed_events': [event]})
    assert store.get('user', 'session', 'op').status == 'accepted'


def test_event_payload_validated_before_mutation(tmp_path):
    runtime, store, _ = setup_runtime(tmp_path)
    wait_for_photo(runtime)
    def forbidden(db, payload):
        pytest.fail('invalid event invoked adapter')
    with pytest.raises(ValueError):
        runtime.resume('user', 'session', 'op', 'select', 2, 1, wait_id='w',
            event='photo_selected', payload={'photo_id': 1}, mutate=forbidden)
    assert store.get('user', 'session', 'op').status == 'waiting_user'


def test_forged_asset_rejected_by_adapter_without_consuming_wait(tmp_path):
    runtime, store, _ = setup_runtime(tmp_path)
    wait_for_photo(runtime)
    def verify_ownership(db, payload):
        raise ValueError('Photo not owned or missing')
    with pytest.raises(ValueError):
        runtime.resume('user', 'session', 'op', 'select', 2, 1, wait_id='w',
            event='photo_selected', payload={'photo_id': 'forged'}, mutate=verify_ownership)
    assert store.get('user', 'session', 'op').status == 'waiting_user'


def test_catalog_contains_protocol_schemas_and_lifecycle_policies(tmp_path):
    _, _, registry = setup_runtime(tmp_path)
    catalog = registry.catalog()[0]
    assert catalog['execution_mode'] == 'async'
    assert catalog['result_schema']['additionalProperties'] is False
    assert 'photo_selected' in catalog['waits'][0]['events']
    with pytest.raises(ValueError):
        ToolRegistry([registry.get('fake.select'), registry.get('fake.select')])


def test_confirmation_gated_tool_rejected_before_acceptance(tmp_path):
    runtime, store, registry = setup_runtime(tmp_path)
    from dataclasses import replace
    guarded = replace(registry.get('fake.select'), name='fake.guarded', confirmation='required')
    gated = ToolRuntime(store, ToolRegistry([guarded]))
    with pytest.raises(ValueError, match='confirmation'):
        gated.accept('user', 'session', 'op', 'task', 1, 'fake.guarded', {'source': 'album'})
    assert store.events('user', 'session') == []
    # Trusted boolean is supplied by a future confirmation adapter, not the model.
    assert gated.accept('user', 'session', 'op', 'task', 1, 'fake.guarded',
                        {'source': 'album'}, confirmed=True).status == 'accepted'


def test_owner_scope_cannot_be_bypassed_by_runtime(tmp_path):
    runtime, _, _ = setup_runtime(tmp_path)
    begin(runtime)
    with pytest.raises(Missing):
        runtime.change('other', 'session', 'op', 'done', 1, 1, 'succeeded',
                       result={'photo_id': 'photo', 'saved': True})
