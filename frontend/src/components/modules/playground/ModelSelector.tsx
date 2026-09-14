'use client';

import { useEffect, useMemo } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore } from './usePlaygroundStore';
import { getModelsForMode, usePlaygroundCatalogRevision, type PlaygroundModelOption } from './playgroundModels';

const FAMILY_LABELS: Record<string, string> = {
  seedance: 'Seedance',
  minimax: 'Minimax H3',
  wan: 'Alibaba Wan',
  'gpt-image': 'GPT Image',
  'nano-banana': 'Nano Banana',
  uniart: 'UniArt',
};

function modelMeta(model: PlaygroundModelOption): string {
  const resolution = model.params.resolution?.options ?? model.params.size?.options ?? [];
  const duration = model.duration?.type === 'slider'
    ? `${model.duration.min}–${model.duration.max}s`
    : model.duration?.type === 'buttons'
      ? model.duration.options.map((value) => `${value}s`).join(' / ')
      : model.duration?.type === 'fixed'
        ? `${model.duration.value}s`
        : null;
  return [...resolution, duration].filter(Boolean).join(' · ');
}

export default function ModelSelector() {
  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const setModelId = usePlaygroundStore((state) => state.setModelId);
  const t = useTranslations('playground');
  const catalogRevision = usePlaygroundCatalogRevision();

  const availableModels = useMemo(() => getModelsForMode(mode), [mode, catalogRevision]);
  const groupedModels = useMemo(() => {
    const groups = new Map<string, PlaygroundModelOption[]>();
    for (const model of availableModels) {
      groups.set(model.family, [...(groups.get(model.family) ?? []), model]);
    }
    return Array.from(groups, ([family, models]) => ({ family, models }));
  }, [availableModels]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some((model) => model.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [availableModels, modelId, setModelId]);

  if (availableModels.length === 0) {
    return <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-5 text-sm text-text-muted">{t('model.noModels')}</div>;
  }

  return (
    <div className="space-y-4">
      {groupedModels.map((group) => (
        <section key={group.family} aria-label={FAMILY_LABELS[group.family] ?? group.family}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
              {FAMILY_LABELS[group.family] ?? group.family}
            </h3>
            <span className="font-mono text-[0.5625rem] text-text-muted">{group.models.length} SKU</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.models.map((model) => {
              const selected = model.id === modelId;
              const meta = modelMeta(model);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setModelId(model.id)}
                  aria-pressed={selected}
                  className={[
                    'group flex min-h-16 items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                    selected
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border-subtle bg-surface-inset text-foreground hover:border-foreground/30 hover:bg-hover-bg',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.8125rem] font-semibold">{model.displayName}</span>
                      {model.recommended && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-primary">
                          {t('model.recommended')}
                        </span>
                      )}
                    </span>
                    {meta && <span className="mt-1 block truncate font-mono text-[0.625rem] text-text-muted">{meta}</span>}
                  </span>
                  <span className={selected ? 'text-primary' : 'text-transparent group-hover:text-text-muted'}>
                    <Check size={15} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
