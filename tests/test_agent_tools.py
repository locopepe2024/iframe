from contextlib import contextmanager

from src.apps import agent_tools


def test_search_knowledge_binds_owner_and_limits_context(monkeypatch):
    observed = {}

    @contextmanager
    def transaction():
        yield object()

    def search(db, owner, query, limit):
        observed.update(owner=owner, query=query, limit=limit)
        return [{
            'unit_id': 'unit', 'revision_id': 'revision', 'source_id': 'source',
            'collection_id': 'collection', 'scope': 'owner', 'kind': 'text',
            'locator': 'page:1', 'title': 'Source', 'source_uri': 'upload:source',
            'rights_status': 'owned', 'has_media': False,
            'excerpt': 'x' * 2000, 'annotation': 'y' * 1000,
        }] * 7

    monkeypatch.setattr(agent_tools.store, 'transaction', transaction)
    monkeypatch.setattr(agent_tools.store, 'search', search)
    hits = agent_tools.search_knowledge('owner-a', 'printing')
    assert observed == {'owner': 'owner-a', 'query': 'printing', 'limit': 5}
    assert len(hits) == 5
    assert len(hits[0]['excerpt']) == 1200
    assert len(hits[0]['annotation']) == 500
