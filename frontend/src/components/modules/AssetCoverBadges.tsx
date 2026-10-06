export default function AssetCoverBadges({ planCount, failed, error }: { planCount: number; failed: boolean; error?: string }) {
    if (planCount === 0 && !failed) return null;

    return (
        <div className="absolute top-2 left-2 z-30 flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-1" aria-label="资产状态">
            {failed && (
                <span className="max-w-full truncate rounded bg-red-950/90 px-2 py-1 text-[0.625rem] text-red-200" title={error || "Generation failed"}>
                    Generation failed
                </span>
            )}
            {planCount > 0 && <span className="max-w-full truncate rounded bg-surface/90 px-2 py-1 text-xs text-foreground">拍摄计划 · {planCount} 条</span>}
        </div>
    );
}
