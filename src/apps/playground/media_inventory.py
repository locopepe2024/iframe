"""Read-only owner media inventory. Never authorizes physical deletion."""
from contextlib import closing
from datetime import datetime, timezone
import json
import math
import hashlib
from types import SimpleNamespace
from pathlib import Path
import sqlite3
import time

from ..media_registry import list_media

RETENTION_SECONDS = 7 * 24 * 60 * 60


def timestamp(value):
    try:
        if isinstance(value, (int, float)):
            result = float(value)
        else:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            result = parsed.timestamp()
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, AttributeError, OverflowError):
        return None


def inventory(storage, *, limit=50, offset=0, now=None):
    """Query existing stores without initializing them or resolving signed URLs.

    Historical timestamps are informational. All records stay under review until
    asset membership and cross-product references have been reconciled.
    """
    now = time.time() if now is None else now
    items, diagnostics = [], []
    for generation in storage.list_history(limit=1_000_000):
        for output in generation.outputs:
            items.append(dict(id=f'generation:{generation.id}:{output.id}',
                source_kind='generation_output', reference=f'/playground/media/{generation.id}/{output.id}',
                created_at=timestamp(generation.created_at), proposed_expires_at=None,
                time_basis='request_created_not_output_completed', archived=output.saved_to_library))
    edits_path = Path(storage.output_dir) / 'image-edits.sqlite3'
    if edits_path.is_file():
        try:
            with closing(sqlite3.connect(edits_path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
                for row in db.execute('SELECT data, created FROM edits'):
                    record = json.loads(row[0])
                    created = timestamp(record.get('created_at', row[1]))
                    items.append(dict(id='edit:'+record['id'], source_kind='editor_output',
                        reference=record['path'], source_reference=record.get('source_reference'),
                        created_at=created, proposed_expires_at=created + RETENTION_SECONDS if created is not None else None,
                        time_basis='edit_saved', archived=False))
        except (sqlite3.Error, ValueError, KeyError, TypeError):
            diagnostics.append('image_edits_unreadable')
    known_ids = {item['id'].removeprefix('edit:') for item in items if item['source_kind'] == 'editor_output'}
    try:
        for record in list_media(storage.owner_profile_id, output_root=storage.media_root):
            if record['kind'] not in ('temporary_input', 'editor_output') or record['media_id'] in known_ids:
                continue
            created = timestamp(record['created_at'])
            # Avoid exposing raw filesystem paths in the public inventory.
            items.append(dict(id='registry:'+record['media_id'], source_kind=record['kind'],
                reference=None, created_at=created,
                proposed_expires_at=created + RETENTION_SECONDS if created is not None else None,
                time_basis='registry_created', archived=False))
    except (sqlite3.Error, ValueError, KeyError, TypeError):
        diagnostics.append('media_registry_unreadable')
    for item in items:
        item.update(retention_state='legacy_review', delete_eligible=False,
            protection_reasons=['asset_and_project_references_not_reconciled'],
            past_proposed_expiry=item['proposed_expires_at'] is not None and now >= item['proposed_expires_at'])
    items.sort(key=lambda item: (item['created_at'] or 0, item['id']), reverse=True)
    return dict(items=items[offset:offset+limit], total=len(items),
        next_offset=offset+limit if offset+limit < len(items) else None,
        retention_days=7, cleanup_enabled=False, reference_scan_complete=False,
        diagnostics=diagnostics, coverage=['generation_history', 'image_edits', 'registered_temporary_inputs'])


def owner_inventory(identity, output_root, *, limit=50, offset=0):
    """Read persisted history without triggering Playground legacy migration."""
    from .models import PlaygroundGeneration
    owner_dir = Path(output_root) / 'users' / hashlib.sha256(identity.owner_profile_id.encode('utf-8')).hexdigest()[:24]
    history_path = owner_dir / 'playground_history.json'
    generations, diagnostics = [], []
    if history_path.is_file():
        try:
            raw = json.loads(history_path.read_text(encoding='utf-8'))
            if not isinstance(raw, list):
                raise ValueError('History must be an array')
            for item in raw:
                generation = PlaygroundGeneration.model_validate(item)
                if generation.owner_profile_id not in (None, identity.owner_profile_id):
                    diagnostics.append('history_owner_mismatch')
                    continue
                generations.append(generation)
        except (OSError, ValueError, TypeError):
            diagnostics.append('history_unreadable')
    storage = SimpleNamespace(owner_profile_id=identity.owner_profile_id, media_root=str(output_root),
        output_dir=str(owner_dir / 'playground'), list_history=lambda **kwargs: generations)
    result = inventory(storage, limit=limit, offset=offset)
    result['diagnostics'].extend(diagnostics)
    return result
