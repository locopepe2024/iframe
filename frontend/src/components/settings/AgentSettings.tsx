'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { agentRequest } from '@/lib/api';
import MemorySettingsDialog from '@/components/modules/playground/MemorySettingsDialog';

type FactCategory = {
  id: string;
  display_name: string;
  auto_capture_enabled: boolean;
  auto_recall_enabled: boolean;
};
type CategorySwitch = 'auto_capture_enabled' | 'auto_recall_enabled';

export default function AgentSettings() {
  const zh = useLocale() === 'zh';
  const [memoryEnabled, setMemoryEnabled] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<FactCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      agentRequest<{ enabled: boolean }>('/memory-settings'),
      agentRequest<{ categories: FactCategory[] }>('/fact-categories'),
    ]).then(([memory, facts]) => {
      if (!cancelled) {
        setMemoryEnabled(memory.enabled);
        setCategories(facts.categories);
      }
    }).catch(() => { if (!cancelled) setError(zh ? '无法加载 Agent 设置，请重试。' : 'Could not load Agent settings. Please retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [zh]);

  async function toggleMemory() {
    if (memoryEnabled === null || busy) return;
    setBusy('memory'); setError('');
    try {
      const result = await agentRequest<{ enabled: boolean }>('/memory-settings', 'PATCH', { enabled: !memoryEnabled });
      setMemoryEnabled(result.enabled);
    } catch { setError(zh ? '记忆设置保存失败，请重试。' : 'Could not save memory settings. Please retry.'); }
    finally { setBusy(null); }
  }

  async function toggleCategory(category: FactCategory, field: CategorySwitch) {
    if (busy) return;
    setBusy(category.id); setError('');
    try {
      const result = await agentRequest<{ category: FactCategory }>(`/fact-categories/${encodeURIComponent(category.id)}`, 'PATCH', { [field]: !category[field] });
      setCategories(current => current.map(item => item.id === category.id ? result.category : item));
    } catch { setError(zh ? '事实类别设置保存失败，请重试。' : 'Could not save fact category settings. Please retry.'); }
    finally { setBusy(null); }
  }

  return <div className="space-y-6 text-sm text-foreground">
    <section className="rounded-xl border border-glass-border bg-surface p-5">
      <h2 className="font-semibold">{zh ? 'Agent 会话记忆' : 'Agent conversation memory'}</h2>
      <p className="mt-1 text-xs leading-5 text-text-muted">{zh ? '这些设置适用于你的所有会话。关闭记忆不会删除已保存的内容。' : 'These settings apply to all your sessions. Turning memory off does not delete saved content.'}</p>
      {loading && <p role="status" className="mt-3 text-xs text-text-muted">{zh ? '加载中…' : 'Loading…'}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-status-failed-fg">{error}</p>}
      <label className="mt-4 flex min-h-11 items-center justify-between gap-3">
        <span>{zh ? '跨会话自动召回' : 'Cross-session memory recall'}</span>
        <input type="checkbox" aria-label={zh ? '跨会话自动召回' : 'Cross-session memory recall'} checked={memoryEnabled ?? false} disabled={memoryEnabled === null || busy !== null} onChange={() => { void toggleMemory(); }} className="h-4 w-4 accent-primary" />
      </label>
      <button type="button" className="mt-3 min-h-10 rounded-lg border border-glass-border px-3 text-xs hover:bg-hover-bg" onClick={() => setMemoryDialogOpen(true)}>{zh ? '管理已确认记忆' : 'Manage confirmed memories'}</button>
    </section>
    <section className="rounded-xl border border-glass-border bg-surface p-5">
      <h2 className="font-semibold">{zh ? '个人事实类别' : 'Personal fact categories'}</h2>
      <p className="mt-1 text-xs leading-5 text-text-muted">{zh ? '自动保存与自动召回分别控制。关闭某一类别不会删除已有事实。' : 'Automatic capture and recall are separate. Disabling a category does not delete existing facts.'}</p>
      <div className="mt-4 space-y-1">
        {categories.map(category => <div key={category.id} className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-lg border-b border-border-subtle py-2">
          <span className="min-w-32 text-xs">{category.display_name}</span>
          <div className="flex flex-wrap gap-5">
            {(['auto_capture_enabled', 'auto_recall_enabled'] as const).map(field => <label key={field} className="flex min-h-10 items-center gap-2 text-xs text-text-secondary">
              <span>{field === 'auto_capture_enabled' ? (zh ? '自动保存' : 'Auto capture') : (zh ? '自动召回' : 'Auto recall')}</span>
              <input type="checkbox" aria-label={`${category.display_name} ${field === 'auto_capture_enabled' ? (zh ? '自动保存' : 'Auto capture') : (zh ? '自动召回' : 'Auto recall')}`} checked={category[field]} disabled={loading || busy !== null} onChange={() => { void toggleCategory(category, field); }} className="h-4 w-4 accent-primary" />
            </label>)}
          </div>
        </div>)}
      </div>
    </section>
    {memoryDialogOpen && <MemorySettingsDialog onClose={() => {
      setMemoryDialogOpen(false);
      void agentRequest<{ enabled: boolean }>('/memory-settings').then(result => setMemoryEnabled(result.enabled)).catch(() => setError(zh ? '无法重新读取记忆设置，请重试。' : 'Could not refresh memory settings. Please retry.'));
    }} />}
  </div>;
}
