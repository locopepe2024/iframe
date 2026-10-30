import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TimelineWaveform from './TimelineWaveform';
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
afterEach(() => { vi.unstubAllGlobals(); });
it('allows a progressing body beyond 15 seconds but aborts when it stops progressing', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.useFakeTimers();
    const decodeAudioData = vi.fn().mockResolvedValue({ duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([1]) });
    vi.stubGlobal('AudioContext', class { decodeAudioData = decodeAudioData; close = vi.fn().mockResolvedValue(undefined); });
    let body!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        signal = options.signal!;
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                body = controller;
                signal.addEventListener('abort', () => controller.error(new Error('Aborted')));
            },
        })));
    }));
    try {
        const view = render(<TimelineWaveform url="/slow-progress.wav" startMs={0} endMs={1000} />);
        await act(async () => {});
        for (let i = 0; i < 3; i++) {
            await act(async () => { await vi.advanceTimersByTimeAsync(10000); body.enqueue(new Uint8Array([1])); });
        }
        expect(signal.aborted).toBe(false);
        await act(async () => { body.close(); });
        expect(view.container.querySelector('[data-waveform-state]')).toHaveAttribute('data-waveform-state', 'ready');
        expect(decodeAudioData).toHaveBeenCalledTimes(1);
        view.rerender(<TimelineWaveform url="/body-stalled.wav" startMs={0} endMs={1000} />);
        await act(async () => {});
        await act(async () => { body.enqueue(new Uint8Array([1])); });
        await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
        expect(signal.aborted).toBe(true);
        expect(view.container.querySelector('[data-waveform-state]')).toHaveAttribute('data-waveform-state', 'unavailable');
    } finally { vi.useRealTimers(); }
});
it('renders actual cropped peaks and reuses the envelope without decoding again', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const decodeAudioData = vi.fn().mockResolvedValue({ duration: 4, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1, 0.4, 0.7, 1]) });
    vi.stubGlobal('AudioContext', class { decodeAudioData = decodeAudioData; close = close; });
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<TimelineWaveform url="/real-wave.wav" startMs={1000} endMs={3000} />);
    await waitFor(() => expect(view.container.querySelector('[data-waveform-state]')).toHaveAttribute('data-waveform-state', 'ready'));
    expect(view.container.querySelectorAll('path')).toHaveLength(2);
    expect(view.container.querySelector('path')?.getAttribute('d')).toContain('0.400000');
    view.rerender(<TimelineWaveform url="/real-wave.wav" startMs={0} endMs={4000} />);
    expect(view.container.querySelectorAll('path')).toHaveLength(4);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
});
it('reports oversized media without decoding or showing a fake waveform', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { 'content-length': String(17 * 1024 * 1024) } }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<TimelineWaveform url="/too-large.wav" startMs={0} endMs={1000} />);
    await waitFor(() => expect(view.container.querySelector('[data-waveform-state]')).toHaveAttribute('data-waveform-state', 'unavailable'));
    expect(view.container.querySelector('svg')).toBeNull();
});

it('times out a stalled fetch and lets the next visible waveform proceed', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const realTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, delay?: number, ...args: unknown[]) => realTimeout(fn, delay === 15000 ? 10 : delay, ...args)) as typeof setTimeout);
    const fetcher = vi.fn().mockImplementation((url: string, options: RequestInit) => {
        if (url === '/stalled.wav') return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('Aborted'))));
        return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetcher);
    try {
        const view = render(<><TimelineWaveform url="/stalled.wav" startMs={0} endMs={1000} /><TimelineWaveform url="/next.wav" startMs={0} endMs={1000} /></>);
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(view.container.querySelectorAll('[data-waveform-state="unavailable"]')).toHaveLength(2));
        expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    } finally { timer.mockRestore(); }
});
