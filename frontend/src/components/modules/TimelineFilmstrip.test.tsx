import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TimelineFilmstrip from './TimelineFilmstrip';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('captures each interval start from the trimmed source and adds frames on zoom', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const createElement = document.createElement.bind(document);
    const captures: number[] = [];
    const requests: string[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName === 'video') {
            const video = element as HTMLVideoElement;
            let currentTime = 0;
            Object.defineProperties(video, {
                duration: { value: 10 },
                currentTime: {
                    get: () => currentTime,
                    set: (value: number) => { currentTime = value; queueMicrotask(() => video.dispatchEvent(new Event('seeked'))); },
                },
                src: { set: () => { requests.push(video.crossOrigin); queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); } },
            });
            video.load = vi.fn();
        }
        return element;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: (video: HTMLVideoElement) => captures.push(video.currentTime),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/webp;base64,frame${captures.length}`);

    const view = render(<TimelineFilmstrip url="https://media.example/clip.mp4" startMs={2000} endMs={5000} width={300} />);
    await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(3));
    expect(captures).toEqual([2, 3, 4]);
    expect(requests).toEqual(['anonymous']);

    captures.length = 0;
    view.rerender(<TimelineFilmstrip url="https://media.example/clip.mp4" startMs={2000} endMs={5000} width={600} />);
    await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(6));
    expect(captures).toEqual([2, 2.5, 3, 3.5, 4, 4.5]);
    expect(requests).toEqual(['anonymous', 'anonymous']);
});

it('uses the still image directly without creating a video decoder', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const createElement = vi.spyOn(document, 'createElement');
    const view = render(<TimelineFilmstrip url="/portrait.png" poster="/portrait.png" still startMs={0} endMs={5000} width={600} />);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/portrait.png');
    expect(createElement.mock.calls.some(([tagName]) => tagName === 'video')).toBe(false);
});
