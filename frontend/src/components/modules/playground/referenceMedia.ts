type Generation = {
    prompt: string;
    outputs: { media_path: string; media_type: string }[];
};

export function referenceKey(path: string): string {
    const url = new URL(path, 'https://lumenx.invalid');
    // Only managed delivery signatures are transient; external URL queries may identify files.
    return /^\/(playground\/(input-media|media)|studio\/media)\//.test(url.pathname)
        ? url.pathname : path;
}

export function referenceName(path: string, names: Record<string, string>, history: Generation[]): string {
    const key = referenceKey(path);
    if (names[key]) return names[key];
    const generation = history.find((item) => item.outputs.some((output) => referenceKey(output.media_path) === key));
    if (generation?.prompt.trim()) return generation.prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
    const pathname = new URL(path, 'https://lumenx.invalid').pathname;
    const filename = decodeURIComponent(pathname.split('/').pop() || '');
    if (/\.[a-z0-9]{2,5}$/i.test(filename) && !/^[0-9a-f-]{36}\./i.test(filename)) return filename;
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff|aif|wma)$/i.test(pathname)) return 'Untitled audio';
    if (/\.(txt|md|csv|json|srt|vtt)$/i.test(pathname)) return 'Untitled text';
    return /\.(mp4|mov|webm|avi|mkv)$/i.test(pathname) ? 'Untitled video' : 'Untitled image';
}

export function shortReferenceLabel(value: string): string {
    const chars = Array.from(value);
    return chars.length > 5 ? chars.slice(0, 5).join('') + '...' : value;
}
