import rawCatalog from '@/generated/modelCatalog.json';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_MODEL_SETTINGS,
    GLOBAL_I2I_MODELS,
    GLOBAL_I2V_MODELS,
    GLOBAL_IMAGE_MODELS,
    GLOBAL_T2I_MODELS,
    R2V_ROUTE_MODEL_ID,
    R2V_SELECTION_MODEL_ID,
    getCanonicalDefaults,
    getCanonicalModeEntry,
    getCanonicalModeId,
    getLegacyModelId,
    getMaxReferenceImages,
    getModelLineEntry,
    getModeGateway,
    resolveModelSettings,
} from '@/lib/modelCatalog';

type MockCatalog = Omit<typeof rawCatalog, 'model_lines' | 'modes' | 'compat'> & {
    model_lines?: Record<string, { id: string; family: string }>;
    modes?: Record<string, { id: string; model_line_id: string; mode: string }>;
    compat?: {
        legacy_model_ids?: Record<string, string>;
    };
};

afterEach(() => {
    vi.doUnmock('@/generated/modelCatalog.json');
    vi.resetModules();
});

describe('model catalog selectors', () => {
    it('derives visible model selectors from catalog defaults', () => {
        // Defaults are owned by the active UniArt catalog.
        // The unified `image_model` surface replaces the per-mode t2i/i2i
        // settings at the consumer layer.
        expect(DEFAULT_MODEL_SETTINGS).toMatchObject({
            t2i_model: 'uniart/gpt-image-2',
            i2i_model: 'uniart/gpt-image-2',
            i2v_model: 'uniart/seedance-2.5-vip',
            image_model: 'uniart/gpt-image-2',
        });

        // The 't2i' and 'i2i' selection_group surfaces moved to 'image'
        // in Phase 2. The resolver now falls through to visible image-group
        // models so user picks persist through
        // resolveModelId() instead of silently reverting to the default.
        expect(GLOBAL_T2I_MODELS.map((model) => model.id)).toEqual(GLOBAL_IMAGE_MODELS.map((m) => m.id));
        expect(GLOBAL_I2I_MODELS.map((model) => model.id)).toEqual(GLOBAL_IMAGE_MODELS.map((m) => m.id));

        // Ordered DESC by ui.order; ties broken by display_name asc.
        expect(GLOBAL_I2V_MODELS.map((model) => model.id)).toEqual([
            'uniart/seedance-2.5-special',
            'uniart/seedance-2.0-vip',
            'uniart/minimax-h3-vip',
            'uniart/seedance-2.5-vip',
        ]);
    });

    it('keeps hidden and planned catalog entries out of visible selectors', () => {
        expect(GLOBAL_I2V_MODELS.some((model) => model.id === 'wan2.6-r2v')).toBe(false);
        expect(GLOBAL_I2V_MODELS.some((model) => model.id === 'pixverse-v4-i2v')).toBe(false);
    });
});

describe('model catalog fallbacks', () => {
    it('falls back unknown and legacy-surface ids to catalog defaults', () => {
        expect(
            resolveModelSettings(
                {
                    t2i_model: 'missing-model',
                    i2i_model: 'wan2.6-r2v',
                    i2v_model: 'missing-video-model',
                },
                'global_settings'
            )
        ).toMatchObject({
            t2i_model: 'uniart/gpt-image-2',
            i2i_model: 'uniart/gpt-image-2',
            i2v_model: 'uniart/seedance-2.5-vip',
        });
    });

    it('normalizes canonical mode ids back to legacy compatibility ids when compat metadata exists', async () => {
        const catalogWithCompat = structuredClone(rawCatalog) as MockCatalog;
        catalogWithCompat.model_lines = {
            'wan/wan2.6-image': {
                id: 'wan/wan2.6-image',
                family: 'wan',
            },
            'wan/wan2.6-video': {
                id: 'wan/wan2.6-video',
                family: 'wan',
            },
        };
        catalogWithCompat.modes = {
            'wan/wan2.6-image#i2i': {
                id: 'wan/wan2.6-image#i2i',
                model_line_id: 'wan/wan2.6-image',
                mode: 'i2i',
            },
            'wan/wan2.6-video#i2v': {
                id: 'wan/wan2.6-video#i2v',
                model_line_id: 'wan/wan2.6-video',
                mode: 'i2v',
            },
            'wan/wan2.6-video#r2v': {
                id: 'wan/wan2.6-video#r2v',
                model_line_id: 'wan/wan2.6-video',
                mode: 'r2v',
            },
        };
        catalogWithCompat.compat = {
            legacy_model_ids: {
                'wan2.6-image': 'wan/wan2.6-image#i2i',
                'wan2.6-i2v': 'wan/wan2.6-video#i2v',
                'wan2.6-r2v': 'wan/wan2.6-video#r2v',
            },
        };

        vi.doMock('@/generated/modelCatalog.json', () => ({
            default: catalogWithCompat,
        }));

        const {
            GLOBAL_I2V_MODELS: compatI2vModels,
            R2V_ROUTE_MODEL_ID: compatR2vRouteModelId,
            R2V_SELECTION_MODEL_ID: compatR2vSelectionModelId,
            resolveModelSettings: resolveCompatModelSettings,
        } = await import('@/lib/modelCatalog');

        // After 524f3a1 deprecated the wan2.6 series, 'wan2.6-i2v' is hidden
        // (visible_in: []), so the canonical → legacy normalization is filtered
        // out by the visibility check and the resolver falls back to the current
        // i2v default (UniArt Seedance). The raw normalization contract is
        // covered directly by the Phase 2 canonical helpers below.
        expect(
            resolveCompatModelSettings(
                {
                    i2v_model: 'wan/wan2.6-video#i2v',
                },
                'global_settings'
            ).i2v_model
        ).toBe('uniart/seedance-2.5-vip');

        // An r2v canonical id normalizes to the matching legacy id
        // (wan2.6-r2v), which is hidden in the i2v surface — so the
        // resolver falls back to the current i2v default (UniArt Seedance). Previously this
        // assertion expected the resolver to remap r2v into the parent
        // i2v legacy id; that behavior was dropped when r2v ids gained
        // explicit modality suffixes.
        expect(
            resolveCompatModelSettings(
                {
                    i2v_model: 'wan/wan2.6-video#r2v',
                },
                'global_settings'
            ).i2v_model
        ).toBe('uniart/seedance-2.5-vip');

        expect(compatI2vModels.map((model) => model.id)).not.toContain('wan2.6-i2v');
        expect(compatI2vModels.some((model) => model.id === 'wan/wan2.6-video#i2v')).toBe(false);
        // R2V selection/route ids follow the catalog meta default
        // (defaults.model_settings.r2v_model = uniart/seedance-2.5-vip) via
        // getFallbackVisibleModelId, not raw ui.order. Several R2V models
        // anchoring to the explicit meta default keeps the default route
        // deterministic. Selection and route are unified
        // (R2V_ROUTE_MODEL_ID = R2V_SELECTION_MODEL_ID).
        expect(compatR2vSelectionModelId).toBe('uniart/seedance-2.5-vip');
        expect(compatR2vRouteModelId).toBe('uniart/seedance-2.5-vip');
    });
});

