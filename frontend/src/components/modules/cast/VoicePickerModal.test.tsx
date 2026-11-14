import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, type VoiceMeta } from '@/lib/api';
import VoicePickerModal from './VoicePickerModal';

vi.mock('next-intl', () => ({
    useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
vi.mock('@/lib/api', () => ({ api: { getVoices: vi.fn(), previewVoice: vi.fn() } }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (url: string) => url }));

const voice: VoiceMeta = {
    id: 'uniart:speech-2.8-hd:acceptance', name: 'Acceptance voice',
    family: 'minimax', model: 'speech-2.8-hd', gender: 'Male',
    supports_instruction: false, origin: 'system', lang_primary: 'en',
};

function show(onApply = vi.fn(), onParentCancel = vi.fn()) {
    function Harness() {
        const [open, setOpen] = useState(false);
        return <dialog open aria-label="Voiceover parent" onCancel={onParentCancel}>
            <textarea aria-label="Voiceover draft" defaultValue="Keep this draft" />
            <button type="button" onClick={() => setOpen(true)}>Choose voice</button>
            <input aria-label="Underlying voice name" />
            <VoicePickerModal isOpen={open} onClose={() => setOpen(false)}
                characterName="" onApply={onApply} />
        </dialog>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Choose voice' });
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getVoices).mockResolvedValue([voice]);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

it('moves focus into a native picker and returns it to the connected trigger on close', async () => {
    const trigger = show();
    const dialog = screen.getByRole('dialog', { name: 'title' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(trigger).not.toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'title' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Voiceover draft' })).toHaveValue('Keep this draft');
});

it('handles native cancellation without canceling its parent or losing the draft', () => {
    const parentCancel = vi.fn();
    const trigger = show(vi.fn(), parentCancel);
    const cancel = new Event('cancel', { cancelable: true, bubbles: true });
    fireEvent(screen.getByRole('dialog', { name: 'title' }), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(parentCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'title' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Voiceover parent' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Voiceover draft' })).toHaveValue('Keep this draft');
    expect(trigger).toHaveFocus();
});

it('keeps the native picker open when Escape or backdrop dismissal occurs during apply', async () => {
    let finish!: () => void;
    const onApply = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const trigger = show(onApply);
    fireEvent.click(await screen.findByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(onApply).toHaveBeenCalledWith(voice.id, voice.name);
    const dialog = screen.getByRole('dialog', { name: 'title' });
    const cancel = new Event('cancel', { cancelable: true, bubbles: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeDisabled();
    await act(async () => finish());
    expect(screen.queryByRole('dialog', { name: 'title' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(api.previewVoice).not.toHaveBeenCalled();
});

it('retains the selected voice after an apply failure and permits a successful retry', async () => {
    const onApply = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockResolvedValueOnce(undefined);
    show(onApply);
    fireEvent.click(await screen.findByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
    const apply = screen.getByRole('button', { name: 'apply' });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'title' })).not.toBeInTheDocument());
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(api.previewVoice).not.toHaveBeenCalled();
});
