'use client';

import { MessageSquare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type PlaygroundSession } from './usePlaygroundStore';

interface SessionRailProps {
  sessions: PlaygroundSession[];
  activeSessionId: string | null;
  onSelect: (session: PlaygroundSession) => void;
  onCreate: () => void;
  compact?: boolean;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function SessionRail({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  compact = false,
}: SessionRailProps) {
  const t = useTranslations('playground.sessions');

  if (compact) {
    return (
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3 lg:hidden">
        <select
          value={activeSessionId || ''}
          onChange={(event) => {
            const session = sessions.find((item) => item.id === event.target.value);
            if (session) onSelect(session);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-glass-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
          aria-label={t('selectLabel')}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>{session.title}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-glass-border bg-glass text-foreground hover:border-primary/50 hover:text-primary"
          title={t('new')}
        >
          <Plus size={17} />
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-glass-border bg-surface-inset/30 lg:flex">
      <div className="border-b border-border-subtle p-3">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary transition hover:bg-primary/15"
        >
          <Plus size={16} />
          {t('new')}
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2 scrollbar-thin">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session)}
              className={`flex min-h-14 w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                active
                  ? 'border border-primary/30 bg-primary/10 text-foreground'
                  : 'border border-transparent text-text-secondary hover:bg-hover-bg hover:text-foreground'
              }`}
            >
              <MessageSquare size={15} className={active ? 'mt-0.5 text-primary' : 'mt-0.5 text-text-muted'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">{session.title}</span>
                <span className="mt-1 block truncate font-mono text-[0.5625rem] text-text-muted">
                  {formatUpdatedAt(session.updated_at)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
