type Generation = {
    id?: string;
    session_id?: string;
    created_at?: string;
    prompt: string;
    outputs: { id?: string; media_path: string; media_type: string }[];
};

function compactTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function mediaReferenceLabel(sessionId: string | null | undefined, createdAt: string, mediaId: string): string {
    return `素材-${(sessionId || 'session').slice(0, 8)}-${compactTimestamp(createdAt)}-${mediaId}`;
}

export function referenceKey(path: string): string {
    const url = new URL(path, 'https://lumenx.invalid');
    // Only managed delivery signatures are transient; external URL queries may identify files.
    return /^\/(playground\/(input-media|media)|studio\/media)\//.test(url.pathname)
        ? url.pathname : path;
}

export function referenceName(path: string, names: Record<string, string>, history: Generation[]): string {
    const key = referenceKey(path);
    const generation = history.find((item) => item.outputs.some((output) => referenceKey(output.media_path) === key));
    const saved = names[key]?.trim();
    // Older drafts used the entire generation prompt as a reference label.
    // A prompt may contain @mentions and must never become a media label again.
    if (saved && !saved.includes('@') && (!generation || saved !== generation.prompt.trim().replace(/\s+/g, ' ').slice(0, 60))) return saved;
    if (generation) {
        const output = generation.outputs.find((item) => referenceKey(item.media_path) === key);
        return mediaReferenceLabel(generation.session_id, generation.created_at || '', output?.id || generation.id || key.split('/').pop() || 'media');
    }
    const pathname = new URL(path, 'https://lumenx.invalid').pathname;
    const filename = decodeURIComponent(pathname.split('/').pop() || '');
    if (/^[0-9a-f-]{36}\./i.test(filename)) return `素材-${filename.slice(0, 8)}`;
    if (/\.[a-z0-9]{2,5}$/i.test(filename) && !filename.includes('@')) return filename;
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff|aif|wma)$/i.test(pathname)) return 'Untitled audio';
    if (/\.(txt|md|csv|json|srt|vtt)$/i.test(pathname)) return 'Untitled text';
    return /\.(mp4|mov|webm|avi|mkv)$/i.test(pathname) ? 'Untitled video' : 'Untitled image';
}

export function shortReferenceLabel(value: string): string {
    const chars = Array.from(value);
    return chars.length > 5 ? chars.slice(0, 5).join('') + '...' : value;
}
