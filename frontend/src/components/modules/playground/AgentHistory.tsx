'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { agentRequest, type ChatMessage, type ChatSession } from '@/lib/api';

/** Read-only access to persisted conversations, independent of the live composer. */
export default function AgentHistory() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    let cancelled = false;
    setSessions([]); setSessionId(''); setMessages([]); setQuery(''); setError(''); setLoading(true);
    agentRequest<{ sessions: ChatSession[] }>('/sessions').then(result => {
      if (cancelled) return;
      setSessions(result.sessions);
      setSessionId(result.sessions[0]?.id || '');
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '加载对话失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, revision]);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setMessages([]); setError(''); setLoading(true);
    agentRequest<{ messages: ChatMessage[] }>(`/sessions/${encodeURIComponent(sessionId)}/messages`).then(result => {
      if (!cancelled) setMessages(result.messages);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '加载消息失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sessionId]);

  const filtered = messages.filter(message => message.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-medium text-text-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
      <History size={15} aria-hidden="true" />对话历史
    </button>
    {open && createPortal(<dialog ref={dialog} aria-label="对话历史" onClose={() => setOpen(false)}
      className="fixed inset-0 m-auto w-[min(720px,calc(100vw-24px))] max-h-[85dvh] rounded-2xl border border-glass-border bg-elevated p-0 text-foreground shadow-2xl backdrop:bg-black/60">
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-glass-border px-4 py-2">
          <h2 className="text-base font-semibold">对话历史</h2>
          <button type="button" aria-label="关闭对话历史" onClick={() => dialog.current?.close()} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-hover-bg focus-visible:ring-2 focus-visible:ring-primary"><X size={18} /></button>
        </header>
        <div className="grid shrink-0 gap-3 p-4 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-text-secondary">会话
            <select value={sessionId} onChange={e => { setSessionId(e.target.value); setQuery(''); }} className="min-h-11 min-w-0 rounded-xl border border-glass-border bg-surface-inset px-3 text-foreground focus-visible:ring-2 focus-visible:ring-primary">
              {!sessions.length && <option value="">暂无对话</option>}
              {sessions.map(session => <option key={session.id} value={session.id}>{session.title} · {new Date(session.updated_at * 1000).toLocaleString()}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-text-secondary">搜索当前会话
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入消息关键词" className="min-h-11 min-w-0 rounded-xl border border-glass-border bg-surface-inset px-3 text-foreground focus-visible:ring-2 focus-visible:ring-primary" />
          </label>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">
          {loading ? <p role="status" className="py-4 text-sm text-text-secondary">正在加载对话…</p> : error ? <div role="alert" className="text-sm text-status-failed-fg">{error}<button type="button" onClick={() => setRevision(r => r + 1)} className="ml-2 min-h-11 underline">重试</button></div> : <>
            <p role="status" className="mb-3 text-xs text-text-secondary">{messages.length ? `共 ${messages.length} 条消息，显示 ${filtered.length} 条` : '暂无历史消息'}</p>
            {messages.length > 0 && !filtered.length && <p className="text-sm text-text-secondary">没有匹配的消息</p>}
            {filtered.map(message => <article key={message.id} className="mb-3 rounded-xl border border-glass-border bg-glass p-3">
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-text-secondary"><span>{message.role === 'user' ? '你' : 'Agent'}</span>{message.created_at && <time>{new Date(message.created_at * 1000).toLocaleString()}</time>}</div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
            </article>)}
          </>}
        </div>
      </div>
    </dialog>, document.body)}
  </>;
}
