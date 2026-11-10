import json
from types import SimpleNamespace

import pytest

from src.apps.comic_gen import outline_analysis as analysis


def response(value):
    return json.dumps(value, ensure_ascii=False)


def test_source_blocks_keep_all_text_and_bound_each_request():
    text = '世界观：' + '梦境。' * 2400 + '\n第1集 起点\n台词：“别走。”\n第2集 破局\n她交出项链。'
    blocks = analysis.source_blocks(text)
    assert ''.join(item['text'] for item in blocks) == text
    batches = analysis.source_batches(blocks)
    assert len(batches) > 1
    assert all(sum(len(item['text']) for item in batch) <= analysis.SOURCE_BATCH_CHARS for batch in batches)
    assert [item for batch in batches for item in batch] == blocks
    assert len({item['id'] for item in blocks}) == len(blocks)


def test_long_outline_is_grounded_batched_and_resumable(tmp_path):
    text = '共6集。\n世界观：月读牢笼。\n' + '\n'.join(f'第{n}集 标题{n}\n第{n}集的原文对白：“信物{n}。”\n' + '剧情细节。' * 120 for n in range(1, 7))
    seen = []
    fail = [True]
    def chat(**kw):
        user = json.loads(kw['messages'][1]['content'])
        seen.append((user['stage'], user))
        assert kw['stream'] is True and kw['timeout_seconds'] == 900
        assert kw['model'] == 'greena/llm-nf-all'
        if user['stage'] == 'map_source':
            blocks = user['source_blocks']
            episodes = []
            for block in blocks:
                import re
                numbers = [int(n) for n in re.findall(r'第(\d+)集', block['text'])]
                episodes += [{'number': n, 'source_refs': [block['id']]} for n in set(numbers)]
            assigned = {ref for e in episodes for ref in e['source_refs']}
            global_refs = [b['id'] for b in blocks if b['id'] not in assigned and ('世界观' in b['text'] or '共6集' in b['text'])]
            return response({'settings': {'background': global_refs}, 'episodes': episodes,
                'ignored_refs': [b['id'] for b in blocks if b['id'] not in assigned | set(global_refs)]})
        numbers = user['episode_numbers']
        assert len(numbers) <= 2
        assert '完整总纲' not in kw['messages'][1]['content']
        if numbers == [3, 4] and fail[0]:
            fail[0] = False
            raise RuntimeError('upstream stream error')
        return response({'episodes': [{'number': n, 'title': f'标题{n}', 'outline': f'事件{n}'} for n in numbers]})
    llm = SimpleNamespace(chat=chat)
    with pytest.raises(RuntimeError, match='第 3.*4.*已保存'):
        analysis.analyze_chunked_outline(llm, text, model='greena/llm-nf-all', cache_dir=tmp_path)
    prior_maps = len([s for s, _ in seen if s == 'map_source'])
    prior_first = len([s for s, u in seen if s == 'compile_episodes' and u['episode_numbers'] == [1, 2]])
    result = analysis.analyze_chunked_outline(llm, text, model='greena/llm-nf-all', cache_dir=tmp_path)
    assert len([s for s, _ in seen if s == 'map_source']) == prior_maps
    assert len([s for s, u in seen if s == 'compile_episodes' and u['episode_numbers'] == [1, 2]]) == prior_first
    assert [e['number'] for e in result['draft']['episodes']] == list(range(1, 7))
    for n, ep in enumerate(result['draft']['episodes'], 1):
        assert f'信物{n}' in ep['source_excerpt']
        assert all(f'信物{other}' not in ep['source_excerpt'] for other in range(1, 7) if other != n)
    assert '月读牢笼' in result['draft']['background']


def test_map_rejects_unknown_and_missing_source_references():
    blocks = [{'id': 'p0001', 'text': '第1集 原文'}]
    with pytest.raises(RuntimeError, match='原文引用'):
        analysis.validate_source_map({'settings': {}, 'episodes': [{'number': 1, 'source_refs': ['invented']}]}, blocks)
    with pytest.raises(RuntimeError, match='未归属'):
        analysis.validate_source_map({'settings': {}, 'episodes': []}, blocks)


