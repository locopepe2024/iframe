'use client';

import { useEffect, useState } from 'react';
import { agentRequest, type ChatSession, type ChatMessage, type ChatModel } from '@/lib/api';
import { usePlaygroundStore } from './usePlaygroundStore';
import { shortReferenceLabel, referenceName } from './referenceMedia';

export default function ChatPanel({ onUseDraft }: { onUseDraft: (text: string) => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [active, setActive] = useState('');
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState('');
  const draft = usePlaygroundStore(s => s.prompt);
  const media = usePlaygroundStore(s => s.inputMedia);
  const names = usePlaygroundStore(s => s.mediaNames);
  const history = usePlaygroundStore(s => s.history);
  const assetNames = media.map(path => referenceName(path, names, history));
  const current = sessions.find(s => s.id === active);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      agentRequest<{ models: ChatModel[] }>('/models'),
      agentRequest<{ sessions: ChatSession[] }>('/sessions'),
    ]).then(([catalog, list]) => {
      if (cancelled) return;
      let enabled: string[] | null = null;
      try { enabled = JSON.parse(localStorage.getItem('lumenx_uniart_enabled_skus') || 'null'); } catch { /* use catalog */ }
      const available = catalog.models.filter(m => !enabled || enabled.includes(m.id));
      setModels(available); setSessions(list.sessions);
      setActive(list.sessions[0]?.id || '');
      setModel(list.sessions[0]?.model || available[0]?.api_model_id || '');
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setMenu(false);
    if (!active) return;
    setLoading(true);
    agentRequest<{ messages: ChatMessage[] }>(`/sessions/${active}/messages`)
      .then(r => { if (!cancelled) setMessages(r.messages); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '请求失败'); }
    finally { setBusy(false); }
  }
  async function create() {
    const r = await agentRequest<{ session: ChatSession }>('/sessions', 'POST', { model });
    setSessions(s => [r.session, ...s]); setActive(r.session.id);
    return r.session;
  }
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-3">
      <select aria-label="Chat 会话" title={current?.title} disabled={busy || loading} value={active} className="max-w-40 rounded bg-glass p-2 text-sm" onChange={e => { setActive(e.target.value); setModel(sessions.find(s => s.id === e.target.value)?.model || model); }}>
        <option value="">新会话</option>{sessions.map(s => <option key={s.id} value={s.id}>{shortReferenceLabel(s.title)}</option>)}
      </select>
      <button disabled={busy || loading || !model} onClick={() => void action(async () => { await create(); })} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-40">新建</button>
      {current && <button aria-label="管理 Chat 会话" aria-expanded={menu} disabled={busy} onClick={() => { setMenu(!menu); setTitle(current.title); }} className="px-2">...</button>}
      <select aria-label="Agent 模型" disabled={busy || loading} value={model} className="ml-auto max-w-60 rounded bg-glass p-2 text-sm" onChange={e => { const next = e.target.value; void action(async () => { if (active) { const r = await agentRequest<{ session: ChatSession }>(`/sessions/${active}`, 'PATCH', { model: next }); setSessions(s => s.map(x => x.id === active ? r.session : x)); } setModel(next); }); }}>
        {!models.some(m => m.api_model_id === model) && <option value={model}>{model || '请先在设置中获取并选择 Chat 模型'}</option>}
        {models.map(m => <option key={m.id} value={m.api_model_id}>{m.display_name}</option>)}
      </select>
    </div>
    {menu && <div className="flex flex-wrap gap-2 border-b border-border-subtle p-3">
      <input aria-label="会话名称" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} className="rounded bg-glass px-2" />
      <button disabled={busy || !title.trim()} onClick={() => void action(async () => { const r = await agentRequest<{ session: ChatSession }>(`/sessions/${active}`, 'PATCH', { title }); setSessions(s => s.map(x => x.id === active ? r.session : x)); setMenu(false); })}>重命名</button>
      <button disabled={busy} onClick={() => void action(async () => { await agentRequest(`/sessions/${active}`, 'DELETE'); setSessions(s => s.filter(x => x.id !== active)); setActive(''); setMessages([]); setMenu(false); })}>删除</button>
    </div>}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
      {loading && <p className="text-sm text-text-muted">正在加载…</p>}
      {!loading && !messages.length && <p className="text-sm text-text-muted">与 Agent 讨论创意、优化提示词。回复可填入创作草稿，由你确认生成。</p>}
      {messages.map(m => <article key={m.id} className="rounded-xl border border-border-subtle bg-glass p-4">
        <div className="mb-2 text-xs text-text-muted">{m.role === 'user' ? '你' : 'Agent'}</div>
        <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
        {m.role === 'assistant' && <button className="mt-3 rounded border border-border-subtle px-3 py-1 text-xs" onClick={() => onUseDraft(m.content)}>填入创作草稿</button>}
      </article>)}
      {busy && <p className="text-sm text-text-muted">处理中…</p>}
    </div>
    {error && <p role="alert" className="px-4 py-2 text-sm text-red-400">{error}</p>}
    <form className="space-y-2 border-t border-border-subtle p-4" onSubmit={e => { e.preventDefault(); if (!input.trim() || busy || loading) return; void action(async () => { const session = current || await create(); const r = await agentRequest<{ user_message: ChatMessage; assistant_message: ChatMessage }>(`/sessions/${session.id}/messages`, 'POST', { content: input, asset_names: assetNames, context: draft }); setMessages(s => [...s, r.user_message, r.assistant_message]); setInput(''); }); }}>
      {!!assetNames.length && <div className="flex flex-wrap gap-1">{assetNames.map((name, i) => <span key={i} title={name} className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">@{shortReferenceLabel(name)}</span>)}</div>}
      <textarea aria-label="Chat 消息" value={input} maxLength={16000} disabled={busy} onChange={e => setInput(e.target.value)} placeholder="描述你的创意…" className="min-h-24 w-full resize-none rounded-lg bg-glass p-3 text-sm" />
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-text-muted">引用素材名称与当前草稿；不会自动生成媒体。</span><button disabled={busy || loading || !input.trim() || !models.some(m => m.api_model_id === model)} className="rounded-lg border border-border-subtle px-4 py-2 text-sm disabled:opacity-40">发送</button></div>
    </form>
  </section>;
}
