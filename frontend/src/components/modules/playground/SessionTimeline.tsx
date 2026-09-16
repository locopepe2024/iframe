'use client';

import { ArrowUpLeft, GitBranch, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { playgroundApi, type ChatMessage } from '@/lib/api';
import ResultCard from './ResultCard';
import OverflowActions from './OverflowActions';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
import { shortReferenceLabel } from './referenceMedia';

const MODE_LABELS: Record<string, string> = {
  t2i: 'T2I', i2i: 'I2I', t2v: 'T2V', i2v: 'I2V', r2v: 'R2V', f2v: 'F2V', v2v: 'V2V',
};

function parameterSummary(parameters: Record<string, any>): string {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

function PromptWithReferences({ prompt, mediaNames }: { prompt: string; mediaNames: string[] }) {
  const names = mediaNames.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{prompt}</>;
  const pattern = new RegExp(`@(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of Array.from(prompt.matchAll(pattern))) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(prompt.slice(cursor, index));
    const fullName = match[1];
    parts.push(<span key={`${index}-${fullName}`} title={fullName} className="mx-0.5 inline-flex max-w-[13rem] cursor-help items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 align-baseline text-emerald-300 ring-1 ring-inset ring-emerald-400/20">@{shortReferenceLabel(fullName)}</span>);
    cursor = index + match[0].length;
  }
  if (!parts.length) return <>{prompt}</>;
  if (cursor < prompt.length) parts.push(prompt.slice(cursor));
  return <>{parts}</>;
}

function GenerationTurn({ generation }: { generation: PlaygroundGeneration }) {
  const t = useTranslations('playground.timeline');
  const restoreGeneration = usePlaygroundStore((state) => state.restoreGeneration);
  const useResultAsReference = usePlaygroundStore((state) => state.useResultAsReference);
  const [error, setError] = useState('');
  const remove = async () => {
    try {
      await playgroundApi.deleteGeneration(generation.id);
      usePlaygroundStore.getState().removeGeneration(generation.id);
    } catch { setError('删除失败，请重试 / Could not delete'); }
  };
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
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground"><PromptWithReferences prompt={generation.prompt} mediaNames={Object.values(generation.media_names || {})} /></p>
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
        {error && <p role="alert" className="text-xs text-status-failed-fg">{error}</p>}
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
                  onDelete={() => { void remove(); }}
                  onGenerateVideo={(path) => useResultAsReference(path, 'image', 'i2v')}
                />
              ))
            : <ResultCard generation={generation} onDelete={() => { void remove(); }} onRetry={() => restoreGeneration(generation)} />}
        </div>
      </section>
    </article>
  );
}

function ChatCard({ message, onDelete }: { message: ChatMessage; onDelete: (id: string) => void }) {
  const [error, setError] = useState('');
  const restore = () => {
    const state = usePlaygroundStore.getState();
    state.setPrompt(message.content);
    if (message.input_media) {
      state.setInputMedia(message.input_media);
      usePlaygroundStore.setState({ mediaNames: { ...state.mediaNames, ...Object.fromEntries(message.input_media.map((path, i) => [path, message.asset_names?.[i] || path])) } });
    }
  };
  return <article className="relative pl-9 mb-8">
    <div className="absolute left-[11px] top-0 h-full w-px bg-border-subtle" />
    <div className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-glass-border bg-surface text-text-muted"><Sparkles size={12} /></div>
    <section className="rounded-[18px] border border-glass-border bg-glass px-4 py-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-[0.625rem] text-text-muted"><span>{message.role === 'user' ? '你 · Agent' : 'Agent'}</span><span title={message.model}>{message.model && (message.model.length > 10 ? message.model.slice(0, 10) + '...' : message.model)}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground"><PromptWithReferences prompt={message.content} mediaNames={message.asset_names || []} /></p>
      {!!message.asset_names?.length && <div className="mt-3 flex flex-wrap gap-2">{message.asset_names.map((name, i) => <span key={i} title={name} className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">@{shortReferenceLabel(name)}</span>)}</div>}
      <button type="button" onClick={restore} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-glass-border px-3 text-xs text-text-secondary hover:text-primary"><ArrowUpLeft size={14} />{message.role === 'assistant' ? '填入输入框' : '编辑继续'}</button>
      <div className="mt-2 flex items-center text-xs text-text-muted"><time>{message.created_at ? new Date(message.created_at * 1000).toLocaleString() : '历史消息'}</time><OverflowActions label="消息操作" actions={[
        { label: '复制', onClick: () => { void navigator.clipboard.writeText(message.content).catch(() => setError('复制失败，请重试')); } },
        { label: '删除', danger: true, onClick: () => onDelete(message.id) },
      ]} /></div>
      {error && <p role="alert" className="text-xs text-status-failed-fg">{error}</p>}
    </section>
  </article>;
}

export function mergeTimeline(history: PlaygroundGeneration[], messages: ChatMessage[]) {
  // Legacy messages have no timestamp: keep their existing order before dated entries.
  return [
    ...history.map(generation => ({ kind: 'generation' as const, id: generation.id, at: new Date(generation.created_at).getTime(), generation })),
    ...messages.map(message => ({ kind: 'chat' as const, id: message.id, at: (message.created_at || 0) * 1000, message })),
  ].sort((a, b) => a.at - b.at);
}

export default function SessionTimeline({ messages = [], busy = false, error = '', onDeleteMessage = () => {} }: {
  messages?: ChatMessage[]; busy?: boolean; error?: string; onDeleteMessage?: (id: string) => void;
} = {}) {

  const t = useTranslations('playground.timeline');
  const history = usePlaygroundStore((state) => state.history);
  const sorted = useMemo(() => mergeTimeline(history, messages), [history, messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }));
  }, [history, messages, busy]);

  if (sorted.length === 0 && !busy && !error) {
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
        {sorted.map(entry => entry.kind === 'generation' ? <GenerationTurn key={'generation-' + entry.id} generation={entry.generation} /> : <ChatCard key={'chat-' + entry.id} message={entry.message} onDelete={onDeleteMessage} />)}
        {busy && <p role="status" className="pl-9 py-3 text-sm text-text-muted">Agent 正在回复…</p>}
        {error && <p role="alert" className="pl-9 py-3 text-sm text-status-failed-fg">{error}</p>}
      </div>
    </div>
  );
}
