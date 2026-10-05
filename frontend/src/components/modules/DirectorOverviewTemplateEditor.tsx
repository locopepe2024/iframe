"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

export type OverviewField = { key: string; label: string; purpose: string; enabled: boolean };
export type OverviewTemplate = { revision: number; fields: OverviewField[] };
export type OverviewTemplateState = { source: string; template: OverviewTemplate };

export default function DirectorOverviewTemplateEditor({ scope, id, state, onSaved }: {
    scope: "projects" | "series";
    id: string;
    state: OverviewTemplateState;
    onSaved: (state: OverviewTemplateState) => void;
}) {
    const [fields, setFields] = useState(state.template.fields);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => setFields(state.template.fields), [state.template]);
    const update = (index: number, patch: Partial<OverviewField>) => setFields(current => current.map((field, at) => at === index ? { ...field, ...patch } : field));
    const move = (index: number, target: number) => setFields(current => {
        if (target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    });
    const save = async () => {
        setError("");
        const keys = fields.map(field => field.key.trim());
        if (!fields.some(field => field.enabled) || keys.some(key => !/^[a-z][a-z0-9_]{1,39}$/.test(key)) || new Set(keys).size !== keys.length || fields.some(field => !field.label.trim() || !field.purpose.trim())) {
            setError("至少启用一个字段；字段标识需唯一且使用小写英文、数字或下划线，名称和分析要求不能为空。");
            return;
        }
        setBusy(true);
        try {
            const saved = await api.saveDirectorOverviewTemplate(scope, id, { revision: state.template.revision, fields: fields.map(field => ({ ...field, key: field.key.trim(), label: field.label.trim(), purpose: field.purpose.trim() })) });
            onSaved(saved);
        } catch (reason) { setError(reason instanceof Error ? reason.message : "模板保存失败"); }
        finally { setBusy(false); }
    };
    const inherit = async () => {
        setBusy(true); setError("");
        try { onSaved(await api.inheritDirectorOverviewTemplate(id)); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "恢复继承失败"); }
        finally { setBusy(false); }
    };
    return <section className="space-y-3 border-t border-border pt-4" aria-label="导演总览模板">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="text-sm font-semibold">导演总览模板</h3><p className="text-xs text-text-muted">{state.source === "project" ? "本集自定义" : state.source === "series" ? "继承系列" : "系统默认"} · 修订 {state.template.revision}</p></div>
            <div className="flex gap-2">
                {scope === "projects" && state.source === "project" && <button type="button" className="glass-button min-h-9 px-3 text-xs" disabled={busy} onClick={inherit}>恢复继承</button>}
                <button type="button" className="glass-button inline-flex min-h-9 items-center gap-1 px-3 text-xs" disabled={busy} onClick={save}><Save size={14} />保存模板</button>
            </div>
        </div>
        <p className="text-xs text-text-muted">模板用于下一次生成或修订解读；修改模板不会改写现有草稿和已确认结论。</p>
        <div className="space-y-2">{fields.map((field, index) => <div key={index} className="grid gap-2 border-b border-border pb-2 md:grid-cols-[auto_minmax(7rem,0.8fr)_minmax(8rem,1fr)_minmax(12rem,2fr)_auto] md:items-center">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={field.enabled} onChange={event => update(index, { enabled: event.target.checked })} />启用</label>
            <input aria-label={`字段标识 ${index + 1}`} className="min-w-0 rounded border border-border bg-background px-2 py-2 text-xs" value={field.key} onChange={event => update(index, { key: event.target.value })} />
            <input aria-label={`字段名称 ${index + 1}`} className="min-w-0 rounded border border-border bg-background px-2 py-2 text-xs" value={field.label} onChange={event => update(index, { label: event.target.value })} />
            <input aria-label={`分析要求 ${index + 1}`} className="min-w-0 rounded border border-border bg-background px-2 py-2 text-xs" value={field.purpose} onChange={event => update(index, { purpose: event.target.value })} />
            <div className="flex gap-1"><button type="button" title="上移" aria-label={`上移 ${field.label}`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={15} /></button><button type="button" title="下移" aria-label={`下移 ${field.label}`} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={15} /></button><button type="button" title="删除字段" aria-label={`删除 ${field.label}`} disabled={fields.length === 1} onClick={() => setFields(current => current.filter((_, at) => at !== index))}><Trash2 size={15} /></button></div>
        </div>)}</div>
        {fields.length < 16 && <button type="button" className="glass-button inline-flex min-h-9 items-center gap-1 px-3 text-xs" onClick={() => setFields(current => [...current, { key: "", label: "", purpose: "", enabled: true }])}><Plus size={14} />添加字段</button>}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </section>;
}
