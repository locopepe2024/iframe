import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api';
import H3FrameInput from './H3FrameInput';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: { uploadFile: vi.fn() } }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: (props: any) => <img {...props} /> }));
beforeEach(() => { vi.mocked(api.uploadFile).mockReset(); });

it('switches to first-last-frame mode while preserving the selected tail', () => {
    const change = vi.fn();
    render(<H3FrameInput mode="i2v" lastFrameUrl="tail.webp" candidates={[]} onChange={change} />);
    expect(screen.queryByLabelText('lastFrame')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'firstLastFrameMode' }));
    expect(change).toHaveBeenCalledWith('f2v', 'tail.webp');
});

it('selects and clears a tail independently of the first frame', () => {
    const change = vi.fn();
    render(<H3FrameInput mode="f2v" candidates={['first.webp', 'tail.webp']} onChange={change} />);
    fireEvent.change(screen.getByLabelText('lastFrame'), { target: { value: 'tail.webp' } });
    expect(change).toHaveBeenCalledWith('f2v', 'tail.webp');
    fireEvent.change(screen.getByLabelText('lastFrame'), { target: { value: '' } });
    expect(change).toHaveBeenCalledWith('f2v', undefined);
});

it('uploads a tail and keeps it when switching back to first-frame mode during upload', async () => {
    const change = vi.fn();
    let finish!: (value: { url: string }) => void;
    vi.mocked(api.uploadFile).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<H3FrameInput mode="f2v" candidates={[]} onChange={change} />);
    const file = new File(['image'], 'tail.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('uploadLastFrame'), { target: { files: [file] } });
    expect(api.uploadFile).toHaveBeenCalledWith(file);
    view.rerender(<H3FrameInput mode="i2v" candidates={[]} onChange={change} />);
    finish({ url: 'uploaded.webp' });
    await waitFor(() => expect(change).toHaveBeenCalledWith('i2v', 'uploaded.webp'));
});

it('reports invalid files and upload errors without replacing a tail', async () => {
    const change = vi.fn();
    render(<H3FrameInput mode="f2v" lastFrameUrl="keep.webp" candidates={[]} onChange={change} />);
    fireEvent.change(screen.getByLabelText('uploadLastFrame'), { target: { files: [new File(['video'], 'a.mp4', { type: 'video/mp4' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('frameUploadInvalid');
    expect(api.uploadFile).not.toHaveBeenCalled();
    vi.mocked(api.uploadFile).mockRejectedValue(new Error('offline'));
    await act(async () => {
        fireEvent.change(screen.getByLabelText('uploadLastFrame'), { target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('frameUploadFailed');
    expect(change).not.toHaveBeenCalled();
});
