'use client';

import { ArrowUpLeft, GitBranch, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import ResultCard from './ResultCard';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

const MODE_LABELS: Record<string, string> = {
  t2i: 'T2I', i2i: 'I2I', t2v: 'T2V', i2v: 'I2V', r2v: 'R2V', v2v: 'V2V',
};

function parameterSummary(parameters: Record<string, any>): string {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

function GenerationTurn({ generation }: { generation: PlaygroundGeneration }) {
  const t = useTranslations('playground.timeline');
  const restoreGeneration = usePlaygroundStore((state) => state.restoreGeneration);
  const useResultAsReference = usePlaygroundStore((state) => state.useResultAsReference);
  const summary = parameterSummary(generation.parameters);

  return (
    <article className="relative pl-9">
      <div className="absolute left-[11px] top-0 h-full w-px bg-border-subtle" />
      <div className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-glass-border bg-surface text-text-muted">
        <ArrowUpLeft size={12} />
      </div>

      <section className="mb-3 rounded-[18px] border border-glass-border bg-glass px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-text-muted">
          <span>{MODE_LABELS[generation.mode] || generation.mode}</span>
          <span>·</span>
          <span className="normal-case tracking-normal">{generation.model_id}</span>
          {generation.parent_generation_id && (
            <span className="inline-flex items-center gap-1 rounded bg-surface-inset px-1.5 py-0.5 normal-case tracking-normal">
              <GitBranch size={10} /> {t('continued')}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{generation.prompt}</p>
        {(generation.input_media.length > 0 || summary) && (
          <div className="mt-3 flex flex-wrap gap-2 text-[0.6875rem] text-text-muted">
            {generation.input_media.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-inset px-2 py-1">
                <ImageIcon size={12} /> {t('references', { count: generation.input_media.length })}
              </span>
            )}
            {summary && <span className="rounded-lg bg-surface-inset px-2 py-1">{summary}</span>}
          </div>
        )}
        <button
          type="button"
          onClick={() => restoreGeneration(generation)}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-glass-border px-3 text-xs font-medium text-text-secondary transition hover:border-primary/40 hover:text-primary"
        >
          <ArrowUpLeft size={14} /> {t('editContinue')}
        </button>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
          <Sparkles size={12} className="text-primary" /> {t('result')}
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {generation.status === 'completed' && generation.outputs.length > 0
            ? generation.outputs.map((output, index) => (
                <ResultCard
                  key={output.id}
                  generation={generation}
                  outputIndex={index}
                  onGenerateVideo={(path) => useResultAsReference(path, 'image', 'i2v')}
                />
              ))
            : <ResultCard generation={generation} onRetry={() => restoreGeneration(generation)} />}
        </div>
      </section>
    </article>
  );
}

export default function SessionTimeline() {
  const t = useTranslations('playground.timeline');
  const history = usePlaygroundStore((state) => state.history);
  const sorted = useMemo(
    () => [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [history],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }));
  }, [history]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Sparkles className="mb-4 h-11 w-11 text-text-muted opacity-40" />
        <p className="font-display text-base text-foreground">{t('emptyTitle')}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
      }}
      className="flex-1 overflow-y-auto px-4 py-5 scrollbar-thin md:px-6"
    >
      <div className="mx-auto max-w-5xl">
        {sorted.map((generation) => <GenerationTurn key={generation.id} generation={generation} />)}
      </div>
    </div>
  );
}
