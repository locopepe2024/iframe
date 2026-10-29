"""Bounded host-model proposals; only local draft effects share the turn transaction."""
import logging
import os

import requests

from .interaction_focus import active_editor
from .local_planner import check, propose_local, EditPlan
from .store import Conflict

logger = logging.getLogger(__name__)


def state_for(messages):
    snapshot = messages[-1]
    focus = snapshot.get('interaction_focus', {})
    return dict(active=snapshot.get('active_media_draft'),
                paused=snapshot.get('paused_media_drafts', []),
                focus=focus['kind'] + '_editor' if active_editor(focus) else 'chat',
                recent=[dict(text=m['text'], reply=m.get('assistant_reply')) for m in messages[-4:]])


def plan_turn(messages):
    """Return a checked proposal, or delegate on a rejected/unavailable planner."""
    url = os.getenv('IFRAME_COMPANION_PLANNER_URL', '').strip()
    if not url or active_editor(messages[-1].get('interaction_focus')):
        return None
    try:
        result = propose_local(url, messages[-1]['text'], state_for(messages), timeout=12)
        decision = check({'decision':result['decision']}, state_for(messages)).model_dump()
        logger.info('Companion host planner decision=%s', decision['kind'])
        if decision['kind'] == 'delegate':
            return dict(kind='delegate')
        if decision['kind'] == 'clarify':
            return dict(kind='text', text=decision['question'])
        return dict(kind='local_plan', decision=decision)
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        # Never interpret invalid output as a successful execution.
        logger.warning('Companion host planner rejected/unavailable; delegating to main agent')
        return dict(kind='delegate')


def execute_plan(store, db, owner, actor, row, claim, proposal):
    decision = check({'decision': proposal['decision']}, state_for(claim['messages']))
    if not isinstance(decision, EditPlan):
        raise ValueError('Only editing plans may execute')
    snapshot = claim['messages'][-1]
    task = snapshot.get('active_media_draft')
    if task:
        live = store.active_media_draft(db, owner, actor, row['session_id'])
        if not live or (live['task_id'], live['revision']) != (task['task_id'], task['revision']):
            raise Conflict('Creative task changed while planning')
    elif store.active_media_draft(db, owner, actor, row['session_id']):
        raise Conflict('A creative task started while planning')
    receipts = []
    for index, step in enumerate(decision.steps):
        operation = f"{row['id']}-plan-{index}"
        if step.tool == 'media.task.ensure':
            if not task:
                task = store.start_media_draft(owner, actor, row['session_id'], operation, dict(type='image_edit', brief=''))
        else:
            if step.tool == 'media.task.resume':
                task = snapshot['paused_media_drafts'][0]
            if step.tool == 'media.source.request':
                action = 'ask' if step.source == 'ask' else 'open_' + step.source
                if action == 'ask' and task.get('photo_id'):
                    raise ValueError('Source is already selected')
            else:
                action = {'media.brief.set':'brief', 'media.task.pause':'pause',
                          'media.task.cancel':'cancel', 'media.task.resume':'resume'}[step.tool]
            if action != 'ask':
                values = dict(action=action, expected_revision=task['revision'])
                if step.tool == 'media.brief.set':
                    values['brief'] = step.brief
                task = store.update_media_draft(owner, actor, row['session_id'], task['task_id'], operation, values)
        waiting = step.tool == 'media.source.request'
        receipts.append(dict(tool=step.tool, status='waiting_user' if waiting else 'succeeded', revision=task['revision']))
    result = dict(task)
    result['execution'] = dict(plan_id=row['id'], source='host_model',
                               status='waiting_user' if receipts[-1]['status'] == 'waiting_user' else 'succeeded', steps=receipts)
    return result
