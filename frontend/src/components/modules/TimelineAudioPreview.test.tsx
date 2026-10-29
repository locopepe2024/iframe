import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TimelineAudioPreview from './TimelineAudioPreview';
import { waveformPeaks } from './TimelineWaveform';
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('maps source trims, pauses outside the clip, reports play errors and releases playback', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const onError = vi.fn();
    const props = { url: '/a.wav', position: 1500, start: 1000, end: 3000, sourceStart: 4000, sourceEnd: 6000, gain: 0.4, playing: true, label: 'Mix', onError };
    const view = render(<TimelineAudioPreview {...props} />);
    const audio = screen.getByLabelText('Mix') as HTMLAudioElement;
    expect(audio.currentTime).toBe(4.5);
    expect(audio.volume).toBe(0.4);
    expect(play).toHaveBeenCalled();
    view.rerender(<TimelineAudioPreview {...props} playing={false} position={2000} />);
    expect(audio.currentTime).toBe(5);
    expect(pause).toHaveBeenCalled();
    play.mockClear();
    view.rerender(<TimelineAudioPreview {...props} position={3000} />);
    expect(play).not.toHaveBeenCalled();
    play.mockRejectedValue(new Error('Blocked'));
    view.rerender(<TimelineAudioPreview {...props} position={1600} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    fireEvent.error(audio);
    const calls = pause.mock.calls.length;
    view.unmount();
    expect(pause.mock.calls.length).toBeGreaterThan(calls);
});

it('applies gain above unity via Web Audio and closes the graph on unmount', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext', class { destination = {}; createMediaElementSource() { return source; } createGain() { return gain; } resume = resume; close = close; });
    const view = render(<TimelineAudioPreview url="a.wav" position={100} start={0} end={1000} sourceStart={0} sourceEnd={1000} gain={1.8} playing label="Gain" onError={vi.fn()} />);
    expect(gain.gain.value).toBe(1.8);
    expect(resume).toHaveBeenCalled();
    view.unmount();
    expect(close).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalled();
});

it('builds peaks from actual samples across channels, including silence', () => {
    expect(waveformPeaks([new Float32Array([0, -0.8, 0.2, 0]), new Float32Array([0, 0, 0, 0.9])], 2)).toEqual([expect.closeTo(0.8), expect.closeTo(0.9)]);
    expect(waveformPeaks([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(waveformPeaks([])).toEqual([]);
});
