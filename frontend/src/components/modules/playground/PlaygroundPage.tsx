'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import AgentComposer from './AgentComposer';
import { useAgentConversation } from './useAgentConversation';
import { getOutputType } from './ModeSelector';
import SessionRail from './SessionRail';
import SessionTimeline from './SessionTimeline';
import {
  createPlaygroundSession,
  openPlaygroundSession,
  toPlaygroundGeneration,
  toPlaygroundSession,
} from './playgroundSessionController';
import {
  usePlaygroundStore,
  type PlaygroundMode,
  type QueuedRequest,
} from './usePlaygroundStore';
import { playgroundApi } from '@/lib/api';
import { getDefaultModelForMode, getModelCapabilities, installUniArtCatalog } from './playgroundModels';
import { referenceKey, referenceName } from './referenceMedia';

const POLL_INTERVAL = 2000;
const MAX_POLL_ERRORS = 4;

export default function PlaygroundPage() {
  const t = useTranslations('playground');
  const [chatMode, setChatMode] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const prompt = usePlaygroundStore((state) => state.prompt);
  const negativePrompt = usePlaygroundStore((state) => state.negativePrompt);
  const inputMedia = usePlaygroundStore((state) => state.inputMedia);
  const mediaNames = usePlaygroundStore((state) => state.mediaNames);
  const parameters = usePlaygroundStore((state) => state.parameters);
  const batchSize = usePlaygroundStore((state) => state.batchSize);
  const history = usePlaygroundStore((state) => state.history);
  const sessions = usePlaygroundStore((state) => state.sessions);
  const activeSessionId = usePlaygroundStore((state) => state.activeSessionId);
  const agent = useAgentConversation(chatMode, activeSessionId);
  const parentGenerationId = usePlaygroundStore((state) => state.parentGenerationId);
  const queue = usePlaygroundStore((state) => state.queue);
  const activeCount = usePlaygroundStore((state) => state.activeGenerationIds.length);
  const maxConcurrent = usePlaygroundStore((state) => state.maxConcurrent);

  const setTemplates = usePlaygroundStore((state) => state.setTemplates);
  const setSessions = usePlaygroundStore((state) => state.setSessions);
  const updateSession = usePlaygroundStore((state) => state.updateSession);
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
        const full = toPlaygroundGeneration(await playgroundApi.getGenerationStatus(generationId));
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

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        try {
          const upstreamCatalog = await playgroundApi.getUniArtModels();
          installUniArtCatalog(upstreamCatalog.models);
        } catch (error) {
          console.error('[Playground] Failed to refresh UniArt catalog:', error);
        }
        let loaded = (await playgroundApi.getSessions()).map(toPlaygroundSession);
        if (loaded.length === 0) loaded = [toPlaygroundSession(await playgroundApi.createSession())];
        if (cancelled) return;
        setSessions(loaded);
        await openPlaygroundSession(loaded[0]);
        const current = usePlaygroundStore.getState();
        if (!getModelCapabilities(current.modelId).includes(current.mode)) {
          current.setModelId(getDefaultModelForMode(current.mode));
        }
        if (!cancelled) setSessionReady(true);
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
  }, [setSessions, setTemplates]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
    pollTimers.current.forEach((timer) => clearInterval(timer));
    pollTimers.current.clear();
    pollErrors.current.clear();
  }, [activeSessionId]);

  useEffect(() => {
    history
      .filter((item) => item.status === 'pending' || item.status === 'processing')
      .forEach((item) => startPolling(item.id));
  }, [history, startPolling]);

  useEffect(() => () => {
    pollTimers.current.forEach((timer) => clearInterval(timer));
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!activeSessionId || !sessionReady) return;
    setSavingDraft(true);
    const timer = setTimeout(async () => {
      try {
        const saved = toPlaygroundSession(await playgroundApi.updateSession(activeSessionId, {
          draft: {
            mode,
            model_id: modelId,
            prompt,
            negative_prompt: negativePrompt || undefined,
            input_media: inputMedia,
            media_names: Object.fromEntries(inputMedia.map((path) => [referenceKey(path), referenceName(path, mediaNames, history)])),
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
  }, [activeSessionId, batchSize, inputMedia, mediaNames, history, mode, modelId, negativePrompt, parameters, parentGenerationId, prompt, sessionReady, updateSession]);

  const handleCreateSession = useCallback(async () => {
    try {
      await createPlaygroundSession();
    } catch (error) {
      console.error('[Playground] Failed to create session:', error);
    }
  }, []);

  const handleOpenSession = useCallback(async (session: (typeof sessions)[number]) => {
    try {
      await openPlaygroundSession(session);
    } catch (error) {
      console.error('[Playground] Failed to load session history:', error);
    }
  }, []);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || !activeSessionId) return;
    enqueueRequest({
      mode: mode === 't2i' && inputMedia.length > 0 ? 'i2i' : mode,
      modelId,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt || undefined,
      inputMedia,
      mediaNames: Object.fromEntries(inputMedia.map((path) => [referenceKey(path), referenceName(path, mediaNames, history)])),
      parameters,
      batchSize,
      sessionId: activeSessionId,
      parentGenerationId: parentGenerationId || undefined,
    });
  }, [activeSessionId, batchSize, enqueueRequest, inputMedia, mediaNames, history, mode, modelId, negativePrompt, parameters, parentGenerationId, prompt]);

  const dispatchRequest = useCallback(async (request: QueuedRequest) => {
    try {
      const generation = toPlaygroundGeneration(await playgroundApi.generate({
        mode: request.mode,
        model_id: request.modelId,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        input_media: request.inputMedia.length ? request.inputMedia : undefined,
        media_names: request.mediaNames,
        parameters: Object.keys(request.parameters).length ? request.parameters : undefined,
        batch_size: request.batchSize > 1 ? request.batchSize : undefined,
        session_id: request.sessionId,
        parent_generation_id: request.parentGenerationId,
      }));
      if (request.sessionId === activeSessionRef.current) startGeneration(generation);
      removeFromQueue(request.id);
      if (generation.status !== 'completed' && generation.status !== 'failed') startPolling(generation.id);
      setSessions((await playgroundApi.getSessions()).map(toPlaygroundSession));
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
  const hasRequiredMedia = mode !== 'f2v' || inputMedia.length === 2;
  const canGenerate = Boolean(activeSessionId && prompt.trim() && hasRequiredMedia);
  const outputType = getOutputType(mode);

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <span className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.2em] text-text-muted">FREEFORM STUDIO <span className="font-semibold text-primary">· {t('header.eyebrowAccent')}</span></span>
          <div className="flex items-baseline gap-2"><h1 className="truncate font-display text-[1.625rem] font-semibold tracking-tight text-foreground md:text-[2.125rem]">{t('header.title')}</h1><span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-text-muted">{t('header.resultsCount', { count: resultCount })}</span></div>
        </div>
        <div className="flex items-center gap-3">{savingDraft && <span className="hidden text-xs text-text-muted sm:inline">{t('sessions.saving')}</span>}<span className="rounded border border-glass-border bg-glass px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">{chatMode ? 'Agent' : t(outputType === 'image' ? 'mode.outputImage' : 'mode.outputVideo')}</span></div>
      </header>

      <SessionRail compact sessions={sessions} activeSessionId={activeSessionId} onSelect={handleOpenSession} onCreate={handleCreateSession} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SessionTimeline messages={agent.messages} busy={agent.busy} error={agent.error} onDeleteMessage={agent.removeMessage} />
        <AgentComposer canGenerate={chatMode ? !!prompt.trim() && !agent.busy && !agent.loading && agent.models.some(m => m.api_model_id === agent.model) : canGenerate} batchSize={batchSize} onGenerate={chatMode ? agent.send : handleGenerate} agent={{ active: chatMode, model: agent.model, models: agent.models, setModel: agent.setModel }} onAgentChange={setChatMode} />
      </main>
    </div>
  );
}
