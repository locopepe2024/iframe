'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

/** A disclosure with native Tab order, rather than an application menubar. */
export function EditingProjectActions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className="relative shrink-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="glass-button flex h-11 w-11 items-center justify-center p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><MoreHorizontal size={18} aria-hidden="true" /></button>
    {open && <div id={id} role="group" aria-label={label} className="absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-3rem)] space-y-1 rounded-lg border border-glass-border bg-surface p-1 shadow-xl" onClick={event => {
      if ((event.target as Element).closest('button:not(:disabled)')) { setOpen(false); trigger.current?.focus(); }
    }}>{children}</div>}
  </div>;
}

export function EditingProjectDialog({ title, closeLabel, busy = false, initialFocus, size = 'md', onClose, children }: {
  title: string; closeLabel: string; busy?: boolean; initialFocus?: string; size?: 'md' | 'lg' | 'xl'; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    (dialog?.querySelector<HTMLElement>(initialFocus || 'input:not(:disabled), textarea:not(:disabled)') || dialog?.querySelector('button:not(:disabled)'))?.focus();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={heading} aria-modal="true" className={`m-auto max-h-[85dvh] w-[calc(100vw_-_2rem)] ${size === 'xl' ? 'max-w-2xl' : size === 'lg' ? 'max-w-lg' : 'max-w-md'} space-y-4 overflow-y-auto rounded-xl border border-glass-border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/70`}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className="flex items-center justify-between gap-3"><h2 id={heading} className="text-base font-semibold">{title}</h2><button type="button" className="glass-button flex h-11 w-11 shrink-0 items-center justify-center p-0 disabled:opacity-40" aria-label={closeLabel} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}
