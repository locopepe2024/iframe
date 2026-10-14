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

it('removes stale UniArt SKUs from an older local snapshot', async () => {
    const storage = new Map<string, string>([
        ['lumenx_uniart_model_snapshot', JSON.stringify({ models: [
            { id: 'uniart/gpt-image-2.5-flare', capabilities: ['t2i', 'i2i'], display_name: 'Old Flare' },
        ] })],
    ]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
    const catalog = await import('../lib/modelCatalog');
    expect(catalog.IMAGE_MODELS.some(m => m.id === 'uniart/gpt-image-2.5-flare')).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [
        { id: 'uniart/gpt-image-2.5-flare-discount', capabilities: ['t2i', 'i2i'], display_name: 'Flare Discount' },
    ] }) }));
    await catalog.refreshUniArtModelCatalog();

    expect(catalog.IMAGE_MODELS.some(m => m.id === 'uniart/gpt-image-2.5-flare')).toBe(false);
    expect(catalog.IMAGE_MODELS.some(m => m.id === 'uniart/gpt-image-2.5-flare-discount')).toBe(true);
    expect(catalog.resolveAssetGenerationModel('uniart/gpt-image-2.5-flare-discount'))
        .toBe('uniart/gpt-image-2.5-flare-discount');
    expect(catalog.resolveModelId('t2i', 'uniart/gpt-image-2.5-flare', 'project_settings'))
        .toBe('uniart/gpt-image-2.5-flare-discount');
});

it('shows only the nsfw Wan models in storyboard video selectors when published', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
    const catalog = await import('../lib/modelCatalog');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [
        { id: 'nsfw/wan3.0', capabilities: ['t2v', 'i2v', 'r2v'], display_name: 'Wan 3.0' },
        { id: 'nsfw/wan3.0-Prime', capabilities: ['t2v', 'i2v', 'r2v'], display_name: 'Wan 3.0 Prime' },
        { id: 'uniart/seedance-2.5-vip', capabilities: ['i2v', 'r2v'], display_name: 'Seedance' },
    ] }) }));
    await catalog.refreshUniArtModelCatalog();
    const expected = ['nsfw/wan3.0', 'nsfw/wan3.0-Prime'];
    expect(catalog.VIDEO_I2V_MODELS.map(model => model.id).sort()).toEqual(expected);
    expect(catalog.VIDEO_R2V_MODELS.map(model => model.id).sort()).toEqual(expected);
    expect(catalog.isR2vImageBased('nsfw/wan3.0')).toBe(true);
});
