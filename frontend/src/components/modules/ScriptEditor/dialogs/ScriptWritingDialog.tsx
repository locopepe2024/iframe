'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, TextCursorInput, WandSparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { scriptEditorApi, type ScriptWritingMode } from '@/lib/scriptEditorApi';

interface ScriptWritingDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (mode: ScriptWritingMode, draft: string) => Promise<void>;
  mode: ScriptWritingMode;
  projectId?: string;
  scriptDocumentId?: string;
  title: string;
  sourceText: string;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function ScriptWritingDialog({
  open,
  onClose,
  onApply,
  mode: initialMode,
  projectId,
  scriptDocumentId,
  title,
  sourceText,
}: ScriptWritingDialogProps) {
  const t = useTranslations('scriptEditor.writing');
  const [mode, setMode] = useState(initialMode);
  const [duration, setDuration] = useState(5);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const runId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setDuration(5);
    setInstruction('');
    setDraft('');
    setError('');
    runId.current += 1;
  }, [open, initialMode]);

  const generate = async () => {
    if (!sourceText.trim() || (!projectId && !scriptDocumentId) || isGenerating) return;
    const activeRun = ++runId.current;
    setError('');
    setDraft('');
    setIsGenerating(true);
    try {
      const resource = projectId ? { project_id: projectId } : { script_document_id: scriptDocumentId };
      const job = await scriptEditorApi.startScriptWriting({
        ...resource,
        mode,
        title,
        source_text: sourceText,
        duration_minutes: duration,
        instruction,
      });
      let current = job;
      for (let attempt = 0; current.status === 'running' || current.status === 'queued'; attempt += 1) {
        if (runId.current !== activeRun) return;
        if (attempt >= 600) throw new Error(t('timeout'));
        await pause(1500);
        current = await scriptEditorApi.getScriptWritingJob(job.id, resource);
      }
      if (current.status !== 'completed' || !current.result?.draft) {
        throw new Error(current.error || t('failed'));
      }
      if (runId.current === activeRun) setDraft(current.result.draft);
    } catch (cause) {
      if (runId.current === activeRun) {
        const detail = (cause as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail;
        setError(detail || (cause instanceof Error ? cause.message : t('failed')));
      }
    } finally {
      if (runId.current === activeRun) setIsGenerating(false);
    }
  };

  const close = () => {
    runId.current += 1;
    setIsGenerating(false);
    setIsApplying(false);
    onClose();
  };

  const apply = async () => {
    if (!draft.trim() || isApplying) return;
    setIsApplying(true);
    setError('');
    try {
      await onApply(mode, draft);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('applyFailed'));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.section
            role="dialog" aria-modal="true" aria-labelledby="script-writing-title"
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#101116] shadow-2xl"
            initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <h2 id="script-writing-title" className="text-base font-semibold text-foreground">{t('title')}</h2>
                <p className="mt-1 truncate text-xs text-text-muted">{title}</p>
              </div>
              <button type="button" onClick={close} aria-label={t('close')} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-white/10 hover:text-foreground">
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="inline-flex rounded-md border border-white/10 p-1" role="group" aria-label={t('mode')}>
                  <button type="button" onClick={() => { setMode('expand_outline'); setDraft(''); setError(''); }} aria-pressed={mode === 'expand_outline'} className={`flex h-9 items-center gap-2 rounded px-3 text-sm ${mode === 'expand_outline' ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-foreground'}`}>
                    <WandSparkles size={15} />{t('expand')}
                  </button>
                  <button type="button" onClick={() => { setMode('continue'); setDraft(''); setError(''); }} aria-pressed={mode === 'continue'} className={`flex h-9 items-center gap-2 rounded px-3 text-sm ${mode === 'continue' ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-foreground'}`}>
                    <TextCursorInput size={15} />{t('continue')}
                  </button>
                </div>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <span>{t('duration')}</span>
                  <input type="number" min={1} max={30} value={duration} onChange={event => setDuration(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} className="h-9 w-20 rounded border border-white/10 bg-transparent px-2 text-foreground" />
                  <span>{t('minutes')}</span>
                </label>
              </div>

              <label className="block text-sm text-text-secondary">
                <span>{t('instruction')}</span>
                <textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} maxLength={4000} placeholder={t('instructionPlaceholder')} className="mt-2 w-full resize-y rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-primary/50 focus:outline-none" />
              </label>

              {error && <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

              {draft ? (
                <label className="block text-sm text-text-secondary">
                  <span>{t('preview')}</span>
                  <textarea aria-label={t('preview')} value={draft} onChange={event => setDraft(event.target.value)} rows={18} className="mt-2 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-3 font-mono text-sm leading-6 text-foreground focus:border-primary/50 focus:outline-none" />
                </label>
              ) : (
                <div className="rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-text-secondary">
                  {mode === 'expand_outline' ? t('sourceOutline', { count: sourceText.length.toLocaleString() }) : t('sourceScript', { count: sourceText.length.toLocaleString() })}
                  {isGenerating && <span className="ml-2 text-primary">{t('working')}</span>}
                </div>
              )}
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button type="button" onClick={close} className="h-10 rounded-md border border-white/10 px-4 text-sm text-text-secondary hover:bg-white/5">{t('cancel')}</button>
              {draft && <button type="button" onClick={() => { void generate(); }} disabled={isGenerating || isApplying} className="h-10 rounded-md border border-white/10 px-4 text-sm text-foreground hover:bg-white/5 disabled:opacity-50">{t('regenerate')}</button>}
              {draft ? (
                <button type="button" onClick={() => { void apply(); }} disabled={isApplying || isGenerating} className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">
                  {isApplying ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {mode === 'expand_outline' ? t('replace') : t('append')}
                </button>
              ) : (
                <button type="button" onClick={() => { void generate(); }} disabled={!sourceText.trim() || isGenerating || isApplying} className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <WandSparkles size={16} />}
                  {isGenerating ? t('generating') : t('generate')}
                </button>
              )}
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
