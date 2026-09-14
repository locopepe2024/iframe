'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import ModeSelector from './ModeSelector';
import ModelSelector from './ModelSelector';
import MediaInput from './MediaInput';
import PromptInput from './PromptInput';
import ParameterBar from './ParameterBar';
import SessionRail from './SessionRail';
import SessionTimeline from './SessionTimeline';
import {
  usePlaygroundStore,
  type PlaygroundGeneration,
  type PlaygroundMode,
  type PlaygroundSession,
  type QueuedRequest,
} from './usePlaygroundStore';
import { playgroundApi, type PlaygroundGenerationResponse, type PlaygroundSessionResponse } from '@/lib/api';

const MODE_LABELS: Record<PlaygroundMode, string> = {
  t2i: 'T2I', i2i: 'I2I', t2v: 'T2V', i2v: 'I2V', r2v: 'R2V', v2v: 'V2V',
};
const MODES_WITH_MEDIA: PlaygroundMode[] = ['i2i', 'i2v', 'r2v', 'v2v'];
const POLL_INTERVAL = 2000;
const MAX_POLL_ERRORS = 4;

function toGeneration(resp: PlaygroundGenerationResponse): PlaygroundGeneration {
  return {
    id: resp.id,
    mode: resp.mode as PlaygroundMode,
    model_id: resp.model_id,
    prompt: resp.prompt,
    negative_prompt: resp.negative_prompt,
    input_media: resp.input_media,
    parameters: resp.parameters,
    batch_size: resp.batch_size,
    outputs: resp.outputs.map((output) => ({ ...output, media_type: output.media_type as 'image' | 'video' })),
    status: resp.status as PlaygroundGeneration['status'],
    error: resp.error,
    created_at: resp.created_at,
    session_id: resp.session_id,
    parent_generation_id: resp.parent_generation_id,
  };
}

function toSession(resp: PlaygroundSessionResponse): PlaygroundSession {
  return { ...resp, draft: { ...resp.draft, mode: resp.draft.mode as PlaygroundMode } };
}

