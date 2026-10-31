"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { extractErrorDetail } from "@/lib/utils";
import { nextCrowdCharacterName } from "@/lib/crowdNaming";
import type { ExtraRosterEntry, Series } from "@/store/projectStore";

export default function CrowdGroupEditor({ group, series, onClose, onSaved, onEditCharacter }: {
  group: ExtraRosterEntry;
  series: Series;
  onClose: () => void;
  onSaved: (series: Series) => void;
  onEditCharacter?: (id: string) => void;
}) {
  const [draft, setDraft] = useState(group);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const linked = series.characters?.find(character => character.id === draft.visual_asset_id);
  const save = async (nextDraft = draft) => {
    setSaving(true);
    setError("");
    try {
      const latest = await api.getSeries(series.id);
      const roster = [...(latest.extra_roster ?? [])];
      const index = roster.findIndex((item: ExtraRosterEntry) => item.extra_id === nextDraft.extra_id);
      if (index < 0) roster.push(nextDraft);
      else roster[index] = nextDraft;
      const updated = await api.updateSeries(series.id, { extra_roster: roster });
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(extractErrorDetail(cause, "保存群演失败"));
    } finally {
      setSaving(false);
    }
  };
  const createCharacter = async () => {
    setSaving(true);
    setError("");
    try {
      const character = await api.createSeriesCharacter(series.id, {
        name: nextCrowdCharacterName(draft.label, (series.characters ?? []).map(item => item.name)),
        persona: draft.label,
        description: [draft.body_build, draft.wardrobe, draft.palette].filter(Boolean).join("；"),
      });
      const next = { ...draft, kind: "fixed_extra" as const, visual_asset_id: character.id };
      setDraft(next);
      await save(next);
    } catch (cause) {
      setError(extractErrorDetail(cause, "创建角色失败"));
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={`编辑群演：${group.label}`} className="w-full max-w-lg rounded border border-glass-border bg-surface p-5 shadow-2xl">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-foreground">群演资产</h2>
        <button type="button" onClick={onClose} aria-label="关闭" title="关闭" className="text-text-secondary"><X size={18} /></button></div>
      <div className="space-y-3">
        <label className="block text-xs text-text-secondary">名称<input value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} className="mt-1 w-full border border-glass-border bg-input-bg p-2 text-sm text-foreground" /></label>
        <label className="block text-xs text-text-secondary">类型<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as ExtraRosterEntry["kind"], visual_asset_id: null })} className="mt-1 w-full border border-glass-border bg-input-bg p-2 text-sm text-foreground"><option value="fixed_extra">固定群演</option><option value="extra_template">人群模板</option></select></label>
        <label className="block text-xs text-text-secondary">体态<input value={draft.body_build ?? ""} onChange={event => setDraft({ ...draft, body_build: event.target.value })} className="mt-1 w-full border border-glass-border bg-input-bg p-2 text-sm text-foreground" /></label>
        <label className="block text-xs text-text-secondary">服装与识别点<textarea value={draft.wardrobe ?? ""} onChange={event => setDraft({ ...draft, wardrobe: event.target.value })} className="mt-1 w-full border border-glass-border bg-input-bg p-2 text-sm text-foreground" /></label>
        {draft.kind === "fixed_extra" && <div className="flex flex-wrap items-center gap-2">
          <select aria-label="关联角色资产" value={draft.visual_asset_id ?? ""} onChange={event => setDraft({ ...draft, visual_asset_id: event.target.value || null })} className="min-w-0 flex-1 border border-glass-border bg-input-bg p-2 text-sm text-foreground">
            <option value="">未关联角色</option>{(series.characters ?? []).map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>
          <button type="button" disabled={saving || Boolean(draft.visual_asset_id)} onClick={() => void createCharacter()} className="border border-primary px-2 py-2 text-xs text-primary disabled:opacity-50">新建角色</button>
          {linked && onEditCharacter && <button type="button" onClick={() => { onClose(); onEditCharacter(linked.id); }} className="border border-primary px-2 py-2 text-xs text-primary">编辑角色</button>}
        </div>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end"><button type="button" disabled={saving || !draft.label.trim()} onClick={() => void save()} className="bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "保存中…" : "保存群演"}</button></div>
      </div>
    </section>
  </div>;
}
