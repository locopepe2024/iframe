import { describe, expect, it } from 'vitest';
import { searchReferenceCandidates } from '@/lib/referenceCandidateSearch';

describe('searchReferenceCandidates', () => {
  const candidates = [
    { label: '青溪镇长街', description: '冷灰蓝黄昏', sourceLabel: 'episode', variantLabel: '远景', reference: { asset_type: 'scene' as const, asset_id: 'street', variant_id: 'blue' } },
    { label: '青溪镇长街 · 暖光', description: '夕阳', sourceLabel: 'series', variantLabel: '近景', reference: { asset_type: 'scene' as const, asset_id: 'street', variant_id: 'warm' } },
  ];
  it('matches metadata while preserving exact variant identity', () => {
    expect(searchReferenceCandidates(candidates, '冷灰蓝').map((item) => item.reference?.variant_id)).toEqual(['blue']);
    expect(searchReferenceCandidates(candidates, '近景').map((item) => item.reference?.variant_id)).toEqual(['warm']);
  });
});