export default function PlaygroundPage() {
  const t = useTranslations('playground');
  const [savingDraft, setSavingDraft] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const prompt = usePlaygroundStore((state) => state.prompt);
  const negativePrompt = usePlaygroundStore((state) => state.negativePrompt);
  const inputMedia = usePlaygroundStore((state) => state.inputMedia);
  const parameters = usePlaygroundStore((state) => state.parameters);
  const batchSize = usePlaygroundStore((state) => state.batchSize);
  const history = usePlaygroundStore((state) => state.history);
  const sessions = usePlaygroundStore((state) => state.sessions);
  const activeSessionId = usePlaygroundStore((state) => state.activeSessionId);
  const parentGenerationId = usePlaygroundStore((state) => state.parentGenerationId);
  const queue = usePlaygroundStore((state) => state.queue);
  const activeCount = usePlaygroundStore((state) => state.activeGenerationIds.length);
  const maxConcurrent = usePlaygroundStore((state) => state.maxConcurrent);

  const setHistory = usePlaygroundStore((state) => state.setHistory);
  const setTemplates = usePlaygroundStore((state) => state.setTemplates);
  const setSessions = usePlaygroundStore((state) => state.setSessions);
  const addSession = usePlaygroundStore((state) => state.addSession);
  const updateSession = usePlaygroundStore((state) => state.updateSession);
  const setActiveSession = usePlaygroundStore((state) => state.setActiveSession);
  const applySessionDraft = usePlaygroundStore((state) => state.applySessionDraft);
  const startGeneration = usePlaygroundStore((state) => state.startGeneration);
  const updateGeneration = usePlaygroundStore((state) => state.updateGeneration);
  const enqueueRequest = usePlaygroundStore((state) => state.enqueueRequest);
  const markDispatching = usePlaygroundStore((state) => state.markDispatching);
  const removeFromQueue = usePlaygroundStore((state) => state.removeFromQueue);

  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const pollErrors = useRef<Map<string, number>>(new Map());
  const activeSessionRef = useRef<string | null>(null);

  const stopPolling = useCallback((generationId: string) => {
    const timer = pollTimers.current.get(generationId);
    if (timer) clearInterval(timer);
    pollTimers.current.delete(generationId);
    pollErrors.current.delete(generationId);
  }, []);

  const startPolling = useCallback((generationId: string) => {
    if (pollTimers.current.has(generationId)) return;
    const timer = setInterval(async () => {
      try {
        const full = toGeneration(await playgroundApi.getGeneration(generationId));
        pollErrors.current.set(generationId, 0);
        if (!full.session_id || full.session_id === activeSessionRef.current) updateGeneration(full);
        if (full.status === 'completed' || full.status === 'failed') stopPolling(generationId);
      } catch (error) {
        const failures = (pollErrors.current.get(generationId) || 0) + 1;
        pollErrors.current.set(generationId, failures);
        console.error('[Playground] Poll failed:', generationId, error);
        if (failures >= MAX_POLL_ERRORS) stopPolling(generationId);
      }
    }, POLL_INTERVAL);
    pollTimers.current.set(generationId, timer);
  }, [stopPolling, updateGeneration]);

  const openSession = useCallback(async (session: PlaygroundSession) => {
    pollTimers.current.forEach((timer) => clearInterval(timer));
    pollTimers.current.clear();
    pollErrors.current.clear();
    activeSessionRef.current = session.id;
    setActiveSession(session.id);
    applySessionDraft(session.draft);
    setSessionReady(false);
    try {
      const items = (await playgroundApi.getHistory(100, 0, session.id)).map(toGeneration);
      setHistory(items);
      items.filter((item) => item.status === 'pending' || item.status === 'processing')
        .forEach((item) => startPolling(item.id));
    } catch (error) {
      console.error('[Playground] Failed to load session history:', error);
      setHistory([]);
    } finally {
      setSessionReady(true);
    }
  }, [applySessionDraft, setActiveSession, setHistory, startPolling]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        let loaded = (await playgroundApi.getSessions()).map(toSession);
        if (loaded.length === 0) loaded = [toSession(await playgroundApi.createSession())];
        if (cancelled) return;
        setSessions(loaded);
        await openSession(loaded[0]);
      } catch (error) {
        console.error('[Playground] Failed to initialise sessions:', error);
      }
    };
    bootstrap();
    playgroundApi.getTemplates().then((items) => setTemplates(items.map((item) => ({
      ...item,
      default_mode: item.default_mode as PlaygroundMode | undefined,
    })))).catch((error) => console.error('[Playground] Failed to fetch templates:', error));
    return () => { cancelled = true; };
  }, [openSession, setSessions, setTemplates]);

  useEffect(() => () => {
    pollTimers.current.forEach((timer) => clearInterval(timer));
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!activeSessionId || !sessionReady) return;
    setSavingDraft(true);
    const timer = setTimeout(async () => {
      try {
        const saved = toSession(await playgroundApi.updateSession(activeSessionId, {
          draft: {
            mode,
            model_id: modelId,
            prompt,
            negative_prompt: negativePrompt || undefined,
            input_media: inputMedia,
            parameters,
            batch_size: batchSize,
            parent_generation_id: parentGenerationId || undefined,
          },
        }));
        updateSession(saved);
      } catch (error) {
        console.error('[Playground] Failed to save session draft:', error);
      } finally {
        setSavingDraft(false);
      }
    }, 700);
    return () => { clearTimeout(timer); setSavingDraft(false); };
  }, [activeSessionId, batchSize, inputMedia, mode, modelId, negativePrompt, parameters, parentGenerationId, prompt, sessionReady, updateSession]);

  const handleCreateSession = useCallback(async () => {
    try {
      const created = toSession(await playgroundApi.createSession());
      addSession(created);
      await openSession(created);
    } catch (error) {
      console.error('[Playground] Failed to create session:', error);
    }
  }, [addSession, openSession]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || !activeSessionId) return;
    enqueueRequest({
      mode: mode === 't2i' && inputMedia.length > 0 ? 'i2i' : mode,
      modelId,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt || undefined,
      inputMedia,
      parameters,
      batchSize,
      sessionId: activeSessionId,
      parentGenerationId: parentGenerationId || undefined,
    });
  }, [activeSessionId, batchSize, enqueueRequest, inputMedia, mode, modelId, negativePrompt, parameters, parentGenerationId, prompt]);

  const dispatchRequest = useCallback(async (request: QueuedRequest) => {
    try {
      const generation = toGeneration(await playgroundApi.generate({
        mode: request.mode,
        model_id: request.modelId,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        input_media: request.inputMedia.length ? request.inputMedia : undefined,
        parameters: Object.keys(request.parameters).length ? request.parameters : undefined,
        batch_size: request.batchSize > 1 ? request.batchSize : undefined,
        session_id: request.sessionId,
        parent_generation_id: request.parentGenerationId,
      }));
      if (request.sessionId === activeSessionRef.current) startGeneration(generation);
      removeFromQueue(request.id);
      if (generation.status !== 'completed' && generation.status !== 'failed') startPolling(generation.id);
      setSessions((await playgroundApi.getSessions()).map(toSession));
    } catch (error) {
      console.error('[Playground] Dispatch failed:', error);
      removeFromQueue(request.id);
    }
  }, [removeFromQueue, setSessions, startGeneration, startPolling]);

  const pump = useCallback(() => {
    const state = usePlaygroundStore.getState();
    const dispatching = state.queue.filter((item) => item.status === 'dispatching').length;
    let slots = state.maxConcurrent - state.activeGenerationIds.length - dispatching;
    for (const request of state.queue) {
      if (slots <= 0) break;
      if (request.status !== 'pending') continue;
      slots -= 1;
      markDispatching(request.id);
      dispatchRequest(request);
    }
  }, [dispatchRequest, markDispatching]);

  useEffect(() => { pump(); }, [activeCount, maxConcurrent, pump, queue]);

  const resultCount = history.reduce((count, item) => count + item.outputs.length, 0);
  const showMediaInput = mode === 't2i' || MODES_WITH_MEDIA.includes(mode);
  const canGenerate = Boolean(activeSessionId && prompt.trim());

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <span className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.2em] text-text-muted">FREEFORM STUDIO <span className="font-semibold text-primary">· {t('header.eyebrowAccent')}</span></span>
          <div className="flex items-baseline gap-2"><h1 className="truncate font-display text-[1.625rem] font-semibold tracking-tight text-foreground md:text-[2.125rem]">{t('header.title')}</h1><span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-text-muted">{t('header.resultsCount', { count: resultCount })}</span></div>
        </div>
        <div className="flex items-center gap-3">{savingDraft && <span className="hidden text-xs text-text-muted sm:inline">{t('sessions.saving')}</span>}<span className="rounded border border-glass-border bg-glass px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">{MODE_LABELS[mode]}</span></div>
      </header>

      <SessionRail compact sessions={sessions} activeSessionId={activeSessionId} onSelect={openSession} onCreate={handleCreateSession} />
      <div className="flex min-h-0 flex-1 overflow-hidden max-sm:flex-col">
        <aside className="flex w-[390px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-glass-border px-4 py-4 scrollbar-thin max-md:w-[340px] max-sm:h-[55%] max-sm:w-full max-sm:border-b max-sm:border-r-0">
          <section className="glass-panel rounded-[20px] px-5 py-5"><div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">{t('compose.modeLabel')}</div><ModeSelector /></section>
          <section className="glass-panel rounded-[20px] px-5 py-5"><div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">{t('compose.promptLabel')}</div><PromptInput /></section>
          {showMediaInput && <section className="glass-panel rounded-[20px] px-5 py-5"><div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">{t(mode === 'v2v' ? 'compose.mediaSourceVideo' : mode === 'r2v' ? 'compose.mediaRefMaterial' : mode === 'i2v' ? 'compose.mediaFirstFrame' : 'compose.mediaReference')}</div><MediaInput /></section>}
          <section className="glass-panel relative z-30 rounded-[20px] px-5 py-5"><div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">{t('compose.modelLabel')}</div><ModelSelector /><div className="my-4 h-px bg-border-subtle" /><div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">{t('compose.parametersLabel')}</div><ParameterBar /></section>
          <div className="flex-1" />
          <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-glass-border bg-surface/80 px-4 pb-4 pt-4 backdrop-blur-md"><button type="button" onClick={handleGenerate} disabled={!canGenerate} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-on-accent shadow-[var(--glow-primary)] transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"><Sparkles size={16} /><span>{batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}</span></button></div>
        </aside>
        <SessionRail sessions={sessions} activeSessionId={activeSessionId} onSelect={openSession} onCreate={handleCreateSession} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden max-sm:min-h-[45%]"><SessionTimeline /></main>
      </div>
    </div>
  );
}
