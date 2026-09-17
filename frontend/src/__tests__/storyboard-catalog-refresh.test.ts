import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('keeps reference-capable UniArt models available after live catalog refresh', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
    const catalog = await import('../lib/modelCatalog');
    expect(catalog.VIDEO_R2V_MODELS.some(m => m.id === 'uniart/minimax-h3-vip')).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [
        { id: 'uniart/test-reference', capabilities: ['i2v', 'r2v'], display_name: 'Reference' },
        { id: 'uniart/test-image-only', capabilities: ['i2v'], display_name: 'First frame' },
    ] }) }));
    await catalog.refreshUniArtModelCatalog();
    expect(catalog.VIDEO_R2V_MODELS.some(m => m.id === 'uniart/test-reference')).toBe(true);
    expect(catalog.VIDEO_R2V_MODELS.some(m => m.id === 'uniart/test-image-only')).toBe(false);
});
