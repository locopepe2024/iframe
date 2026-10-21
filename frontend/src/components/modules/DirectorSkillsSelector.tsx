"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import type { useDirectorSkills } from "@/lib/directorSkills";

type SelectionState = ReturnType<typeof useDirectorSkills>;
export default function DirectorSkillsSelector({ state, disabled = false }: { state: SelectionState; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const panel = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        panel.current?.querySelector<HTMLInputElement>("input")?.focus();
        return () => trigger.current?.focus();
    }, [open]);
    const stale = state.selected.filter(s => !state.catalog.some(t => t.id === s.id && t.revision === s.revision));
    const tasks = state.catalog.filter(task => (!category || task.category === category) && `${task.label} ${task.description}`.includes(query));
    const blocked = disabled || state.loading || state.saving;
    return <>
        <button ref={trigger} type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-border px-3 text-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-primary" aria-expanded={open}>
            创作 Skills · {state.loading ? "加载中" : state.error ? "加载或保存失败" : `已选 ${state.selected.length}`}
        </button>
        {open && createPortal(<div ref={panel} role="dialog" aria-modal="true" aria-label="创作 Skills" className="fixed inset-y-0 right-0 z-[140] flex w-full max-w-2xl flex-col border-l border-border bg-background p-5 shadow-2xl" onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Tab") {
                const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,summary,[tabindex="0"]') ?? []);
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }}>
            <header className="flex items-center justify-between"><h3 className="font-semibold">创作 Skills</h3><button type="button" aria-label="关闭创作 Skills" className="flex h-11 w-11 items-center justify-center" onClick={() => setOpen(false)}><X size={18} /></button></header>
            <label className="my-4 flex items-center gap-2 rounded-md border border-border px-3"><Search size={16} /><input aria-label="搜索创作 Skills" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索方法" className="min-h-11 w-full bg-transparent text-sm outline-none" /></label>
            <nav aria-label="创作 Skill 分类" className="mb-4 flex flex-wrap gap-2">
                {["", ...Array.from(new Set(state.catalog.map(task => task.category)))].map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)} className={`min-h-11 rounded-md border px-3 text-sm ${category === name ? "border-primary text-primary" : "border-border text-text-secondary"}`}>{name || "全部"}</button>)}
            </nav>
            {state.error && <div role="alert" className="mb-3 text-sm text-red-300">{state.error}<button type="button" onClick={state.retry} className="ml-3 min-h-11 underline">重试</button></div>}
            {stale.length > 0 && <p role="alert" className="mb-3 text-sm text-amber-200">{stale.map(s => s.id).join("、")} 版本已变化，请移除后重新选择。<button type="button" disabled={blocked} onClick={() => void state.update(state.selected.filter(s => !stale.includes(s)))} className="min-h-11 underline">移除失效选择</button></p>}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">{tasks.map(task => {
                    const selected = state.selected.some(s => s.id === task.id);
                    return <button type="button" key={task.id} aria-pressed={selected} title={task.description} disabled={blocked} onClick={() => void state.update(selected ? state.selected.filter(s => s.id !== task.id) : [...state.selected, { id: task.id, revision: task.revision }])} className={`min-h-14 rounded-md border p-2 text-sm focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>{selected ? "✓ " : ""}{task.label}</button>;
                })}</div>
                {!state.loading && tasks.length === 0 && <p className="py-6 text-sm text-text-secondary">没有匹配的方法</p>}
                <details className="mt-5 text-sm text-text-secondary"><summary className="cursor-pointer py-3">方法说明与来源</summary>{tasks.map(task => <div key={task.id} className="mb-4"><p className="text-foreground">{task.label} · v{task.version}</p><p>{task.description}</p><p className="break-all text-xs">{task.source} · {task.source_revision}</p></div>)}</details>
            </div>
            <p className="mt-4 text-xs leading-5 text-text-secondary">未选择时使用基础流程。所选方法仅用于下一次生成，结果仍需检查和采用。</p>
        </div>, document.body)}
    </>;
}
