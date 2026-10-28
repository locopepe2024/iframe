"""Read-only bridge to the existing owner-scoped photo repository."""
import os
from pathlib import Path

from fastapi import HTTPException

from ..photos.workflow import PhotoWorkflowStore
from ..photos.date_store import PhotoNotAvailable
from .store import Missing


def read_photos(owner, name, values):
    if name not in ('photo.album.list', 'photo.item.read'):
        raise ValueError('Unknown read-only photo tool')
    configured = os.getenv('IFRAME_PHOTOS_LOCAL_DB_PATH', '')
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, '相册暂不可用，请稍后重试。')
    store = PhotoWorkflowStore(path, initialize=False)
    try:
        if name == 'photo.album.list':
            page = store.album_page(owner, **values)
            return dict(photos=[dict(photo, date=photo['date'].model_dump(mode='json'))
                                for photo in page['photos']], next_after_id=page['next_after_id'])
        photo_id = values['photo_id']
        date = store.read(owner, photo_id)
        analysis = store.analysis(owner, photo_id)
        return dict(photos=[dict(photo_id=photo_id, date=date.model_dump(mode='json'),
                                description=store.description_review(owner, photo_id),
                                story=store.story(owner, photo_id),
                                analysis=analysis.model_dump(mode='json') if analysis else None,
                                annotations=store.annotations(owner, photo_id))],
                    next_after_id=None)
    except PhotoNotAvailable as exc:
        raise Missing('Photo unavailable') from exc


def photo_store():
    configured = os.getenv('IFRAME_PHOTOS_LOCAL_DB_PATH', '')
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, '相册暂不可用，请稍后重试。')
    return PhotoWorkflowStore(path, initialize=False)
