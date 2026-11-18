import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ReferenceMaterialPicker from './ReferenceMaterialPicker';

const capacity = vi.hoisted(() => ({ value: 10 }));
vi.mock('@/lib/modelCatalog', () => ({ getMaxReferenceImages: () => capacity.value }));
vi.mock('@/store/projectStore', () => ({ useProjectStore: (select: any) => select({ currentProject: null, currentSeries: null }) }));
vi.mock('./ReferenceMaterialBrowser', () => ({ default: () => null, materialKey: (reference: any) => reference.variant_id }));
afterEach(cleanup);

it('allows the tenth reference and follows capacity changes from the selected adapter', () => {
    const selected = Array.from({ length: 10 }, (_, index) => ({ asset_type: 'character' as const, asset_id: 'hero', variant_id: `image-${index}` }));
    const candidates = selected.map(reference => ({ label: reference.variant_id, path: 'image.png', reference }));
    const props = { candidates, onChange: vi.fn(), modelName: 'nsfw/seedream_5.0Pro_nsfw' };
    const view = render(<ReferenceMaterialPicker {...props} selected={selected.slice(0, 9)} />);
    expect(screen.getByRole('button', { name: '选择参考素材 · 9/10' })).not.toBeDisabled();
    view.rerender(<ReferenceMaterialPicker {...props} selected={selected} />);
    expect(screen.getByRole('button', { name: '选择参考素材 · 10/10' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移除参考图 image-9' })).not.toBeDisabled();
    capacity.value = 6;
    view.rerender(<ReferenceMaterialPicker {...props} selected={selected.slice(0, 6)} />);
    expect(screen.getByRole('button', { name: '选择参考素材 · 6/6' })).toBeDisabled();
});
