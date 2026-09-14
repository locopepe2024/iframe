'use client';

import { MessageSquare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { createPlaygroundSession, openPlaygroundSession } from './playgroundSessionController';
import { usePlaygroundStore } from './usePlaygroundStore';

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function PlaygroundSessionSubnav() {
  const t = useTranslations('playground.sessions');
  const sessions = usePlaygroundStore((state) => state.sessions);
  const activeSessionId = usePlaygroundStore((state) => state.activeSessionId);

  const handleCreate = async () => {
    try {
      await createPlaygroundSession();
    } catch (error) {
      console.error('[Playground] Failed to create session:', error);
    }
  };

  return (
    <div className="ml-4 mt-1 border-l border-border-subtle pl-2" aria-label={t('navigationLabel')}>
      <button
        type="button"
        onClick={handleCreate}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <Plus size={15} aria-hidden="true" />
        <span>{t('new')}</span>
      </button>

      <div className="mt-1 space-y-0.5">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                void openPlaygroundSession(session).catch((error) => {
                  console.error('[Playground] Failed to load session:', error);
                });
              }}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'group flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                active
                  ? 'bg-primary/10 text-foreground'
                  : 'text-text-muted hover:bg-hover-bg hover:text-foreground',
              )}
            >
              <MessageSquare
                size={14}
                aria-hidden="true"
                className={clsx('shrink-0', active ? 'text-primary' : 'group-hover:text-foreground')}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{session.title}</span>
                <span className="mt-0.5 block font-mono text-[0.5625rem] text-text-muted">
                  {formatUpdatedAt(session.updated_at)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
