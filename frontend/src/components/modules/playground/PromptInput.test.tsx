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
        fireEvent.mouseOver(screen.getByRole('textbox').querySelector('[data-reference-label]')!);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Library portrait');
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

    it('restores compact tokens when reference names arrive after the prompt', () => {
        usePlaygroundStore.setState({ prompt: '@Library portrait ', mediaNames: {}, history: [] });
        render(<PromptInput />);
        act(() => usePlaygroundStore.setState({ mediaNames: { [selected[1]]: 'Library portrait' } }));
        const token = screen.getByRole('textbox').querySelector('[data-reference-label]');
        expect(token).toHaveTextContent('@Libra...');
        expect(token).toHaveStyle({ backgroundColor: 'rgba(52, 216, 196, 0.15)' });
        expect(usePlaygroundStore.getState().prompt).toBe('@Library portrait ');
    });

    it.each([
        ['@ed0bd598ly1gon8dd5fqzj21kw2dcu0z.jpg 和@Screenshot 2026-09-14 at 4.45.24\u202fPM.png 在跳舞', ['@ed0bd...', '@Scree...']],
        ['@Screenshot 2026-09-14 at 4.45.24\u202fPM.png 在跳舞', ['@Scree...']],
        ['@设计一个女孩和一只小狗在玩耍 @Untitled image 在一起玩耍', ['@设计一个女...', '@Untit...']],
    ])('renders restored reference names without requiring selected media: %s', (prompt, expected) => {
        usePlaygroundStore.setState({ prompt, inputMedia: [], mediaNames: {}, history: [] });
        render(<PromptInput />);
        const tokens = Array.from(screen.getByRole('textbox').querySelectorAll('[data-reference-label]'));
        expect(tokens.map((token) => token.textContent)).toEqual(expected);
        tokens.forEach((token) => expect(token).toHaveStyle({ backgroundColor: 'rgba(52, 216, 196, 0.15)' }));
        expect(usePlaygroundStore.getState().prompt).toBe(prompt);
        const editor = (screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        expect(editor.getText({ blockSeparator: '\n' })).toBe(prompt);
        expect(screen.getByRole('textbox')).toHaveTextContent(prompt.endsWith('在跳舞') ? '在跳舞' : '在一起玩耍');
    });

    it('leaves a filename editable while typing and compacts it on blur', () => {
        usePlaygroundStore.setState({ prompt: '', inputMedia: [], mediaNames: {}, history: [] });
        render(<PromptInput />);
        const textbox = screen.getByRole('textbox');
        const editor = (textbox as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        const prompt = '@Screenshot 2026-09-14 at 4.45.24\u202fPM.png 在跳舞';
        act(() => { editor.commands.insertContent(prompt); });
        expect(textbox.querySelector('[data-reference-label]')).toBeNull();
        act(() => { editor.emit('blur', { editor, event: new FocusEvent('blur'), transaction: editor.state.tr }); });
        expect(textbox.querySelector('[data-reference-label]')).toHaveTextContent('@Scree...');
        expect(editor.getText({ blockSeparator: '\n' })).toBe(prompt);
    });

    it('does not convert email addresses into references', () => {
        usePlaygroundStore.setState({ prompt: 'Contact hello@example.com for details', inputMedia: [], mediaNames: {}, history: [] });
        render(<PromptInput />);
        expect(screen.getByRole('textbox').querySelector('[data-reference-label]')).toBeNull();
    });

    it('restores and pastes long drafts without silently dropping or truncating text', () => {
        usePlaygroundStore.setState({ prompt: 'draft', inputMedia: [], mediaNames: {}, history: [] });
        render(<PromptInput />);
        const textbox = screen.getByRole('textbox');
        const editor = (textbox as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        const longPrompt = '镜头描述'.repeat(700);
        act(() => usePlaygroundStore.getState().setPrompt(longPrompt));
        expect(editor.getText({ blockSeparator: '\n' })).toBe(longPrompt);
        act(() => editor.commands.selectAll());
        fireEvent.paste(textbox, { clipboardData: { getData: () => longPrompt + '\n最后一镜' } });
        expect(usePlaygroundStore.getState().prompt).toBe(longPrompt + '\n最后一镜');
    });

    it('copies full reference names and preserves them through rich clipboard parsing', () => {
        usePlaygroundStore.setState({ prompt: '使用 @Library portrait 跳舞' });
        render(<PromptInput />);
        const editor = (screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        act(() => editor.commands.selectAll());
        const clipboard = editor.view.serializeForClipboard(editor.state.selection.content());
        expect(clipboard.text).toBe('使用 @Library portrait 跳舞');
        act(() => editor.commands.setContent(clipboard.dom.innerHTML));
        expect(editor.getText({ blockSeparator: '\n' })).toBe('使用 @Library portrait 跳舞');
    });

    it('does not truncate the selected reference list to twelve items', () => {
        usePlaygroundStore.setState({ history: [], inputMedia: Array.from({ length: 13 }, (_, i) => `/playground/input-media/${i}.png`) });
        render(<PromptInput />);
        openMentions();
        expect(screen.getAllByRole('option')).toHaveLength(13);
    });

    it('opens mentions at the cursor and preserves the rest of the prompt when choosing', () => {
        usePlaygroundStore.setState({ prompt: '让 在跳舞' });
        render(<PromptInput />);
        const editor = (screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        act(() => { editor.commands.setTextSelection(3); editor.commands.insertContent('@'); });
        expect(screen.getAllByRole('option')).toHaveLength(2);
        const option = screen.getAllByRole('option')[1];
        fireEvent.mouseDown(option);
        fireEvent.click(option);
        expect(usePlaygroundStore.getState().prompt).toBe('让 @Library portrait 在跳舞');
        expect(screen.getByRole('textbox').querySelector('[data-reference-label]')).toHaveTextContent('@Libra...');
    });

    it('offers adding materials instead of silently hiding an empty index', () => {
        usePlaygroundStore.setState({ inputMedia: [], history: [] });
        const open = vi.fn();
        render(<PromptInput onOpenReferences={open} />);
        openMentions();
        expect(screen.getByRole('listbox')).toHaveTextContent('请先添加参考素材');
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('button', { name: '添加参考素材' }));
        expect(open).toHaveBeenCalledOnce();
    });

    it('filters names including spaces and dismisses the index with Escape', () => {
        render(<PromptInput />);
        const editor = (screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
        act(() => { editor.commands.insertContent('@Library p'); });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('Library portrait');
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
