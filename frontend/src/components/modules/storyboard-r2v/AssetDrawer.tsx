"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, X, User, MapPin, Package } from "lucide-react";
import { useTranslations } from "next-intl";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import { selectedVariantUrl } from "@/lib/characterImage";

interface AssetDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    characters: any[];
    scenes: any[];
    props: any[];
    onSelectAsset: (type: string, name: string) => void;
    selectedVariantIds?: Record<string, string[]>;
    onToggleVariant?: (assetId: string, variantId: string, primaryVariantId?: string) => void;
}

function getAssetThumbnail(item: any, type: "character" | "scene" | "prop"): string | null {
    if (type === "character") {
        const refUrl = selectedVariantUrl(item.reference_sheet);
        if (refUrl) return refUrl;
        const asset = item.full_body_asset || item.headshot_asset;
        if (asset?.selected_id && asset.variants?.length) {
            const selected = asset.variants.find((v: any) => v.id === asset.selected_id);
            if (selected) return selected.url;
        }
        if (asset?.variants?.[0]) return asset.variants[0].url;
        if (item.avatar_url) return item.avatar_url;
    } else {
        const asset = item.image_asset;
        if (asset?.selected_id && asset.variants?.length) {
            const selected = asset.variants.find((v: any) => v.id === asset.selected_id);
            if (selected) return selected.url;
        }
        if (asset?.variants?.[0]) return asset.variants[0].url;
    }
    return null;
}

export default function AssetDrawer({
    isOpen,
    onClose,
    characters,
    scenes,
    props,
    onSelectAsset,
    selectedVariantIds = {},
    onToggleVariant,
}: AssetDrawerProps) {
    const t = useTranslations("storyboardR2V");

    const hasAnyAssets = characters.length > 0 || scenes.length > 0 || props.length > 0;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/30 z-40"
                        onClick={onClose}
                    />
                    {/* Drawer */}
                    <motion.div
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-y-0 right-0 w-80 z-50 bg-surface border-l border-glass-border shadow-2xl flex flex-col"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border bg-glass backdrop-blur-xl shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                            <h3 className="text-sm font-semibold text-foreground">{t("assetLibrary")}</h3>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-lg hover:bg-hover-bg text-text-secondary hover:text-foreground transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                            {!hasAnyAssets ? (
                                <div className="text-center py-8">
                                    <p className="text-sm text-text-secondary">{t("noAssetsAvailable")}</p>
                                    <p className="text-xs text-text-secondary/60 mt-1">{t("noAssetsHint")}</p>
                                </div>
                            ) : (
                                <>
                                    {/* Characters */}
                                    {characters.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <User size={12} className="text-blue-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("characters")}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {characters.map((c: any, i: number) => {
                                                    const thumb = getAssetThumbnail(c, "character");
                                                    return (
                                                        <button
                                                            key={c.id}
                                                            onClick={() => {
                                                                onSelectAsset(`character${i + 1}`, c.name);
                                                                onClose();
                                                            }}
                                                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-glass-border bg-glass hover:border-foreground/30 hover:bg-hover-bg transition-all duration-200 group"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg bg-glass overflow-hidden flex items-center justify-center">
                                                                {thumb ? (
                                                                    <PreviewImage src={thumb} alt={c.name} className="w-full h-full" noLightbox />
                                                                ) : (
                                                                    <User size={16} className="text-text-secondary/40" />
                                                                )}
                                                            </div>
                                                            <span className="text-[0.6875rem] text-foreground group-hover:text-primary truncate w-full text-center">{c.name}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Scenes */}
                                    {scenes.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <MapPin size={12} className="text-green-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("scenes")}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {scenes.map((s: any) => {
                                                    const thumb = getAssetThumbnail(s, "scene");
                                                    return (
                                                        <button
                                                            key={s.id}
                                                            onClick={() => {
                                                                onSelectAsset("scene", s.name);
                                                                onClose();
                                                            }}
                                                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-glass-border bg-glass hover:border-foreground/30 hover:bg-hover-bg transition-all duration-200 group"
                                                        >
                                                            <div className="w-12 h-12 rounded-lg bg-glass overflow-hidden flex items-center justify-center">
                                                                {thumb ? (
                                                                    <PreviewImage src={thumb} alt={s.name} className="w-full h-full" noLightbox />
                                                                ) : (
                                                                    <MapPin size={16} className="text-text-secondary/40" />
                                                                )}
                                                            </div>
                                                            <span className="text-[0.6875rem] text-foreground group-hover:text-primary truncate w-full text-center">{s.name}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Props */}
                                    {props.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <Package size={12} className="text-orange-400" />
                                                <span className="text-[0.6875rem] font-medium text-text-secondary uppercase tracking-wide">{t("props")}</span>
                                            </div>
                                            <div className="space-y-2">
                                                {props.map((p: any) => {
                                                    const thumb = getAssetThumbnail(p, "prop");
                                                    const variants: any[] = p.image_asset?.variants ?? [];
                                                    const primaryId = p.image_asset?.selected_id ?? variants[0]?.id;
                                                    const explicit = selectedVariantIds[p.id];
                                                    const effectiveSelected = explicit?.length ? explicit : (primaryId ? [primaryId] : []);
                                                    return (
                                                        <div key={p.id} className="rounded-lg border border-glass-border bg-glass p-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => onSelectAsset("prop", p.name)}
                                                                className="flex w-full items-center gap-2 text-left hover:text-primary"
                                                            >
                                                                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-surface-inset flex items-center justify-center">
                                                                    {thumb ? (
                                                                        <PreviewImage src={thumb} alt={p.name} className="h-full w-full" noLightbox />
                                                                    ) : (
                                                                        <Package size={16} className="text-text-secondary/40" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <span className="block truncate text-[0.75rem] font-medium">{p.name}</span>
                                                                    <span className="block text-[0.625rem] text-text-muted">
                                                                        {t("productViewsSelected", { selected: effectiveSelected.length, total: variants.length })}
                                                                    </span>
                                                                </div>
                                                            </button>
                                                            {variants.length > 1 && onToggleVariant ? (
                                                                <div className="mt-2 grid grid-cols-4 gap-1.5" aria-label={t("selectProductViews")}>
                                                                    {variants.map((variant: any, variantIndex: number) => {
                                                                        const selected = effectiveSelected.includes(variant.id);
                                                                        const label = variant.reference_view_role
                                                                            || variant.reference_distance
                                                                            || t("productViewNumber", { number: variantIndex + 1 });
                                                                        return (
                                                                            <button
                                                                                key={variant.id}
                                                                                type="button"
                                                                                title={label}
                                                                                aria-pressed={selected}
                                                                                onClick={() => onToggleVariant(p.id, variant.id, primaryId)}
                                                                                className={`relative aspect-square overflow-hidden rounded border transition-colors ${selected ? "border-primary ring-1 ring-primary/60" : "border-glass-border hover:border-foreground/30"}`}
                                                                            >
                                                                                <PreviewImage src={variant.url} alt={label} className="h-full w-full" noLightbox />
                                                                                {selected ? (
                                                                                    <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-white">
                                                                                        <Check size={10} strokeWidth={3} />
                                                                                    </span>
                                                                                ) : null}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : null}
                                                            <p className="mt-1.5 text-[0.625rem] leading-4 text-text-muted">
                                                                {t("productViewsHint")}
                                                            </p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
