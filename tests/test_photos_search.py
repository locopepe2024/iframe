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
    assert client.post(path + '/description', json=dict(description='公园中的朋友', expected_revision=1, operation_id='review2')).status_code == 200
    assert search('椅子')['photos'] == []
    matches = search('朋友')['photos'][0]['search_matches']
    assert [(match['source'], match['revision']) for match in matches] == [('story', 2), ('description', 2)]
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


def test_album_date_filter_precision_validation_and_recent_pagination(setup):
    client, store, _, path = setup
    first_id = path.split('/')[-1]
    raw = BytesIO(); Image.new('RGB', (8, 8), 'blue').save(raw, 'PNG')
    second_id = client.post('/photos/uploads/recent-second', content=raw.getvalue()).json()['photo_id']
    recent = client.get('/photos/albums', params={'order': 'recent', 'limit': 1}).json()
    assert recent['photos'][0]['photo_id'] == second_id
    older = client.get('/photos/albums', params={'order': 'recent', 'limit': 1, 'after_id': recent['next_after_id']}).json()
    assert older['photos'][0]['photo_id'] == first_id
    assert older['next_after_id'] is None
    assert client.get('/photos/albums', params={'order': 'recent', 'after_id': 'other-owner-or-absent'}).json()['photos'] == []
    batch_id = next(p['batch_id'] for p in client.get('/photos/albums').json()['photos'] if p['photo_id'] == first_id)
    question = client.post('/photos/batches/' + batch_id + '/time-question').json()
    consent = client.post('/photos/batches/' + batch_id + '/time-consent', json=dict(question_id=question['question_id'], granted=True, method='button')).json()
    result = client.patch(path + '/date', json=dict(value='2025-10-01', precision='day', expected_revision=1,
        consent_version=consent['consent_version'], operation_id='dated'))
    assert result.status_code == 200, result.text
    for prefix in ('2025', '2025-10', '2025-10-01'):
        page = client.get('/photos/albums', params={'date_prefix': prefix}).json()
        assert [p['photo_id'] for p in page['photos']] == [first_id]
    assert client.get('/photos/albums', params={'date_prefix': '2025-10-02'}).json()['photos'] == []
    for prefix in ('2025-02-30', '2025-13', 'bad'):
        assert client.get('/photos/albums', params={'date_prefix': prefix}).status_code == 422


def test_confirmed_structured_facts_are_searchable_and_override_date_filters(setup):
    client, store, _, path = setup
    record = client.get(path + '/annotations').json()
    facts = {**record['facts'], 'people':[dict(reference='p1',name='小明',age=68,gender='male')],
             'location':'杭州', 'capture_time':'1985-10'}
    body = dict(operation_id='facts-search', expected_revision=0, facts=facts)
    assert client.post(path + '/annotations', json=body).status_code == 200
    for params in ({'query':'小明'}, {'query':'杭州','year':1985}, {'date_prefix':'1985-10'}):
        assert len(client.get('/photos/albums', params=params).json()['photos']) == 1
    assert client.get('/photos/albums',params={'view':'pending'}).json()['photos'] == []
    assert client.get('/photos/albums',params={'year':2026}).json()['photos'] == []
    changed = {**facts, 'people':[], 'location':'苏州'}
    assert client.post(path + '/annotations',json={**body,'facts':changed,'operation_id':'edit-facts','expected_revision':1}).status_code == 200
    assert client.get('/photos/albums',params={'query':'杭州'}).json()['photos'] == []


def test_multiple_keywords_match_across_latest_confirmed_sources(setup):
    client, store, _, path = setup
    facts = client.get(path + '/annotations').json()['facts']
    facts.update(location='海边', lighting='夕阳', capture_time='2025-10', notes='和女儿出游')
    assert client.post(path + '/annotations', json=dict(operation_id='search-facts', expected_revision=0, facts=facts)).status_code == 200
    store.save_story('owner', path.split('/')[-1], 'actor', text='退休纪念', expected_revision=0, operation_id='story-keywords')
    def search(query, **params):
        return client.get('/photos/albums', params=dict(query=query, **params)).json()['photos']
    results = search('女儿 海边 退休', year=2025)
    assert len(results) == 1
    assert {m['source'] for m in results[0]['search_matches']} == {'facts', 'story'}
    assert search('女儿 山里') == []
    assert search('女儿 海边', year=2024) == []
    assert search('capture_time') == []  # JSON field names are not photo content.
    assert search('女儿 海边', date_prefix='2025-10')
