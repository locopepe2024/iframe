'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, WandSparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import { REWRITE_SELECTION_LIMIT, type PassageSelection } from '../utils/passageRewrite';

interface Props {
  passage: PassageSelection;
  title: string;
  projectId?: string;
  scriptDocumentId?: string;
  onClose: () => void;
  onApply: (replacement: string) => Promise<void>;
}

export default function ScriptRewriteDialog({ passage, title, projectId, scriptDocumentId, onClose, onApply }: Props) {
  const t = useTranslations('scriptEditor.rewrite');
  const headingId = useId();
  const panel = useRef<HTMLElement>(null);
  const run = useRef(0);
  const applying = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [instruction, setInstruction] = useState('');
  const [candidate, setCandidate] = useState('');
  const [generating, setGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const tooLong = passage.selectedText.length > REWRITE_SELECTION_LIMIT;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLTextAreaElement>('[data-instruction]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!applying.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') || []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      run.current += 1;
      document.removeEventListener('keydown', onKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const generate = async () => {
    if (!instruction.trim() || tooLong || generating || isApplying || (!projectId && !scriptDocumentId)) return;
    const active = ++run.current;
    setGenerating(true);
    setError('');
    try {
      const resource = projectId ? { project_id: projectId } : { script_document_id: scriptDocumentId };
      const job = await scriptEditorApi.startScriptRewrite({ ...resource, title,
        selected_text: passage.selectedText, before_text: passage.beforeText, after_text: passage.afterText, instruction });
      let current = job;
      while (current.status === 'queued' || current.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (run.current !== active) return;
        current = await scriptEditorApi.getScriptWritingJob(job.id, resource);
      }
      if (run.current !== active) return;
      if (current.status !== 'completed' || !current.result?.draft?.trim()) throw new Error(current.error || t('failed'));
      setCandidate(current.result.draft);
    } catch (cause) {
      if (run.current === active) {
        const detail = (cause as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : cause instanceof Error ? cause.message : t('failed'));
      }
    } finally {
      if (run.current === active) setGenerating(false);
    }
  };

  const apply = async () => {
    if (!candidate.trim() || generating || applying.current) return;
    applying.current = true;
    setIsApplying(true);
    setError('');
    try {
      await onApply(candidate);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('failed'));
    } finally {
      applying.current = false;
      setIsApplying(false);
    }
  };

  const fieldClass = 'mt-2 w-full resize-y rounded-md border border-white/15 bg-black/25 p-3 text-sm leading-6 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
  const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/15 px-4 text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-busy={generating || isApplying}
        onKeyDown={event => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/15 bg-[#101116] text-foreground shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <h2 id={headingId} className="font-semibold">{t('title')}</h2>
          <button type="button" onClick={onClose} disabled={isApplying} aria-label={t('close')} className={buttonClass}><X size={18} /></button>
        </header>
        <div className="space-y-4 overflow-y-auto p-5">
          <p className="text-sm leading-6 text-text-secondary">{t('hint')}</p>
          <label className="block text-sm text-text-secondary">{t('instruction')}
            <textarea data-instruction aria-label={t('instruction')} rows={2} value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={4000}
              disabled={generating || isApplying} className={fieldClass} placeholder={t('placeholder')} />
          </label>
          {tooLong && <p role="alert" className="text-sm text-red-300">{t('tooLong')}</p>}
          {error && <p role="alert" className="rounded border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="min-w-0 text-sm text-text-secondary">{t('original')}
              <textarea readOnly aria-label={t('original')} value={passage.selectedText} rows={12} className={fieldClass} />
            </label>
            <label className="min-w-0 text-sm text-text-secondary">{t('candidate')}
              <textarea aria-label={t('candidate')} value={candidate} onChange={event => setCandidate(event.target.value)} rows={12} disabled={generating || isApplying}
                className={fieldClass} placeholder={t('candidateHint')} />
            </label>
          </div>
          <p role="status" aria-live="polite" className="text-sm text-text-secondary">{generating ? t('working') : t('reviewHint')}</p>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} disabled={isApplying} className={buttonClass}>{t('discard')}</button>
          <button type="button" onClick={() => void generate()} disabled={!instruction.trim() || tooLong || generating || isApplying}
            className={buttonClass}>{generating ? <Loader2 size={16} className="animate-spin" /> : <WandSparkles size={16} />}{t(candidate ? 'regenerate' : 'generate')}</button>
          <button type="button" onClick={() => void apply()} disabled={!candidate.trim() || generating || isApplying}
            className={`${buttonClass} border-primary/50 bg-primary/20 hover:bg-primary/30`}>{isApplying ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{t('replace')}</button>
        </footer>
      </section>
    </div>, document.body,
  );
}
