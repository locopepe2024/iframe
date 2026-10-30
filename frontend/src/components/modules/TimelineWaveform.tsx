'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

const cache = new Map<string, { peaks: number[]; duration: number }>();
let queue = Promise.resolve();
const LIMIT = 16 * 1024 * 1024;

export function waveformPeaks(channels: Float32Array[], count = 1200): number[] {
    const length = channels[0]?.length || 0;
    return Array.from({ length: Math.min(count, length) }, (_, i) => {
        let peak = 0;
        for (const channel of channels) {
            for (let j = Math.floor(i * length / Math.min(count, length)); j < Math.floor((i + 1) * length / Math.min(count, length)); j++) peak = Math.max(peak, Math.abs(channel[j]));
        }
        return peak;
    });
}

async function decode(url: string, signal: AbortSignal, onProgress?: () => void) {
    const cached = cache.get(url);
    if (cached) return cached;
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) throw new Error('Waveform unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Waveform unavailable');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > LIMIT) throw new Error('Waveform exceeds limit');
            chunks.push(value);
            if (value.byteLength) onProgress?.();
        }
    } finally { await reader.cancel(); }
    if (signal.aborted) throw new Error('Cancelled');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const context = new AudioContext({ sampleRate: 8000 });
    try {
        const audio = await context.decodeAudioData(bytes.buffer);
        if (audio.duration > 300 || signal.aborted) throw new Error('Waveform exceeds limit');
        const result = { peaks: waveformPeaks(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))), duration: audio.duration * 1000 };
        if (cache.size >= 8) cache.delete(cache.keys().next().value!);
        cache.set(url, result);
        return result;
    } finally { await context.close(); }
}

export default function TimelineWaveform({ url, startMs, endMs }: { url: string; startMs: number; endMs: number }) {
    const zh = useLocale().startsWith('zh');
    const host = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);
    const [data, setData] = useState<{ peaks: number[]; duration: number } | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!host.current) return;
        if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } });
        observer.observe(host.current); return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setData(null); setFailed(false);
        if (!visible) return;
        const controller = new AbortController();
        queue = queue.then(async () => {
            if (controller.signal.aborted) return;
            let timedOut = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const armTimeout = () => {
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(() => {
                    timedOut = true;
                    setFailed(true);
                    controller.abort();
                }, 15000);
            };
            // Bound inactivity, while allowing a large/slow response to finish
            // when bytes continue to arrive.
            armTimeout();
            try { const decoded = await decode(url, controller.signal, armTimeout); if (!controller.signal.aborted) setData(decoded); }
            catch { if (!controller.signal.aborted || timedOut) setFailed(true); }
            finally { clearTimeout(timeout); }
        });
        return () => controller.abort();
    }, [url, visible]);
    const first = data ? Math.max(0, Math.floor(startMs / data.duration * data.peaks.length)) : 0;
    const last = data ? Math.min(data.peaks.length, Math.ceil(endMs / data.duration * data.peaks.length)) : 0;
    const peaks = data?.peaks.slice(first, last) || [];
    return <span ref={host} className="pointer-events-none absolute inset-x-1 bottom-0 h-4" aria-hidden="true" data-waveform-state={failed ? 'unavailable' : data ? 'ready' : 'loading'}>
        {data ? <svg viewBox={`0 -1 ${Math.max(1, peaks.length)} 2`} preserveAspectRatio="none" className="h-full w-full text-primary" stroke="currentColor" strokeWidth="1">{peaks.map((value, i) => <path key={i} d={`M${i} ${-value}V${value}`} />)}</svg> : <span className="text-[10px] text-text-muted">{failed ? (zh ? '波形不可用' : 'Waveform unavailable') : (zh ? '波形加载中' : 'Loading waveform')}</span>}
    </span>;
}
