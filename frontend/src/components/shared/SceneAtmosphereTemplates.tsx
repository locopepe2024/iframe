"use client";
import { SCENE_ATMOSPHERE_TEMPLATES } from "@/lib/sceneAtmosphereTemplates";
export default function SceneAtmosphereTemplates({ onApply }: {
    onApply: (template: (typeof SCENE_ATMOSPHERE_TEMPLATES)[number]) => void;
}) {
    return <details className="rounded-lg border border-glass-border p-3">
        <summary className="min-h-11 cursor-pointer text-sm text-foreground">Prompt 模板 · 氛围</summary>
        <p className="mb-2 text-xs text-text-muted">选择完整方案替换当前光影设置，可在面板中继续调整。</p>
        <div className="grid grid-cols-3 gap-2">{SCENE_ATMOSPHERE_TEMPLATES.map(template =>
            <button key={template.id} type="button" onClick={() => onApply(template)}
                className="min-h-11 rounded border border-glass-border px-2 py-2 text-sm text-text-secondary hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{template.title}</button>)}
        </div>
    </details>;
}
