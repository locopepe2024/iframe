'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function ScriptDocumentActions({ title, disabled, deleting, onOpen, onDelete }: {
  title: string;
  disabled: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('scriptEditor.document');
  const common = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    const width = menu.current.offsetWidth;
    setPosition({
      top: bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4),
      left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)),
    });
    menu.current.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    const reposition = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" disabled={disabled} aria-label={t(deleting ? 'deleting' : 'moreActions', { title })} title={t('moreActions', { title })}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      className="grid size-11 shrink-0 place-items-center rounded text-text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
      {deleting ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={t('moreActions', { title })} style={position}
      className="fixed z-[80] w-40 rounded-md border border-white/15 bg-[#101116] p-1 text-foreground shadow-xl" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget !== trigger.current) setOpen(false);
      }} onKeyDown={event => {
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
        if (next !== null) { event.preventDefault(); items[next]?.focus(); }
      }}>
      <button type="button" role="menuitem" onClick={() => { close(); onOpen(); }} className="flex min-h-11 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"><ExternalLink size={14} />{common('open')}</button>
      <button type="button" role="menuitem" onClick={() => { close(); onDelete(); }} className="flex min-h-11 w-full items-center gap-2 rounded px-3 text-left text-sm text-red-400 hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"><Trash2 size={14} />{common('delete')}</button>
    </div>, document.body)}
  </>;
}
