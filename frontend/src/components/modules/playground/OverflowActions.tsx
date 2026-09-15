'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export default function OverflowActions({ label, actions }: {
  label: string;
  actions: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div ref={ref} className="relative ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => {
        const rect = trigger.current!.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - actions.length * 44 - 16)), left: Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152)) });
        setOpen(!open);
      }} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">
      <MoreHorizontal size={18} />
    </button>
    {open && createPortal(<div ref={menu} style={position} onClick={(event) => event.stopPropagation()} role="menu" aria-label={label} className="fixed z-[100] w-36 rounded-xl border border-glass-border bg-elevated p-1 shadow-xl"
      onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}>
      {actions.map((action) => <button key={action.label} type="button" role="menuitem"
        className={`block min-h-10 w-full rounded-lg px-3 text-left text-xs hover:bg-hover-bg focus:bg-hover-bg ${action.danger ? 'text-status-failed-fg' : 'text-foreground'}`}
        onClick={() => { setOpen(false); action.onClick(); }}>{action.label}</button>)}
    </div>, document.body)}
  </div>;
}
