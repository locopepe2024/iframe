import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PromptInput from './PromptInput';
import { usePlaygroundStore } from './usePlaygroundStore';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun' }));
vi.mock('./PromptTemplateModal', () => ({ default: () => null }));
vi.mock('./PromptHistoryDrawer', () => ({ default: () => null }));

const selected = ['/playground/media/selected/image', '/studio/media/library-image'];

function openMentions() {
    const editor = (screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    act(() => { editor.commands.setContent('<p>@</p>'); });
}

describe('selected reference mentions', () => {
    beforeEach(() => {
        usePlaygroundStore.setState({
            prompt: '', negativePrompt: '', mode: 'i2i', inputMedia: selected,
            mediaNames: { [selected[1]]: 'Library portrait' },
            history: [{
                ...usePlaygroundStore.getState().history[0],
                id: 'history', model_id: 'model', prompt: 'Historical portrait',
                outputs: [
                    { id: 'selected', media_path: selected[0], media_type: 'image' },
                    { id: 'unselected', media_path: '/playground/media/unselected/image', media_type: 'image' },
                ],
            }] as ReturnType<typeof usePlaygroundStore.getState>['history'],
        });
    });

    it('lists selected history and library images in reference order, excluding unselected history', () => {
        render(<PromptInput />);
        openMentions();
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options.map((option) => option.querySelector('img')?.getAttribute('src')))
            .toEqual(selected.map((path) => `https://garage.uniart.fun${path}`));
        fireEvent.click(options[1]);
        expect(usePlaygroundStore.getState().prompt).toBe('@Library portrait ');
        expect(screen.getByRole('textbox').querySelector('[data-reference-label]')).toHaveTextContent('@Libra...');
        expect(screen.getByRole('textbox').querySelector('[data-reference-label]')).toHaveAttribute('title', 'Library portrait');
        expect(usePlaygroundStore.getState().inputMedia).toEqual(selected);
        expect(usePlaygroundStore.getState().mode).toBe('i2i');
    });

    it('tracks reference removal and session draft replacement without requiring history', () => {
        render(<PromptInput />);
        openMentions();
        act(() => usePlaygroundStore.setState({ inputMedia: [selected[1]], history: [] }));
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(within(screen.getByRole('option')).getByText('Library portrait')).toBeInTheDocument();
        act(() => usePlaygroundStore.setState({ inputMedia: [], prompt: '' }));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        openMentions();
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('does not truncate the selected reference list to twelve items', () => {
        usePlaygroundStore.setState({ history: [], inputMedia: Array.from({ length: 13 }, (_, i) => `/playground/input-media/${i}.png`) });
        render(<PromptInput />);
        openMentions();
        expect(screen.getAllByRole('option')).toHaveLength(13);
    });
});
