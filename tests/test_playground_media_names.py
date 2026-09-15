from types import SimpleNamespace

from src.apps.playground.models import GenerateRequest, PlaygroundDraft
from src.apps.playground.service import PlaygroundService
from src.apps.playground.storage import PlaygroundStorage


def test_signed_history_reference_resolves_in_owner_storage(tmp_path):
    storage = PlaygroundStorage(owner_user_id='u', owner_profile_id='p',
        history_path=str(tmp_path / 'history'), templates_path=str(tmp_path / 'templates'),
        sessions_path=str(tmp_path / 'sessions'))
    storage._history = [SimpleNamespace(id='gen', outputs=[SimpleNamespace(id='out', media_path='owned.png')])]
    assert storage.resolve_media_reference('/playground/media/gen/out?expires=123&signature=abc') == 'owned.png'


def test_names_round_trip_without_resolving_media_by_name():
    reference = '/playground/input-media/unique.png'
    draft = PlaygroundDraft(media_names={reference: 'Same name'}, input_media=[reference])
    assert PlaygroundDraft.model_validate_json(draft.model_dump_json()).media_names == draft.media_names
    captured = {}
    storage = SimpleNamespace(
        owner_user_id='u', owner_profile_id='p',
        resolve_media_reference=lambda value: 'owned.png' if value == reference else None,
        ensure_session=lambda *args: SimpleNamespace(id='session'),
        add_generation=lambda generation: captured.update(generation=generation),
        save_session_draft=lambda session, draft, prompt: captured.update(draft=draft),
    )
    request = GenerateRequest(mode='i2i', model_id='test', prompt='@Same name',
        input_media=[reference], media_names={reference: 'Same name'})
    generation = PlaygroundService(storage).create_generation(request)
    assert generation.input_media == ['owned.png']
    assert generation.media_names == {'owned.png': 'Same name'}
    assert captured['draft'].input_media == [reference]
    assert captured['draft'].media_names == {reference: 'Same name'}