describe('model catalog runtime helpers', () => {
    it('derives the current R2V selection and route ids from catalog data', () => {
        // Selection and route both resolve to the catalog meta default R2V
        // model (defaults.model_settings.r2v_model = uniart/seedance-2.5-vip) via
        // getFallbackVisibleModelId — deterministic regardless of the order=80
        // tie among visible R2V models.
        expect(R2V_SELECTION_MODEL_ID).toBe('uniart/seedance-2.5-vip');
        expect(R2V_ROUTE_MODEL_ID).toBe('uniart/seedance-2.5-vip');
    });

    it('reads per-model reference image limits from catalog metadata', () => {
        // getMaxReferenceImages routes the input through resolveModelId
        // for the 'i2i' surface — when the literal id isn't visible in
        // that surface (post-Phase 2 the wan2.6 ids moved to the
        // 'image' selection_group), the resolver falls back to the
        // current default (UniArt GPT Image 2, which has no explicit input
        // limit in the catalog and therefore uses the helper fallback).
        // The behavior is correct given how callers (PropertiesPanel)
        // use the project's i2i_model setting.
        expect(getMaxReferenceImages('wan2.6-image')).toBe(3);
        expect(getMaxReferenceImages('wan2.5-i2i-preview')).toBe(3);
    });
});

describe('model catalog phase 2 canonical helpers', () => {
    it('resolves legacy flat id to canonical mode id', () => {
        expect(getCanonicalModeId('wan2.6-i2v')).toBe('wan/wan2.6-video#i2v');
        expect(getCanonicalModeId('wan2.6-r2v')).toBe('wan/wan2.6-video#r2v');
        expect(getCanonicalModeId('nonexistent')).toBeUndefined();
    });

    it('resolves canonical mode id back to legacy flat id', () => {
        expect(getLegacyModelId('wan/wan2.6-video#i2v')).toBe('wan2.6-i2v');
        expect(getLegacyModelId('wan/wan2.6-video#r2v')).toBe('wan2.6-r2v');
        expect(getLegacyModelId('nonexistent')).toBeUndefined();
    });

    it('reads canonical mode entry with full metadata', () => {
        const entry = getCanonicalModeEntry('wan/wan2.6-video#i2v');
        expect(entry).not.toBeNull();
        expect(entry?.model_line_id).toBe('wan/wan2.6-video');
        expect(entry?.legacy_model_id).toBe('wan2.6-i2v');
        expect(entry?.mode).toBe('i2v');
        expect(entry?.family).toBe('wan');

        expect(getCanonicalModeEntry('nonexistent')).toBeNull();
    });

    it('reads model line entry', () => {
        const line = getModelLineEntry('wan/wan2.6-video');
        expect(line).not.toBeNull();
        expect(line?.family).toBe('wan');
        expect(line?.modes).toContain('wan/wan2.6-video#i2v');
        expect(line?.modes).toContain('wan/wan2.6-video#r2v');
        expect(line?.legacy_model_ids).toContain('wan2.6-i2v');

        expect(getModelLineEntry('nonexistent')).toBeNull();
    });

    it('reads gateway metadata from canonical mode runtime', () => {
        expect(getModeGateway('wan/wan2.6-video#r2v')).toBe('dashscope');
        expect(getModeGateway('wan/wan2.6-video#r2v', 'vendor')).toBeUndefined();
        expect(getModeGateway('nonexistent')).toBeUndefined();
    });

    it('reads canonical default model settings', () => {
        const defaults = getCanonicalDefaults();
        expect(defaults.t2i_model).toContain('#');
        expect(defaults.i2i_model).toContain('#');
        expect(defaults.i2v_model).toContain('#');
    });

    it('does not leak canonical ids into visible flat model selectors', () => {
        for (const model of GLOBAL_I2V_MODELS) {
            expect(model.id).not.toContain('#');
        }
        for (const model of GLOBAL_T2I_MODELS) {
            expect(model.id).not.toContain('#');
        }
        for (const model of GLOBAL_I2I_MODELS) {
            expect(model.id).not.toContain('#');
        }
    });
});
