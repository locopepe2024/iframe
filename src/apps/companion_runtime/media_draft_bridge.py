"""Compatibility bridge from existing media_drafts UI events to registered tools.

The bridge keeps the existing draft transaction as the business state owner.
It validates the currently rendered source card before delegating selection;
card display and asset binding remain separate protocol operations.
"""
from .media_asset_tools import AssetBindArgs, PhotoSelected, SourceCardResult
from .ui_cards import source_card, asset_slot_card
from .store import Conflict, Missing


def source_request_from_draft(task: dict) -> SourceCardResult:
    card = source_card(task)
    if card is None:
        raise Conflict('Source card is unavailable for this draft')
    source = task.get('source_choice', {}).get('source', 'album')
    # Existing UI cards do not persist source as a separate field. The event
    # adapter supplies the selected source; default is the album card flow.
    return SourceCardResult.model_validate({
        'card_id': card['card_id'], 'task_id': task['task_id'],
        'revision': task['revision'], 'source': source, 'status': 'waiting_user'})


def selection_event_from_draft(task: dict, *, card_id: str, photo_id: str, slot: str = 'source') -> PhotoSelected:
    card = source_card(task) if slot == 'source' else asset_slot_card(task, slot)
    if card is None or card['card_id'] != card_id:
        raise Conflict('Asset card is stale or unavailable')
    if not photo_id.strip():
        raise ValueError('Photo selection is required')
    return PhotoSelected.model_validate({
        'photo_id': photo_id, 'card_id': card_id,
        'task_id': task['task_id'], 'revision': task['revision'], 'slot': slot})


def bind_arguments(task: dict, event: PhotoSelected, *, event_id: str) -> AssetBindArgs:
    if event.task_id != task['task_id'] or event.revision != task['revision']:
        raise Conflict('Selection does not match the current draft revision')
    return AssetBindArgs(task_id=task['task_id'], photo_id=event.photo_id,
                         slot=event.slot, selection_event_id=event_id)


def apply_selection(store, owner: str, actor: str, session: str, task: dict,
                    event: PhotoSelected, *, operation_id: str):
    """Apply the existing draft mutation only after the card event is verified."""
    bind_arguments(task, event, event_id=operation_id)
    if task['task_id'] != event.task_id:
        raise Missing('Creative task unavailable')
    actions = {'source': 'select_photo', 'first_frame': 'select_first_photo',
               'last_frame': 'select_last_photo', 'reference': 'add_reference_photo'}
    return store.update_media_draft(owner, actor, session, task['task_id'], operation_id, {
        'expected_revision': event.revision, 'action': actions[event.slot],
        'photo_id': event.photo_id})
