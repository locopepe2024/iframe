import rawCatalog from '@/generated/modelCatalog.json';
import { useSyncExternalStore } from 'react';
import type { UniArtCatalogModelResponse } from '@/lib/api';
import type { PlaygroundMode } from './usePlaygroundStore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlaygroundModelOption {
  id: string;
  displayName: string;
  family: string;
  provider: string;
  description: string;
  recommended: boolean;
  badges: string[];
  capabilities: string[];
  duration:
    | { type: 'slider'; min: number; max: number; step: number; default: number }
    | { type: 'buttons'; options: number[]; default: number }
    | { type: 'fixed'; value: number }
    | null;
  params: {
    resolution?: { options: string[]; default: string };
    ratio?: { options: string[]; default: string };
    ratiosByResolution?: Record<string, string[]>;
    size?: { options: string[]; default: string };
    quality?: { options: string[]; default: string };
    seed?: boolean;
    negativePrompt?: boolean;
    promptExtend?: boolean;
    watermark?: boolean;
    audio?: boolean;
    sound?: boolean;
  };
  maxReferenceImages: number;
}

// ---------------------------------------------------------------------------
// Internal catalog typing
// ---------------------------------------------------------------------------

interface CatalogDuration {
  type: string;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  value?: number;
  options?: number[];
}

interface CatalogModel {
  id: string;
  display_name: string;
  description: string;
  family: string;
  provider: string;
  status: string;
  capabilities: string[];
  duration?: CatalogDuration | null;
  params?: Record<string, unknown>;
  inputs?: {
    reference_images?: { max?: number };
  };
  ui: {
    selection_group: string;
    visible_in: string[];
    recommended?: boolean;
    order?: number;
    badges?: string[];
  };
}

const catalog = rawCatalog as { models: Record<string, CatalogModel> };
const allModels = Object.entries(catalog.models);
let runtimeModels: Record<string, CatalogModel> = {};
let catalogRevision = 0;
const catalogListeners = new Set<() => void>();

export function installUniArtCatalog(models: UniArtCatalogModelResponse[]): number {
  runtimeModels = Object.fromEntries(models.map((model, index) => [model.id, {
    ...model,
    status: 'active',
    duration: model.duration as CatalogDuration | null | undefined,
    params: model.params,
    inputs: model.inputs,
    ui: {
      selection_group: model.capabilities.some((capability) => capability === 't2i' || capability === 'i2i') ? 'image' : 'i2v',
      visible_in: ['playground'],
      recommended: model.id === 'uniart/seedance-2.5-vip',
      order: models.length - index,
      badges: ['UniArt'],
    },
  } as CatalogModel]));
  catalogRevision += 1;
  catalogListeners.forEach((listener) => listener());
  return models.length;
}

export function usePlaygroundCatalogRevision(): number {
  return useSyncExternalStore(
    (listener) => {
      catalogListeners.add(listener);
      return () => catalogListeners.delete(listener);
    },
    () => catalogRevision,
    () => 0,
  );
}

function getActiveModelEntries(): [string, CatalogModel][] {
  const runtimeEntries = Object.entries(runtimeModels);
  if (runtimeEntries.length > 0) return runtimeEntries;
  return allModels.filter(([, model]) => model.provider === 'uniart');
}

function getActiveModel(modelId: string): CatalogModel | undefined {
  return runtimeModels[modelId] ?? catalog.models[modelId];
}

// ---------------------------------------------------------------------------
// Family priority maps (lower number = higher priority)
// ---------------------------------------------------------------------------

const VIDEO_MODES = new Set<string>(['t2v', 'i2v', 'r2v', 'f2v', 'v2v']);

const VIDEO_FAMILY_PRIORITY: Record<string, number> = {
  seedance: 1,
  minimax: 2,
  wan: 3,
};

const IMAGE_FAMILY_PRIORITY: Record<string, number> = {
  'gpt-image': 1,
  wan: 2,
  qwen: 3,
};

const FALLBACK_PRIORITY = 999;

