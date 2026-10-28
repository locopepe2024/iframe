'use client';
import { useEffect, useRef, useState } from 'react';

/** Decode bounded, evenly spaced source frames only when the clip is visible. */
export default function TimelineFilmstrip({ url, poster, startMs, endMs, width }: {
    url: string; poster?: string; startMs: number; endMs: number; width: number;
}) {
    const host = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [frames, setFrames] = useState<string[]>([]);
    const count = Math.max(1, Math.min(8, Math.ceil(width / 100)));
    useEffect(() => {
        const element = host.current;
        if (!element) return;
        if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: '100px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setFrames([]);
        if (!visible) return;
        const video = document.createElement('video');
        video.muted = true; video.preload = 'auto'; video.playsInline = true;
        let cancelled = false;
        let abortWait: (() => void) | undefined;
        const wait = (event: string) => new Promise<void>((resolve, reject) => {
            const clear = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); abortWait = undefined; };
            const done = () => { clear(); resolve(); };
            const fail = () => { clear(); reject(new Error('Frame unavailable')); };
            const timer = setTimeout(fail, 15000);
            abortWait = fail;
            video.addEventListener(event, done, { once: true }); video.addEventListener('error', fail, { once: true });
        });
        const decode = async () => {
            const ready = wait('loadeddata'); video.src = url; await ready;
            const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
            const context = canvas.getContext('2d');
            if (!context) return;
            const decoded: string[] = [];
            for (let i = 0; i < count && !cancelled; i += 1) {
                const time = Math.max(0, Math.min(video.duration - 0.01, (startMs + (endMs - startMs) * (i + 0.5) / count) / 1000));
                if (Math.abs(video.currentTime - time) > 0.001) { const seeked = wait('seeked'); video.currentTime = time; await seeked; }
                if (cancelled) return;
                context.drawImage(video, 0, 0, 160, 90);
                decoded.push(canvas.toDataURL('image/webp', 0.65));
            }
            if (!cancelled) setFrames(decoded);
        };
        void decode().catch(() => { /* The existing poster remains visible if decoding is unavailable. */ });
        return () => { cancelled = true; abortWait?.(); video.removeAttribute('src'); video.load(); };
    }, [url, startMs, endMs, count, visible]);
    return <div ref={host} className="pointer-events-none flex h-14 w-full overflow-hidden" aria-hidden="true">
        {frames.length ? frames.map((src, index) => <img key={index} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />) : poster ? <img src={poster} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : <span className="h-full w-full animate-pulse bg-foreground/10" />}
    </div>;
}
