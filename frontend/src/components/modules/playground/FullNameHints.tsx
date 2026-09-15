'use client';

import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Delegated hints work for both React labels and editor-owned inline tokens. */
export default function FullNameHints({ children, className, ...props }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const id = useId();
  const [hint, setHint] = useState<{ label: string; left: number; top: number } | null>(null);
  const show = (target: EventTarget) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-full-name]') : null;
    if (!element) { setHint(null); return; }
    const rect = element.getBoundingClientRect();
    setHint({ label: element.dataset.fullName || '', left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 96)) });
  };
  return <div {...props} className={className} onMouseOver={(event) => show(event.target)} onMouseLeave={() => setHint(null)} onFocus={(event) => show(event.target)} onBlur={() => setHint(null)} onKeyDown={(event) => { if (event.key === 'Escape') setHint(null); }}>
    {children}
    {hint && createPortal(<div id={id} role="tooltip" style={{ left: hint.left, top: hint.top }} className="pointer-events-none fixed z-[120] max-w-[320px] whitespace-pre-wrap break-words rounded-lg border border-primary/30 bg-elevated px-3 py-2 text-xs text-foreground shadow-xl">{hint.label}</div>, document.body)}
  </div>;
}
