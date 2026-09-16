'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getModelAudioControl, getModelDuration, getModelParams, getModelRatioOptions, getVideoResolution, usePlaygroundCatalogRevision } from './playgroundModels';
import { usePlaygroundStore } from './usePlaygroundStore';

export type ComposerControl = 'resolution' | 'ratio' | 'quality' | 'seed' | 'audio' | 'batch';

const IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const IMAGE_QUALITIES = ['low', 'medium', 'high'];

function imageControlOptions(modelId: string) {
  const params = getModelParams(modelId);
  const tierSize = params?.size?.options.some((size) => /^[124]k$/i.test(size));
  return {
    ratios: tierSize && modelId.startsWith('uniart/') ? IMAGE_RATIOS : [],
    qualities: params?.quality?.options ?? (modelId.startsWith('uniart/gpt-image') ? IMAGE_QUALITIES : []),
  };
}

function ratioFromSize(size: string): string | null {
  const match = size.match(/^(\d+)[x*×](\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return divisor ? `${width / divisor}:${height / divisor}` : null;
}

function ChoiceGrid({
  options,
  value,
  onChange,
  format = (option) => option,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  format?: (value: string) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={selected}
            className={[
              'flex min-h-11 items-center justify-between rounded-xl border px-3 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              selected
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border-subtle bg-surface-inset text-foreground hover:bg-hover-bg',
            ].join(' ')}
          >
            <span>{format(option)}</span>
            {selected && <Check size={14} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function DurationControl() {
  const t = useTranslations('playground');
  const modelId = usePlaygroundStore((state) => state.modelId);
  const parameters = usePlaygroundStore((state) => state.parameters);
  const setParameters = usePlaygroundStore((state) => state.setParameters);
  const duration = getModelDuration(modelId);
  if (!duration) return null;

  const value = typeof parameters.duration === 'number'
    ? parameters.duration
    : duration.type === 'fixed' ? duration.value : duration.default;
  const setValue = (next: number) => setParameters({ ...parameters, duration: next });

  return (
    <div className="space-y-2">
      <div className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
        {t('parameters.duration')}
      </div>
      {duration.type === 'fixed' ? (
        <div className="flex min-h-11 items-center rounded-xl border border-border-subtle bg-surface-inset px-3 text-xs text-text-secondary">
          {duration.value}s {t('parameters.durationFixedSuffix')}
        </div>
      ) : duration.type === 'buttons' ? (
        <ChoiceGrid
          options={duration.options.map(String)}
          value={String(value)}
          onChange={(next) => setValue(Number(next))}
          format={(next) => `${next}s`}
        />
      ) : (
        <div className="space-y-2">
          <input
            type="range"
            min={duration.min}
            max={duration.max}
            step={duration.step}
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
            aria-label={t('parameters.duration')}
            className="w-full accent-primary"
          />
          <div className="flex justify-between font-mono text-[0.6875rem] text-text-muted">
            <span>{duration.min}s</span><span className="text-foreground">{value}s</span><span>{duration.max}s</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function getComposerControlState(modelId: string, parameters: Record<string, any>, batchSize: number) {
  const params = getModelParams(modelId);
  const duration = getModelDuration(modelId);
  const size = (parameters.size as string | undefined) ?? params?.size?.default;
  const resolution = params?.resolution
    ? getVideoResolution(modelId, parameters)
    : params?.size ? (params.size.options.includes(parameters.size) ? parameters.size : params.size.default) : undefined;
  const imageOptions = imageControlOptions(modelId);
  const ratio = (parameters.aspect_ratio as string | undefined) ?? params?.ratio?.default ?? (size ? ratioFromSize(size) : null) ?? imageOptions.ratios[0];
  const durationValue = duration
    ? (typeof parameters.duration === 'number' ? parameters.duration : duration.type === 'fixed' ? duration.value : duration.default)
    : null;
  const audioControl = getModelAudioControl(modelId);
  const audioValue = audioControl === 'sound' ? parameters.sound === 'on' : parameters.audio === true;

  return {
    resolution,
    ratio,
    quality: imageOptions.qualities.length ? parameters.quality ?? params?.quality?.default ?? 'high' : null,
    duration: durationValue,
    seed: parameters.seed,
    audioControl,
    audioValue,
    batchSize,
    supportsSeed: params?.seed === true,
  };
}

export default function ComposerControls({ control }: { control: ComposerControl }) {
  const t = useTranslations('playground');
  const modelId = usePlaygroundStore((state) => state.modelId);
  const parameters = usePlaygroundStore((state) => state.parameters);
  const batchSize = usePlaygroundStore((state) => state.batchSize);
  const setParameters = usePlaygroundStore((state) => state.setParameters);
  const setBatchSize = usePlaygroundStore((state) => state.setBatchSize);
  usePlaygroundCatalogRevision();
  const params = getModelParams(modelId);
  const audioControl = getModelAudioControl(modelId);
  const update = (key: string, value: unknown) => setParameters({ ...parameters, [key]: value });

  if (control === 'quality') {
    return <ChoiceGrid options={imageControlOptions(modelId).qualities}
      value={parameters.quality ?? params?.quality?.default ?? 'high'} onChange={(next) => update('quality', next)} />;
  }

  if (control === 'resolution') {
    const options = params?.resolution?.options ?? params?.size?.options ?? [];
    const key = params?.resolution ? 'resolution' : 'size';
    const fallback = params?.resolution?.default ?? params?.size?.default ?? '';
    const value = params?.resolution ? getVideoResolution(modelId, parameters) ?? fallback : (parameters[key] as string | undefined) ?? fallback;
    return (
      <div className="space-y-4">
        {options.length > 0 && (
          <ChoiceGrid
            options={options}
            value={value}
            onChange={(next) => update(key, next)}
            format={(next) => next.replace(/[*x]/g, '×')}
          />
        )}
        <DurationControl />
      </div>
    );
  }

  if (control === 'ratio') {
    const sizeOptions = params?.size?.options ?? [];
    const resolution = (parameters.resolution as string | undefined) ?? params?.resolution?.default;
    const catalogRatios = getModelRatioOptions(modelId, resolution);
    const directOptions = catalogRatios.length ? catalogRatios : imageControlOptions(modelId).ratios;
    const ratioOptions = directOptions.length > 0
      ? directOptions
      : Array.from(new Set(sizeOptions.map(ratioFromSize).filter((value): value is string => Boolean(value))));
    const currentSize = (parameters.size as string | undefined) ?? params?.size?.default ?? '';
    const value = (parameters.aspect_ratio as string | undefined)
      ?? params?.ratio?.default
      ?? ratioFromSize(currentSize)
      ?? directOptions[0]
      ?? '';
    return (
      <ChoiceGrid
        options={ratioOptions}
        value={value}
        onChange={(next) => {
          if (directOptions.length > 0) update('aspect_ratio', next);
          else {
            const matchingSize = sizeOptions.find((size) => ratioFromSize(size) === next);
            if (matchingSize) update('size', matchingSize);
          }
        }}
      />
    );
  }

  if (control === 'seed') {
    return (
      <label className="block space-y-2">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">Seed</span>
        <input
          type="number"
          value={parameters.seed ?? ''}
          placeholder={t('parameters.seedPlaceholder')}
          onChange={(event) => {
            const next = event.target.value;
            update('seed', next === '' ? undefined : Number.parseInt(next, 10));
          }}
          className="glass-input min-h-11 w-full rounded-xl bg-surface-inset font-mono text-sm text-foreground placeholder:text-text-muted"
        />
      </label>
    );
  }

  if (control === 'audio' && audioControl) {
    const enabled = audioControl === 'sound' ? parameters.sound === 'on' : parameters.audio === true;
    return (
      <div className="grid grid-cols-2 gap-2">
        {[true, false].map((next) => (
          <button
            key={String(next)}
            type="button"
            onClick={() => update(audioControl, audioControl === 'sound' ? (next ? 'on' : 'off') : next)}
            aria-pressed={enabled === next}
            className={[
              'min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              enabled === next
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border-subtle bg-surface-inset text-text-secondary hover:bg-hover-bg hover:text-foreground',
            ].join(' ')}
          >
            {t(next ? 'parameters.audioOn' : 'parameters.audioOff')}
          </button>
        ))}
      </div>
    );
  }

  return (
    <ChoiceGrid
      options={['1', '2', '4']}
      value={String(batchSize)}
      onChange={(next) => setBatchSize(Number(next))}
      format={(next) => `×${next}`}
    />
  );
}
