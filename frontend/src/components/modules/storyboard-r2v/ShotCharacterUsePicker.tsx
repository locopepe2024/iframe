"use client";

import type { AssetReferenceIndexEntry, EpisodeCharacterUse } from "@/lib/api";
import { AssetIndexPreview } from "@/components/shared/AssetIndexPreview";

type FrameLook = {
    id: string;
    character_ids?: string[];
    character_use_ids?: Record<string, string>;
};

export function relevantCharacterUses(frame: FrameLook, uses: EpisodeCharacterUse[]): EpisodeCharacterUse[] {
    const characters = new Set(frame.character_ids || []);
    const selected = frame.character_use_ids || {};
    return uses.filter((use) => characters.has(use.project_character_id)
        || characters.has(use.selected_asset_id)
        || !!selected[use.project_character_id]);
}

export default function ShotCharacterUsePicker({
    frame, uses, assetIndex, busy, onSelect, onInsertReference,
}: {
    frame: FrameLook;
    uses: EpisodeCharacterUse[];
    assetIndex?: AssetReferenceIndexEntry[];
    busy: boolean;
    onSelect: (use: EpisodeCharacterUse) => void;
    onInsertReference: (use: EpisodeCharacterUse, assetName: string) => void;
}) {
    const relevant = relevantCharacterUses(frame, uses);
    const characterIds = Array.from(new Set(relevant.map((use) => use.project_character_id)));
    if (!characterIds.length) return null;
    return <section aria-label="本镜头角色造型" className="mb-2 rounded-lg border border-glass-border bg-glass px-3 py-2 text-xs text-text-secondary">
        <div className="mb-2 font-medium text-foreground">本镜头角色造型</div>
        <div className="space-y-2">
            {characterIds.map((characterId) => {
                const options = relevant.filter((use) => use.project_character_id === characterId);
                const chosen = options.find((use) => use.use_id === frame.character_use_ids?.[characterId]);
                const entry = chosen && assetIndex?.find((item) => item.asset_type === "character"
                    && item.asset_id === chosen.selected_asset_id
                    && item.variants.some((variant) => variant.id === chosen.selected_variant_id));
                return <div key={characterId} className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`shot-look-${frame.id}-${characterId}`} className="min-w-24">{characterId}</label>
                    <select id={`shot-look-${frame.id}-${characterId}`} aria-label={`${characterId} 镜头造型`}
                        value={chosen?.use_id || ""} disabled={busy}
                        onChange={(event) => {
                            const next = options.find((use) => use.use_id === event.target.value);
                            if (next) onSelect(next);
                        }}
                        className="min-w-40 rounded border border-glass-border bg-surface-inset px-2 py-1 text-foreground">
                        <option value="">选择已确认造型</option>
                        {options.map((use) => <option key={use.use_id} value={use.use_id}>{use.label} · {use.condition || use.selected_source_scope}</option>)}
                    </select>
                    {chosen && <>
                        {entry && <div className="h-10 w-10 overflow-hidden rounded border border-glass-border">
                            <AssetIndexPreview asset={{ ...entry, variant_id: chosen.selected_variant_id }} alt={chosen.label} />
                        </div>}
                        <span>来源：{chosen.selected_source_scope} / {chosen.selected_asset_id} / {chosen.selected_variant_id} · 包 r{chosen.source_pack_revision}</span>
                        {entry && <button type="button" onClick={() => onInsertReference(chosen, entry.name)}
                            className="rounded border border-glass-border px-2 py-1 text-foreground hover:bg-hover-bg">
                            将造型引用加入提示词
                        </button>}
                    </>}
                </div>;
            })}
        </div>
        <p className="mt-2 text-text-muted">选择只作用于本镜头。生成前请核对首帧与提示词中的角色引用。</p>
    </section>;
}
