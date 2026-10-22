import hashlib
from io import BytesIO

import pytest
from PIL import Image

from tests.test_photos_analysis import setup
from src.apps.identity import UserContext, require_user_context
from src.apps.photos.intake import PhotoIntakeStore


def image(color='blue'):
    raw = BytesIO(); Image.new('RGB', (12, 8), color).save(raw, 'PNG')
    return raw.getvalue()


def item(raw, key='one'):
    return dict(item_id=key, filename=key + '.png', size=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def test_mixed_intake_retry_refresh_originals_and_no_authorization(setup):
    client, store, app, _ = setup
    raw = image(); bad = b'not an image'
    base = '/photos/upload-batches/intake-test'
    manifest = dict(items=[item(raw), item(bad, 'bad'), item(image('green'), 'later')])
    created = client.put(base, json=manifest)
    assert created.status_code == 200
    assert created.json()['counts'] == dict(pending=3, uploaded=0, failed=0)
    assert client.put(base + '/items/one', content=raw).json()['created'] is True
    assert client.put(base + '/items/bad', content=bad).status_code == 422
    saved = client.get(base).json()
    assert saved['counts'] == dict(pending=1, uploaded=1, failed=1)
    photo = next(row['photo_id'] for row in saved['items'] if row['item_id'] == 'one')
    assert client.get('/photos/' + photo + '/original').content == raw
    assert client.get('/photos/batches/intake-test').json()['granted'] is False
    assert client.get('/photos/' + photo + '/date').json()['reason'] == 'not_processed'
    assert client.get('/photos/' + photo + '/analysis').json() is None
    assert client.put(base + '/items/one', content=raw).json() == dict(photo_id=photo, batch_id='intake-test', created=False)
    # Late wrong-file request cannot regress a successful item.
    assert client.put(base + '/items/one', content=image('red')).status_code == 409
    assert client.get(base).json() == saved
    assert client.put(base + '/items/later', content=image('red')).status_code == 409
    assert client.get(base).json()['counts'] == dict(pending=0, uploaded=1, failed=2)
    assert client.put(base + '/items/later', content=image('green')).status_code == 200
    final = client.get(base).json()
    assert final['counts'] == dict(pending=0, uploaded=2, failed=1)
    # Recreating the immutable manifest and a new store preserves all receipts.
    assert client.put(base, json=manifest).json() == final
    assert PhotoIntakeStore(store.path, initialize=False).intake('owner', 'intake-test') == final
    assert client.get('/photos/upload-batches').json()['batches'] == [final]
    assert client.put(base, json={'items': manifest['items'][:1]}).status_code == 409
    assert client.put(base + '/items/unknown', content=raw).status_code == 404
    app.dependency_overrides[require_user_context] = lambda: UserContext('other','other','','')
    assert client.get(base).status_code == 404
    assert client.put(base + '/items/one', content=raw).status_code == 404
    assert client.get('/photos/upload-batches').json()['batches'] == []
    # Same caller-chosen ID is safely scoped to another owner.
    assert client.put(base, json=manifest).json()['counts']['pending'] == 3


def test_multiple_photos_share_one_scoped_time_consent_and_page(setup):
    client, _, _, _ = setup
    raw = image()
    base = '/photos/upload-batches/batch-a'
    client.put(base, json={'items':[item(raw), item(raw,'two')]})
    first = client.put(base + '/items/one', content=raw).json()
    second = client.put(base + '/items/two', content=raw).json()
    assert first['batch_id'] == second['batch_id']
    assert first['photo_id'] != second['photo_id']
    question = client.post('/photos/batches/batch-a/time-question').json()
    version = client.post('/photos/batches/batch-a/time-consent', json={
        'question_id':question['question_id'], 'granted':True, 'method':'button'}).json()['consent_version']
    for photo in (first, second):
        assert client.post('/photos/' + photo['photo_id'] + '/organize-time', json={
            'expected_revision':1, 'consent_version':version, 'operation_id':'organize'}).status_code == 200
    client.put('/photos/upload-batches/batch-b', json={'items':[item(raw)]})
    page = client.get('/photos/upload-batches?limit=1').json()
    assert page['next_after_id'] == 'batch-a'
    rest = client.get('/photos/upload-batches?limit=1&after_id=batch-a').json()
    assert rest['batches'][0]['batch_id'] == 'batch-b'
    assert rest['next_after_id'] is None


@pytest.mark.parametrize('items', [[], [item(b'a')]*2, [item(b'a', str(i)) for i in range(21)],
    [{**item(b'a'), 'size': True}], [{**item(b'a'), 'sha256': 'invalid'}],
    [{**item(b'a'), 'owner': 'other'}], [{**item(b'a'), 'size': 10*1024*1024+1}]])
def test_invalid_manifest_creates_no_batch(setup, items):
    client, _, _, _ = setup
    assert client.put('/photos/upload-batches/invalid', json={'items': items}).status_code == 422
    assert client.get('/photos/upload-batches/invalid').status_code == 404
