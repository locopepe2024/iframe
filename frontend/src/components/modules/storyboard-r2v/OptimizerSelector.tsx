"use client";

export type OptimizerProvider = "minimax_context_ir" | "gpt" | "qwen" | "deepseek" | "glm";

export const OPTIMIZATION_SKILLS = [
    ["minimax-h3-director", "MiniMax H3 导演"],
    ["seedance-prompt", "Seedance 提示词"],
    ["seedance-camera", "Seedance 运镜"],
    ["sequence-continuity", "连续性"],
    ["director-style", "导演风格"],
] as const;

interface OptimizerSelectorProps {
    provider: OptimizerProvider;
    skills: string[];
    onProviderChange: (provider: OptimizerProvider) => void;
    onToggleSkill: (skillId: string) => void;
}

/** Shared optimizer choice used by both the unified Shot Design and legacy VideoCreator surfaces. */
export default function OptimizerSelector({ provider, skills, onProviderChange, onToggleSkill }: OptimizerSelectorProps) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <label className="inline-flex items-center gap-1.5">
                <span>优化器</span>
                <select
                    value={provider}
                    onChange={(event) => onProviderChange(event.target.value as OptimizerProvider)}
                    className="rounded border border-glass-border bg-surface px-1.5 py-1 text-[11px] text-foreground"
                    aria-label="选择提示词优化器"
                >
                    <option value="minimax_context_ir">MiniMax 官方 IR</option>
                    <option value="gpt">GPT</option>
                    <option value="qwen">Qwen</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="glm">GLM</option>
                </select>
            </label>
            <span>技能</span>
            {OPTIMIZATION_SKILLS.map(([id, label]) => (
                <label key={id} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={skills.includes(id)} onChange={() => onToggleSkill(id)} />
                    {label}
                </label>
            ))}
        </div>
    );
}