def test_episode_batch_cannot_omit_add_or_renumber_episodes():
    for numbers in ([1], [1, 3], [1, 2, 3], [2, 1]):
        with pytest.raises(RuntimeError, match='分集编号'):
            analysis.validate_episode_batch({'episodes': [{'number': n, 'title': f't{n}', 'outline': '事件'} for n in numbers]}, [1, 2])


def test_declared_missing_episode_stops_before_compilation():
    def chat(**kw):
        user = json.loads(kw['messages'][1]['content'])
        assert user['stage'] == 'map_source'
        return response({'settings': {'background': [b['id'] for b in user['source_blocks']]}, 'episodes': [], 'ignored_refs': []})
    with pytest.raises(RuntimeError, match='6 集.*归属'):
        analysis.analyze_chunked_outline(SimpleNamespace(chat=chat), '共6集。\n' + '世界观。' * 1200)


def test_source_with_missing_last_episode_cannot_silently_shrink_the_series():
    def chat(**kw):
        user = json.loads(kw['messages'][1]['content'])
        ids = [b['id'] for b in user['source_blocks']]
        return response({'settings': {'background': ids}, 'episodes': [{'number': 1, 'source_refs': ids}]})
    with pytest.raises(RuntimeError, match='2 集.*归属'):
        analysis.analyze_chunked_outline(SimpleNamespace(chat=chat), '第1集 起点\n第2集 结尾')


def test_cache_changes_with_model_source_and_owner_directory(tmp_path):
    cache = analysis.Checkpoints(tmp_path / 'owner-a', '总纲', 'greena/llm-nf-all')
    cache.put('map-0001', {'done': True})
    assert cache.get('map-0001') == {'done': True}
    for directory, text, model in [
        (tmp_path / 'owner-b', '总纲', 'greena/llm-nf-all'),
        (tmp_path / 'owner-a', '修改总纲', 'greena/llm-nf-all'),
        (tmp_path / 'owner-a', '总纲', 'greena/deepseek-v4.1-flash'),
    ]:
        assert analysis.Checkpoints(directory, text, model).get('map-0001') is None


def test_large_single_episode_uses_small_summary_requests_and_keeps_literal_material():
    text = '共1集。\n第1集 唯一标题\n' + '独有对白：“别丢掉这个信物。”\n' * 220
    calls = []
    def chat(**kw):
        user = json.loads(kw['messages'][1]['content']);calls.append(user)
        if user['stage'] == 'map_source':
            return response({'episodes': [{'number': 1, 'source_refs': [b['id'] for b in user['source_blocks']]}]})
        if user['stage'] == 'compact_context':
            assert sum(len(b['text']) for b in user['source_blocks']) <= analysis.SOURCE_BATCH_CHARS
            return response({'text': '独有对白：“别丢掉这个信物。”'})
        assert sum(len(e['text']) for e in user['episode_sources']) <= analysis.EPISODE_BATCH_CHARS
        return response({'episodes': [{'number': 1, 'title': '唯一标题', 'outline': '交接信物。'}]})
    result = analysis.analyze_chunked_outline(SimpleNamespace(chat=chat), text)
    assert result['draft']['episodes'][0]['source_excerpt'] == text
    assert any(c['stage'] == 'compact_context' for c in calls)


def test_outline_entry_uses_chunking_for_dense_episode_directories(monkeypatch, tmp_path):
    from src.apps.comic_gen.script_authoring import analyze_outline
    seen = []
    monkeypatch.setattr(analysis, 'analyze_chunked_outline', lambda llm, text, **kw: seen.append(kw) or {'draft': {}, 'source_hash': 'hash'})
    text = '\n'.join(f'第{n}集 标题{n}' for n in range(1, 7))
    assert analyze_outline(SimpleNamespace(), text, model='greena/deepseek-v4.1-flash', cache_dir=tmp_path)['source_hash'] == 'hash'
    assert seen == [{'model': 'greena/deepseek-v4.1-flash', 'cache_dir': tmp_path}]


def test_character_range_heading_stays_with_its_name():
    text = '纲手（第1—2集）｜赌局牢笼\n第1集 调教\n第2集 破局\n'
    blocks = analysis.source_blocks(text)
    assert blocks[0]['text'] == '纲手（第1—2集）｜赌局牢笼\n'
    assert ''.join(b['text'] for b in blocks) == text
