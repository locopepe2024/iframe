"""Bounded model context from stored turns; never re-execute historical tools."""
import json


def read_summary(name, output):
    """Keep identifiers/counts, not memory or diary bodies that may later be deleted."""
    if name == 'photo.album.list' or name == 'photo.item.read':
        return dict(photo_ids=[p['photo_id'] for p in output.get('photos', [])[:12]],
                    has_more=bool(output.get('next_after_id')))
    if name.startswith('diary.'):
        return dict(days=[d['day'] for d in output.get('diaries', [])[:31]],
                    open_calendar=bool(output.get('open_calendar')))
    return None


def attach_replies(db, owner, actor, session, messages):
    """Attach completed replies only within this bounded user-message window."""
    ids = [m['id'] for m in messages]
    if not ids:
        return
    rows = db.execute(
        'SELECT message_id,id,result FROM companion_turns WHERE owner=? AND actor=? '
        'AND session_id=? AND status=? AND message_id IN (' + ','.join('?' for _ in ids) + ')',
        (owner, actor, session, 'completed', *ids)).fetchall()
    by_id = {row['message_id']: row for row in rows}
    remaining = 16000
    # Keep newest replies preferentially. Raw user messages remain untouched.
    for message in reversed(messages):
        row = by_id.get(message['id'])
        if not row:
            continue
        result = json.loads(row['result'])
        kind = result.get('kind')
        reply = dict(turn_id=row['id'], kind=kind)
        if kind == 'text':
            reply['text'] = result['text'][:4000]
        elif kind == 'read':
            reply.update(tool=result['name'], status='executed',
                         summary=result.get('context_summary'))
        elif kind == 'confirmation':
            reply['status'] = 'confirmation_requested_outcome_unknown'
        elif kind == 'photo_task':
            reply.update(task_id=result['task_id'], status='workflow_started_or_updated')
        elif kind == 'photo_action':
            reply.update(action=result['action'], photo_id=result['photo_id'], status='confirmation_requested_outcome_unknown')
        elif kind in ('album_guide', 'upload_guide'):
            reply['status'] = 'guide_shown'
        else:
            continue
        size = len(json.dumps(reply, ensure_ascii=False))
        if size <= remaining:
            message['assistant_reply'] = reply
            remaining -= size
