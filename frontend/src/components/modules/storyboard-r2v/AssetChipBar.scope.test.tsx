import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AssetChipBar from './AssetChipBar';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('offers only project and inherited series entries as shot references', () => {
    const onInsertAsset = vi.fn();
    const entry = (asset_id: string, source_scope: 'episode' | 'series' | 'global') => ({
        asset_id, source_scope, asset_type: 'character' as const, name: asset_id, variants: [],
    });
    render(<AssetChipBar characters={[]} scenes={[]} props={[]} onInsertAsset={onInsertAsset}
        assetIndex={[entry('Local actor', 'episode'), entry('Inherited actor', 'series'), entry('Global actor', 'global')]} />);
    expect(screen.queryByText('Global actor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Local actor'));
    fireEvent.click(screen.getByText('Inherited actor'));
    expect(onInsertAsset.mock.calls).toEqual([['character', 'Local actor'], ['character', 'Inherited actor']]);
});