function getFamilyPriority(family: string, mode: PlaygroundMode): number {
  const map = VIDEO_MODES.has(mode) ? VIDEO_FAMILY_PRIORITY : IMAGE_FAMILY_PRIORITY;
  return map[family] ?? FALLBACK_PRIORITY;
}

// ---------------------------------------------------------------------------
// Duration normalizer
// ---------------------------------------------------------------------------

function normalizeDuration(
  raw: CatalogDuration | null | undefined,
): PlaygroundModelOption['duration'] {
  if (!raw) return null;

  if (raw.type === 'slider') {
    return {
      type: 'slider',
      min: raw.min ?? 1,
      max: raw.max ?? 15,
      step: raw.step ?? 1,
      default: raw.default ?? 5,
    };
  }

  if (raw.type === 'buttons') {
    return {
      type: 'buttons',
      options: raw.options ?? [],
      default: raw.default ?? (raw.options?.[0] ?? 5),
    };
  }

  if (raw.type === 'fixed') {
    return {
      type: 'fixed',
      value: raw.value ?? 5,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Params normalizer
// ---------------------------------------------------------------------------

function normalizeParams(
  raw: Record<string, unknown> | undefined,
): PlaygroundModelOption['params'] {
  if (!raw) return {};

  const result: PlaygroundModelOption['params'] = {};

  // resolution
  const res = raw.resolution;
  if (res && typeof res === 'object' && 'options' in (res as object)) {
    const r = res as { options?: string[]; default?: string };
    if (r.options) {
      result.resolution = {
        options: r.options,
        default: r.default ?? r.options[0] ?? '',
      };
    }
  }

  // ratio — catalog uses both "ratio" and "aspectRatio"
  const ratio = raw.ratio ?? raw.aspectRatio;
  if (ratio && typeof ratio === 'object' && 'options' in (ratio as object)) {
    const r = ratio as { options?: string[]; default?: string };
    if (r.options) {
      result.ratio = {
        options: r.options,
        default: r.default ?? r.options[0] ?? '',
      };
    }
  }

  // size (image models use size instead of resolution)
  const size = raw.size;
  if (size && typeof size === 'object' && 'options' in (size as object)) {
    const s = size as { options?: string[]; default?: string };
    if (s.options) {
      result.size = {
        options: s.options,
        default: s.default ?? s.options[0] ?? '',
      };
    }
  }

  // quality (GPT-Image-2)
  const quality = raw.quality;
  if (quality && typeof quality === 'object' && 'options' in (quality as object)) {
    const q = quality as { options?: string[]; default?: string };
    if (q.options) {
      result.quality = {
        options: q.options,
        default: q.default ?? q.options[0] ?? '',
      };
    }
  }

  const ratiosByResolution = raw.ratiosByResolution;
  if (ratiosByResolution && typeof ratiosByResolution === 'object') {
    result.ratiosByResolution = Object.fromEntries(
      Object.entries(ratiosByResolution as Record<string, unknown>)
        .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
        .map(([key, values]) => [key, values.map(String)]),
    );
  }

  // boolean flags
  if (typeof raw.seed === 'boolean') result.seed = raw.seed;
  if (typeof raw.negativePrompt === 'boolean') result.negativePrompt = raw.negativePrompt;
  if (typeof raw.promptExtend === 'boolean') result.promptExtend = raw.promptExtend;
  if (typeof raw.watermark === 'boolean') result.watermark = raw.watermark;
  if (typeof raw.audio === 'boolean') result.audio = raw.audio;
  if (typeof raw.sound === 'boolean') result.sound = raw.sound;

  return result;
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

function toOption(model: CatalogModel): PlaygroundModelOption {
  return {
    id: model.id,
    displayName: model.display_name,
    family: model.family,
    provider: model.provider,
    description: model.description,
    recommended: model.ui.recommended ?? false,
    badges: model.ui.badges ?? [],
    capabilities: model.capabilities,
    duration: normalizeDuration(model.duration),
    params: normalizeParams(model.params),
    maxReferenceImages: model.inputs?.reference_images?.max ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all models whose capabilities include the given mode, sorted by
 * family priority, then recommended-first, then ui.order descending (newer
 * versions first), then alphabetically by display name.
 *
 * Filtering: exclude deprecated/planned models. Include hidden models that
 * have the required capability (they are hidden from Studio but available in
 * Playground — e.g. HappyHorse T2V, Wan 2.7 VideoEdit).
 */
export function getModelsForMode(mode: PlaygroundMode): PlaygroundModelOption[] {
  return getActiveModelEntries()
    .filter(([, model]) => {
      if (model.status === 'deprecated' || model.status === 'planned') return false;
      if (!model.capabilities.includes(mode)) return false;
      return true;
    })
    .sort(([, a], [, b]) => {
      // 1. Family priority
      const famA = getFamilyPriority(a.family, mode);
      const famB = getFamilyPriority(b.family, mode);
      if (famA !== famB) return famA - famB;

      // 2. Recommended first
      const recA = a.ui.recommended ? 0 : 1;
      const recB = b.ui.recommended ? 0 : 1;
      if (recA !== recB) return recA - recB;

      // 3. ui.order descending (higher order = newer version = comes first)
      const orderA = a.ui.order ?? 0;
      const orderB = b.ui.order ?? 0;
      if (orderA !== orderB) return orderB - orderA;

      // 4. Alphabetical fallback
      return a.display_name.localeCompare(b.display_name);
    })
    .map(([, model]) => toOption(model));
}

/**
 * Return the default (recommended or first) model ID for a mode.
 */
export function getDefaultModelForMode(mode: PlaygroundMode): string {
  const models = getModelsForMode(mode);
  const recommended = models.find((m) => m.recommended);
  return recommended?.id ?? models[0]?.id ?? '';
}

/**
 * Lightweight display-info lookup — works for any model ID, regardless of
 * mode or status.
 */
export function getModelDisplayInfo(
  modelId: string,
): { displayName: string; family: string } | null {
  const model = getActiveModel(modelId);
  if (!model) return null;
  return { displayName: model.display_name, family: model.family };
}

/**
 * Return the normalized params for a model, or null if the model is unknown.
 */
export function getModelParams(
  modelId: string,
): PlaygroundModelOption['params'] | null {
  const model = getActiveModel(modelId);
  if (!model) return null;
  return normalizeParams(model.params);
}

/**
 * Return the normalized duration config for a model (null when the model has
 * no duration knob, e.g. image models).
 */
export function getModelDuration(
  modelId: string,
): PlaygroundModelOption['duration'] {
  const model = getActiveModel(modelId);
  if (!model) return null;
  return normalizeDuration(model.duration);
}

/** Return the creation modes published by the model catalog for this SKU. */
export function getModelCapabilities(modelId: string): PlaygroundMode[] {
  const model = getActiveModel(modelId);
  if (!model) return [];
  return model.capabilities.filter((capability): capability is PlaygroundMode =>
    ['t2i', 'i2i', 't2v', 'i2v', 'r2v', 'f2v', 'v2v'].includes(capability),
  );
}

export type PlaygroundAudioControl = 'audio' | 'sound' | null;

/**
 * Return an audio toggle only when both catalog declaration and the current
 * Playground adapter path are known to consume the parameter.
 */
export function getModelAudioControl(modelId: string): PlaygroundAudioControl {
  const model = getActiveModel(modelId);
  if (!model) return null;
  if (model.provider === 'uniart' && model.params?.audio === true) return 'audio';
  if (model.provider === 'kling' && model.params?.sound === true) return 'sound';
  return null;
}

export function getModelRatioOptions(modelId: string, resolution?: string): string[] {
  const params = getModelParams(modelId);
  if (resolution && params?.ratiosByResolution?.[resolution]) {
    return params.ratiosByResolution[resolution];
  }
  return params?.ratio?.options ?? [];
}
