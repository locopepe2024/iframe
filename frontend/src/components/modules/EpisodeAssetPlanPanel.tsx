import type { AssetPlanEntry } from "@/lib/episodeAssetPlan";

export default function EpisodeAssetPlanPanel({ entries, onUse }: {
    entries: AssetPlanEntry[];
    onUse?: (prompt: string) => void;
}) {
    if (!entries.length) return null;
    return (
        <section className="border-b border-glass-border px-6 py-3 text-sm" aria-label="拍摄计划约束">
            <h3 className="font-medium text-foreground">拍摄计划约束</h3>
            <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
                {entries.map(entry => (
                    <div key={entry.key} className="flex items-start justify-between gap-3 border-l-2 border-primary/50 pl-3">
                        <div className="min-w-0">
                            <p className="font-medium text-foreground">{entry.sceneLabel}</p>
                            <p className="text-xs leading-5 text-text-secondary break-words">{entry.details.join(" · ")}</p>
                        </div>
                        {onUse && <button type="button" onClick={() => onUse(entry.prompt)} className="shrink-0 text-xs text-primary hover:underline">加入提示词</button>}
                    </div>
                ))}
            </div>
        </section>
    );
}
