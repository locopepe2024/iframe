'use client';
import { useEffect, useRef, type RefObject } from 'react';

/** A separate gain node preserves the renderer's 0–2 gain range. */
export function usePreviewGain(ref: RefObject<HTMLMediaElement>, gain: number, playing: boolean, identity: string, onError: () => void) {
    const graph = useRef<{ element: HTMLMediaElement; context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode }>();
    useEffect(() => () => {
        const current = graph.current;
        if (current) { current.element.pause(); current.source.disconnect(); current.gain.disconnect(); void current.context.close().catch(() => undefined); graph.current = undefined; }
    }, [identity]);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        if (!graph.current && playing && typeof AudioContext !== 'undefined') {
            try {
                const context = new AudioContext();
                const source = context.createMediaElementSource(element);
                const node = context.createGain();
                source.connect(node); node.connect(context.destination);
                graph.current = { element, context, source, gain: node };
            } catch { onError(); }
        }
        if (graph.current) {
            graph.current.gain.gain.value = gain;
            element.volume = 1;
            if (playing) void graph.current.context.resume().catch(onError);
        } else {
            element.volume = Math.min(1, gain);
            if (playing && gain > 1) onError();
        }
    }, [ref, gain, playing, identity]);
}

export default function TimelineAudioPreview({ url, position, start, end, sourceStart, sourceEnd, gain, playing, label, onError }: {
    url: string; position: number; start: number; end: number; sourceStart: number; sourceEnd: number;
    gain: number; playing: boolean; label: string; onError: () => void;
}) {
    const ref = useRef<HTMLAudioElement>(null);
    const active = position >= start && position < end;
    usePreviewGain(ref, gain, playing && active, url, onError);
    const sync = () => {
        const audio = ref.current;
        if (!audio) return;
        if (!active || !playing) audio.pause();
        if (!active) return;
        const rate = (sourceEnd - sourceStart) / Math.max(1, end - start);
        const time = (sourceStart + (position - start) * rate) / 1000;
        if (Math.abs(audio.currentTime - time) > 0.12) audio.currentTime = time;
        audio.playbackRate = Math.max(0.0625, Math.min(16, rate));
        if (playing && audio.paused) void audio.play().catch(onError);
    };
    useEffect(sync, [position, playing, start, end, sourceStart, sourceEnd, url]);
    useEffect(() => { const audio = ref.current; return () => { audio?.pause(); }; }, [url]);
    return <audio ref={ref} src={url} preload="metadata" onLoadedMetadata={sync} onError={onError} aria-label={label} />;
}
