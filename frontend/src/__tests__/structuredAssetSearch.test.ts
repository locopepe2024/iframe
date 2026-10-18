import { describe, expect, it } from 'vitest';
import { searchStructuredAssets } from '@/lib/structuredAssetSearch';

const entries = [
  { asset_type: 'scene', asset_id: 'street', name: '青溪镇长街', description: '黄昏冷灰蓝长街', source_scope: 'episode', variants: [] },
  { asset_type: 'character', asset_id: 'hero', name: '苏砚', description: '雪痕客', source_scope: 'series', variants: [] },
  { asset_type: 'prop', asset_id: 'sword', name: '佩剑', description: '黑鞘长剑', source_scope: 'global', variants: [] },
] as any;

describe('searchStructuredAssets', () => {
  it('searches names and structured descriptions', () => {
    expect(searchStructuredAssets(entries, { query: '冷灰蓝' }).map((item) => item.asset_id)).toEqual(['street']);
  });

  it('filters by type and scope without changing durable entries', () => {
    const result = searchStructuredAssets(entries, { type: 'scene', scope: 'episode' });
    expect(result).toEqual([entries[0]]);
    expect(result[0]).toHaveProperty('asset_id', 'street');
  });
});
