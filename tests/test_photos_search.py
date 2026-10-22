from datetime import datetime, timezone
from io import BytesIO

from PIL import Image

from tests.test_photos_analysis import setup, OBSERVATION
from src.apps.identity import UserContext, require_user_context
from src.apps.photos.analysis import PhotoAnalysis, Observation


def test_search_latest_sources_literal_text_owner_and_pagination(setup):
    client, store, app, path = setup
    pid = path.split('/')[-1]
    before = client.get(path + '/date').json()
    store.save_analysis('owner', pid, 'actor', PhotoAnalysis(
        model='fixture', image_sha256='abc', created_at=datetime.now(timezone.utc),
        observation=Observation(**OBSERVATION)))

    def search(query, **params):
        response = client.get('/photos/albums', params={'query': query, **params})
        assert response.status_code == 200
        return response.json()

    assert search('桌子')['photos'] == []  # Unreviewed AI content excluded.
    body = dict(text='公园里看到100%_的景色', expected_revision=0, operation_id='first')
    assert client.post(path + '/story', json=body).status_code == 200
    assert search('   公园  ')['photos'][0]['search_matches'] == [
        {'source': 'story', 'revision': 1, 'excerpt': body['text']}]
    assert search('%_')['photos'][0]['photo_id'] == pid
    assert search("' OR 1=1 --")['photos'] == []
    assert search('公园', year=1985)['photos'] == []
    assert len(search('公园', view='pending')['photos']) == 1
    assert client.post(path + '/story', json={**body, 'text': '和朋友爬山', 'expected_revision': 1, 'operation_id': 'edit'}).status_code == 200
    assert search('公园')['photos'] == []  # Old revisions excluded.
    assert client.post(path + '/description', json=dict(description='公园中的椅子', expected_revision=0, operation_id='review')).status_code == 200
    assert search('公园')['photos'][0]['search_matches'][0]['source'] == 'description'
    raw = BytesIO(); Image.new('RGB', (8, 8), 'blue').save(raw, 'PNG')
    second = client.post('/photos/uploads/second', content=raw.getvalue()).json()['photo_id']
    assert client.post('/photos/' + second + '/story', json={**body, 'text': '公园游玩'}).status_code == 200
    first = search('公园', limit=1)
    rest = search('公园', limit=1, after_id=first['next_after_id'])
    assert {first['photos'][0]['photo_id'], rest['photos'][0]['photo_id']} == {pid, second}
    assert rest['next_after_id'] is None
    assert client.get(path + '/date').json() == before
    assert search('x' * 100)['photos'] == []
    assert client.get('/photos/albums', params={'query': 'x' * 101}).status_code == 422
    app.dependency_overrides[require_user_context] = lambda: UserContext('other', 'other', '', '')
    assert search('公园')['photos'] == []
    assert search('朋友')['photos'] == []


def test_search_source_excerpt_and_combined_year_filter(setup):
    client, store, _, path = setup
    pid = path.split('/')[-1]
    text = '前' * 300 + '踏青' + '后' * 300
    store.save_story('owner', pid, 'actor', text=text, expected_revision=0, operation_id='story')
    question = client.post('/photos/batches/' + client.get('/photos/albums').json()['photos'][0]['batch_id'] + '/time-question').json()
    consent = client.post('/photos/batches/' + question['batch_id'] + '/time-consent', json={
        'question_id': question['question_id'], 'granted': True, 'method': 'button'}).json()
    assert client.patch(path + '/date', json=dict(value='1985', precision='year', expected_revision=1,
        consent_version=consent['consent_version'], operation_id='date')).status_code == 200
    result = client.get('/photos/albums', params={'query': '踏青', 'year': 1985}).json()['photos']
    assert len(result) == 1
    excerpt = result[0]['search_matches'][0]['excerpt']
    assert '踏青' in excerpt and len(excerpt) == 160
    assert client.get('/photos/albums', params={'query': '踏青', 'view': 'pending'}).json()['photos'] == []
    # Blank search retains the existing full album response.
    assert client.get('/photos/albums', params={'query': '   '}).json() == client.get('/photos/albums').json()
