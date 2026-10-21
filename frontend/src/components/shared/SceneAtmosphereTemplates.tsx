"use client";
import { useState } from "react";
import { SCENE_ATMOSPHERE_TEMPLATES } from "@/lib/sceneAtmosphereTemplates";
export default function SceneAtmosphereTemplates({ onApply }: {
    onApply: (template: (typeof SCENE_ATMOSPHERE_TEMPLATES)[number]) => void;
}) {
    const [query, setQuery] = useState("");
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const templates = SCENE_ATMOSPHERE_TEMPLATES.filter(template => {
        const text = `${template.title} ${template.keywords || ""}`.toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    });
    return <details className="rounded-lg border border-glass-border p-3">
        <summary className="min-h-11 cursor-pointer text-sm text-foreground">Prompt 模板 · 氛围</summary>
        <p className="mb-2 text-xs text-text-muted">选择完整方案替换当前光影设置，可在面板中继续调整。</p>
        <input aria-label="搜索氛围模板" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="搜索名称或关键词，如：蓝调、秋天 傍晚、Blue hour"
            className="mb-3 min-h-11 w-full rounded border border-glass-border bg-input-bg px-3 text-sm text-foreground" />
        {!templates.length && <p role="status" className="text-xs text-text-muted">没有匹配的氛围模板</p>}
        <div className="grid grid-cols-3 gap-2">{templates.map(template =>
            <button key={template.id} type="button" onClick={() => onApply(template)}
                className="min-h-11 rounded border border-glass-border px-2 py-2 text-sm text-text-secondary hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{template.title}</button>)}
        </div>
    </details>;
}
