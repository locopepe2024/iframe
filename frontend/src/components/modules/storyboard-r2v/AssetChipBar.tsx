"use client";

import { useState } from "react";
import { Check, ChevronDown, Images } from "lucide-react";
import { useTranslations } from "next-intl";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import type { AssetReferenceIndexEntry } from "@/lib/api";
import { effectiveReferenceIndex } from "@/lib/assetReferenceIndex";

interface AssetChipBarProps {
    characters: any[];
    scenes: any[];
    props: any[];
    assetIndex?: AssetReferenceIndexEntry[];
    selectedVariantIds?: Record<string, string[]>;
    onInsertAsset: (type: string, name: string) => void;
    onToggleVariant?: (assetId: string, variantId: string, primaryVariantId?: string) => void;
}

export default function AssetChipBar({
    characters,
    scenes,
    props,
    assetIndex,
    selectedVariantIds = {},
    onInsertAsset,
    onToggleVariant,
}: AssetChipBarProps) {
    const t = useTranslations("storyboardR2V");
    const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
    const colors = { character: "bg-blue-400", scene: "bg-teal-400", prop: "bg-orange-400" };
    const assets = effectiveReferenceIndex(assetIndex, characters, scenes, props);

    if (assets.length === 0) return null;

    return (
        <div className="flex flex-wrap items-start gap-2 py-1">
            {assets.map((asset) => {
                const variants = asset.variants;
                const primaryId = asset.selected_variant_id ?? variants[0]?.id;
                const explicit = selectedVariantIds[asset.asset_id];
                const selected = explicit?.length ? explicit : (primaryId ? [primaryId] : []);
                const expanded = expandedAssetId === asset.asset_id;
                return (
                    <div key={`${asset.asset_type}:${asset.asset_id}`} className="relative">
                        <div className="inline-flex min-h-9 max-w-[240px] items-stretch overflow-hidden rounded-md border border-glass-border bg-surface-inset">
                            <button
                                type="button"
                                onClick={() => onInsertAsset(asset.asset_type, asset.name)}
                                className="inline-flex min-w-0 items-center gap-1.5 px-3 py-1 text-[13px] text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/55"
                            >
                                <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${colors[asset.asset_type]}`} />
                                <span className="truncate">{asset.name}</span>
                            </button>
                            {variants.length > 1 && onToggleVariant ? (
                                <button
                                    type="button"
                                    aria-label={t("selectAssetViews", { name: asset.name })}
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedAssetId(expanded ? null : asset.asset_id)}
                                    className="inline-flex min-w-9 items-center justify-center gap-1 border-l border-glass-border px-2 text-[0.6875rem] text-text-muted transition-colors hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/55"
                                >
                                    <Images size={13} />
                                    <span>{selected.length}</span>
                                    <ChevronDown size={11} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                                </button>
                            ) : null}
                        </div>
                        {expanded && variants.length > 1 && onToggleVariant ? (
                            <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-glass-border bg-surface p-2 shadow-xl">
                                <p className="mb-2 text-[0.6875rem] text-text-muted">{t("assetViewsForShot")}</p>
                                <div className="grid grid-cols-4 gap-2" role="group" aria-label={t("selectAssetViews", { name: asset.name })}>
                                    {variants.map((variant, index) => {
                                        const active = selected.includes(variant.id);
                                        const label = variant.reference_view_role
                                            || variant.reference_distance
                                            || t("productViewNumber", { number: index + 1 });
                                        return (
                                            <button
                                                key={variant.id}
                                                type="button"
                                                title={label}
                                                aria-label={label}
                                                aria-pressed={active}
                                                onClick={() => onToggleVariant(asset.asset_id, variant.id, primaryId)}
                                                className={`relative aspect-square min-h-11 overflow-hidden rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "border-primary ring-1 ring-primary/60" : "border-glass-border hover:border-foreground/40"}`}
                                            >
                                                <PreviewImage src={variant.url} alt={label} className="h-full w-full" noLightbox />
                                                {active ? <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-white"><Check size={10} strokeWidth={3} /></span> : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="mt-2 text-[0.625rem] leading-4 text-text-muted">{t("assetViewsBudgetHint")}</p>
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
