'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One compact hint for React labels and editor-owned reference tokens. */
export default function FullNameHints({ children, className, ...props }: {
  children: ReactNode; className?: string; 'aria-label'?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const [hint, setHint] = useState<{ label: string; left: number; top: number } | null>(null);
  const hide = () => {
    trigger.current?.removeAttribute('aria-describedby');
    trigger.current = null;
    setHint(null);
  };
  const show = (target: EventTarget) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-full-name]') : null;
    if (!element?.dataset.fullName) { hide(); return; }
    trigger.current?.removeAttribute('aria-describedby');
    trigger.current = element;
    element.setAttribute('aria-describedby', id);
    const rect = element.getBoundingClientRect();
    setHint({ label: element.dataset.fullName, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 100)) });
  };
  useEffect(() => {
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      trigger.current?.removeAttribute('aria-describedby');
    };
  }, []);
  return <div {...props} className={className} onMouseOver={(event) => show(event.target)} onMouseLeave={hide}
    onFocus={(event) => show(event.target)} onBlur={hide} onKeyDown={(event) => { if (event.key === 'Escape') hide(); }}>
    {children}
    {hint && createPortal(<div id={id} role="tooltip" style={{ left: hint.left, top: hint.top, fontSize: 11, lineHeight: '16px' }}
      className="pointer-events-none fixed z-[120] max-w-[280px] whitespace-pre-wrap break-words rounded bg-elevated px-2 py-1 text-foreground shadow-sm">{hint.label}</div>, document.body)}
  </div>;
}
