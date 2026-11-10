"use client";

import type { OptimizerProvider } from "@/lib/api";
export type { OptimizerProvider } from "@/lib/api";

export const OPTIMIZATION_SKILLS = [
    ["minimax-h3-director", "MiniMax H3 导演", "h3"],
    ["seedance-prompt", "Seedance 提示词", "seedance"],
    ["seedance-camera", "Seedance 运镜", "seedance"],
    ["sequence-continuity", "连续性", "both"],
    ["director-style", "导演风格", "both"],
] as const;

export function defaultOptimizationSkills(modelId: string, provider: OptimizerProvider): string[] {
    if (provider === "minimax_context_ir") return [];
    const model = modelId.toLowerCase();
    if (model.includes("h3")) return ["minimax-h3-director"];
    if (model.includes("seedance")) return ["seedance-prompt"];
    return [];
}

export function compatibleOptimizationSkills(modelId: string, provider: OptimizerProvider, skills: string[]): string[] {
    if (provider === "minimax_context_ir") return [];
    const model = modelId.toLowerCase();
    const family = model.includes("h3") ? "h3" : model.includes("seedance") ? "seedance" : "";
    return skills.filter((id) => OPTIMIZATION_SKILLS.some(([candidate, , target]) => candidate === id && (!family || target === family || target === "both")));
}

interface OptimizerSelectorProps {
    provider: OptimizerProvider;
    options: { id: OptimizerProvider; label: string }[];
    loading: boolean;
    error: string;
    onRetry: () => void;
    modelId?: string;
    skills: string[];
    onProviderChange: (provider: OptimizerProvider) => void;
    onToggleSkill: (skillId: string) => void;
}

/** Shared optimizer choice used by both the unified Shot Design and legacy VideoCreator surfaces. */
export default function OptimizerSelector({ provider, options, loading, error, onRetry, modelId = "", skills, onProviderChange, onToggleSkill }: OptimizerSelectorProps) {
    const model = modelId.toLowerCase();
    const family = model.includes("h3") ? "h3" : model.includes("seedance") ? "seedance" : "";
    const availableSkills = provider === "minimax_context_ir" ? [] : OPTIMIZATION_SKILLS.filter(([, , target]) => !family || target === family || target === "both");
    return (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <label className="inline-flex items-center gap-1.5">
                <span>优化器</span>
                <select
                    disabled={loading || !!error}
                    value={loading || error ? "" : provider}
                    onChange={(event) => onProviderChange(event.target.value as OptimizerProvider)}
                    className="rounded border border-glass-border bg-surface px-1.5 py-1 text-[11px] text-foreground"
                    aria-label="选择提示词优化器"
                >
                    {(loading || error) && <option value="">{loading ? "加载优化器…" : "优化器加载失败"}</option>}
                    {options.filter((option) => option.id !== "minimax_context_ir" || !family || family === "h3")
                        .map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
            </label>
            {error && <span role="alert">{error} <button type="button" onClick={onRetry}>重试</button></span>}
            {availableSkills.length > 0 && <span>技能</span>}
            {availableSkills.map(([id, label]) => (
                <label key={id} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={skills.includes(id)} onChange={() => onToggleSkill(id)} />
                    {label}
                </label>
            ))}
        </div>
    );
}
