'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, Search, Trash2, X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { agentRequest } from '@/lib/api';

export interface CreativeSkill {
  id: string; name: string; category: string; targets: string[]; version: string;
  description: string; source: string; source_revision: string; license: string;
  license_text: string; revision: string; adaptation: string; instructions: string;
  enabled?: boolean;
}
interface SkillInventory { catalog: CreativeSkill[]; installed: CreativeSkill[] }

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-glass-border px-3 text-sm text-foreground hover:bg-hover-bg disabled:opacity-50 disabled:cursor-not-allowed';

function SkillDetails({ skill, english }: { skill: CreativeSkill; english: boolean }) {
  return <details className="mt-2 text-sm text-text-secondary">
    <summary className="cursor-pointer py-2">{english ? 'Instructions and source' : '内容与来源'}</summary>
    <p className="my-2 whitespace-pre-wrap leading-6">{skill.instructions}</p>
    <p className="my-2">{skill.adaptation}</p>
    <a className="inline-flex max-w-full items-center gap-1 text-primary underline" href={skill.source} target="_blank" rel="noreferrer">
      <ExternalLink size={14} className="shrink-0" /> GitHub · {skill.source_revision.slice(0, 8)}
    </a>
    <details className="mt-2"><summary className="cursor-pointer py-2">{skill.license}</summary><pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs">{skill.license_text}</pre></details>
  </details>;
}

export default function SkillsSettings() {
  const english = useLocale() !== 'zh';
  const [inventory, setInventory] = useState<SkillInventory>({ catalog: [], installed: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await agentRequest<SkillInventory>('/skills');
      if (mounted.current) setInventory(data);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Skill request failed'); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, [open]);

  async function mutate(skill: CreativeSkill, method: string, body?: unknown) {
    if (operation.current) return;
    operation.current = true;
    setBusy(skill.id); setError(''); setNotice('');
    try {
      await agentRequest(`/skills/${encodeURIComponent(skill.id)}`, method, body);
      const data = await agentRequest<SkillInventory>('/skills');
      if (mounted.current) {
        setInventory(data);
        setNotice(english ? 'Skills updated' : 'Skill 已更新');
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Skill request failed'); }
    finally { operation.current = false; if (mounted.current) setBusy(null); }
  }

  const feedback = <>
    {error && <p role="alert" className="py-2 text-sm text-status-failed-fg">{error}</p>}
    {notice && <p role="status" className="py-2 text-sm text-primary">{notice}</p>}
    {loading && <p role="status" className="flex items-center gap-2 py-3 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />{english ? 'Loading...' : '加载中…'}</p>}
  </>;
  const found = inventory.catalog.filter(skill => `${skill.name} ${skill.category} ${skill.targets.join(' ')} ${skill.description}`.toLowerCase().includes(query.toLowerCase().trim()));

  return <section className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass-border pb-4">
      <h2 className="text-lg font-semibold">{english ? 'Installed Skills' : '已安装 Skills'} <span className="text-sm text-text-muted">{inventory.installed.length}</span></h2>
      <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => { setOpen(true); setQuery(''); void refresh(); }}><Download size={16} />{english ? 'Get Skills' : '获取 Skill'}</button>
    </div>
    {!open && feedback}
    {!loading && !error && inventory.installed.length === 0 && <p className="py-8 text-sm text-text-muted">{english ? 'No installed Skills' : '暂无已安装 Skill'}</p>}
    {inventory.installed.map(skill => <article key={skill.id} className="min-w-0 border-b border-glass-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words text-sm font-medium">{skill.name}</h3><p className="mt-1 text-xs text-text-muted">{skill.targets.join(' · ')} · v{skill.version}</p></div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(skill.enabled)} disabled={busy !== null} onChange={event => void mutate(skill, 'PATCH', { enabled: event.target.checked })} aria-label={`${english ? 'Enable' : '启用'} ${skill.name}`} />{english ? 'Enabled' : '启用'}</label>
          <button className={buttonClass} type="button" disabled={busy !== null} title={english ? 'Uninstall' : '卸载'} aria-label={`${english ? 'Uninstall' : '卸载'} ${skill.name}`} onClick={() => void mutate(skill, 'DELETE')}><Trash2 size={16} /></button>
          {busy === skill.id && <Loader2 size={16} className="animate-spin" />}
        </div>
      </div>
      <SkillDetails skill={skill} english={english} />
    </article>)}
    {open && <dialog ref={dialog} aria-labelledby="skill-catalog-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false); } }} className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[85dvh] overflow-y-auto rounded-lg border border-glass-border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/60 md:p-6">
      <div className="flex items-center justify-between gap-3"><h2 id="skill-catalog-title" className="text-lg font-semibold">{english ? 'Get Skills' : '获取 Skill'}</h2><button className={buttonClass} type="button" onClick={() => setOpen(false)} aria-label={english ? 'Close' : '关闭'} title={english ? 'Close' : '关闭'}><X size={18} /></button></div>
      <label className="mt-4 flex items-center gap-2 rounded-md border border-glass-border px-3 focus-within:ring-2 focus-within:ring-primary"><Search size={16} className="shrink-0 text-text-muted" /><input autoFocus className="min-h-11 w-full min-w-0 bg-transparent text-sm outline-none" aria-label={english ? 'Search Skills' : '搜索 Skill'} placeholder={english ? 'Search Skills' : '搜索 Skill'} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {feedback}
      {!loading && !error && !found.length && <p className="py-8 text-sm text-text-muted">{english ? 'No matching Skills' : '没有匹配的 Skill'}</p>}
      {found.map(skill => {
        const saved = inventory.installed.find(item => item.id === skill.id);
        const current = saved?.revision === skill.revision;
        return <article key={skill.id} className="min-w-0 border-b border-glass-border py-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{skill.name}</h3><p className="mt-1 text-xs text-text-muted">{skill.targets.join(' · ')} · {skill.category} · v{skill.version} · {skill.license}</p></div>
            <button type="button" className={buttonClass} disabled={current || loading || busy !== null} onClick={() => void mutate(skill, 'POST', { revision: skill.revision })} aria-label={`${current ? (english ? 'Installed' : '已安装') : saved ? (english ? 'Update' : '更新') : (english ? 'Install' : '安装')} ${skill.name}`}>
              {busy === skill.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{current ? (english ? 'Installed' : '已安装') : saved ? (english ? 'Update' : '更新') : (english ? 'Install' : '安装')}
            </button>
          </div>
          <p className="mt-2 text-sm text-text-secondary">{skill.description}</p>
          <SkillDetails skill={skill} english={english} />
        </article>;
      })}
    </dialog>}
  </section>;
}
