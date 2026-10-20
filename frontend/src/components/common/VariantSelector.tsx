"use client";

import React, { useState, useEffect, useRef } from 'react';
import { ImageAsset, ImageVariant } from '@/store/projectStore';
import { Trash2, Check, ChevronLeft, ChevronRight, Layers, X, Maximize2, Star, Save } from 'lucide-react';
import { API_URL, authenticatedFetch } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { useTranslations } from "next-intl";

interface VariantSelectorProps {
    asset: ImageAsset | undefined;
    filmstripTitle?: string;
    currentImageUrl?: string; // Fallback/Legacy URL
    onSelect: (variantId: string) => void | Promise<void>;
    onDelete: (variantId: string) => void | Promise<void>;
    onFavorite?: (variantId: string, isFavorited: boolean) => void | Promise<void>;
    onSetCover?: (variantId: string) => Promise<void>;
    coverVariantId?: string | null;
    variantNameLabel?: string;
    variantNameFallback?: (index: number) => string;
    onRename?: (variantId: string, displayName: string) => Promise<void>;
    onGenerate: (batchSize: number) => void;
    isGenerating: boolean;
    generatingBatchSize?: number; // Persisted batch size from parent/store
    className?: string;
    viewerClassName?: string;
    aspectRatio?: string; // e.g., "9:16", "16:9", "1:1"
    previewLocator?: {
        scope: 'global' | 'series' | 'project';
        containerId: string;
        assetType: 'character' | 'scene' | 'prop';
        assetId: string;
    };
}

// Use the API_URL constant for consistent behavior
const getApiBaseUrl = () => API_URL;

export const VariantSelector: React.FC<VariantSelectorProps> = ({
    asset,
    filmstripTitle,
    currentImageUrl,
    onSelect,
    onDelete,
    onFavorite,
    onRename,
    onSetCover,
    coverVariantId,
    variantNameLabel = "素材名称",
    variantNameFallback = (index: number) => `未命名素材 ${index + 1}`,
    onGenerate,
    isGenerating,
    generatingBatchSize: propGeneratingBatchSize,
    className = "",
    viewerClassName = "",
    aspectRatio = "9:16",
    previewLocator,
}) => {
    const t = useTranslations("assets");
    const [batchSize, setBatchSize] = useState(1);
    const [localGeneratingBatchSize, setLocalGeneratingBatchSize] = useState(1); // Track the batch size when generation started locally
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [pendingSelection, setPendingSelection] = useState<string | null>(null);
    const [pendingDeletions, setPendingDeletions] = useState<string[]>([]);
    const [variantName, setVariantName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [renameError, setRenameError] = useState(false);
    const [coverBusy, setCoverBusy] = useState(false);
    const [coverError, setCoverError] = useState(false);
    const [favoriteBusy, setFavoriteBusy] = useState<string[]>([]);
    const [favoriteError, setFavoriteError] = useState(false);
    const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
    const [previewErrors, setPreviewErrors] = useState<string[]>([]);
    const [previewAttempt, setPreviewAttempt] = useState(0);
    const prevIsGenerating = useRef(isGenerating);

    // Automatically save batchSize when generation starts
    useEffect(() => {
        // Detect when isGenerating changes from false to true (generation just started)
        if (isGenerating && !prevIsGenerating.current) {
            setLocalGeneratingBatchSize(batchSize);
        }
        prevIsGenerating.current = isGenerating;
    }, [isGenerating, batchSize]);

    // Use prop if provided (for persistence), otherwise use local state
    const displayGeneratingBatchSize = propGeneratingBatchSize || localGeneratingBatchSize;

    // Determine the image to display
    const variants = (asset?.variants || []).filter(variant => !pendingDeletions.includes(variant.id));
    const selectedId = pendingSelection && variants.some(variant => variant.id === pendingSelection)
        ? pendingSelection
        : pendingDeletions.includes(asset?.selected_id || '') ? variants.at(-1)?.id : asset?.selected_id || variants.find(variant => variant.url === currentImageUrl)?.id || variants[0]?.id;
    const selectedVariant = variants.find(v => v.id === selectedId);
    useEffect(() => {
        setVariantName(selectedVariant?.display_name || '');
        setRenameError(false);
    }, [selectedVariant?.id, selectedVariant?.display_name]);
    const apiBase = getApiBaseUrl();
    const displayUrl = selectedVariant
        ? (previewLocator ? previewUrls[selectedVariant.id] || '' : getAssetUrl(selectedVariant.url))
        : variants.length || pendingDeletions.includes(asset?.selected_id || '') ? '' : getAssetUrl(currentImageUrl);
    const fullImageUrl = selectedVariant ? getAssetUrl(selectedVariant.url) : displayUrl;

    useEffect(() => {
        if (pendingSelection && asset?.selected_id === pendingSelection) setPendingSelection(null);
    }, [asset?.selected_id, pendingSelection]);

    useEffect(() => {
        if (pendingDeletions.length) {
            setPendingDeletions(current => current.filter(id => asset?.variants?.some(variant => variant.id === id)));
        }
    }, [asset?.variants, pendingDeletions.length]);

    const selectVariant = (variantId: string) => {
        setPendingSelection(variantId);
        Promise.resolve().then(() => onSelect(variantId)).catch(() => {
            setPendingSelection(current => current === variantId ? null : current);
        });
    };

    useEffect(() => {
        if (!previewLocator || variants.length === 0) return;
        const controller = new AbortController();
        const objectUrls: string[] = [];
        setPreviewUrls({});
        setPreviewErrors([]);
        variants.forEach((variant) => {
            const params = new URLSearchParams({
                scope: previewLocator.scope,
                container_id: previewLocator.containerId,
                asset_type: previewLocator.assetType,
                asset_id: previewLocator.assetId,
                variant_id: variant.id,
            });
            void authenticatedFetch(`${apiBase}/asset-index/preview?${params}`, { signal: controller.signal })
                .then(async (response) => {
                    if (!response.ok) throw new Error('Asset preview unavailable');
                    const objectUrl = URL.createObjectURL(await response.blob());
                    if (controller.signal.aborted) {
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    objectUrls.push(objectUrl);
                    setPreviewUrls((current) => ({ ...current, [variant.id]: objectUrl }));
                }).catch(() => {
                    if (!controller.signal.aborted) setPreviewErrors((current) => [...current, variant.id]);
                });
        });
        return () => {
            controller.abort();
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [apiBase, previewLocator?.scope, previewLocator?.containerId, previewLocator?.assetType, previewLocator?.assetId, variants.map((variant) => variant.id).join('|'), previewAttempt]);

    const deleteVariant = (variantId: string) => {
        setPendingDeletions(current => [...current, variantId]);
        if (pendingSelection === variantId) setPendingSelection(null);
        Promise.resolve().then(() => onDelete(variantId)).catch(() => {
            setPendingDeletions(current => current.filter(id => id !== variantId));
        });
    };

    const setCover = async () => {
        if (!onSetCover || !selectedVariant || coverBusy) return;
        setCoverBusy(true);
        setCoverError(false);
        try { await onSetCover(selectedVariant.id); }
        catch { setCoverError(true); }
        finally { setCoverBusy(false); }
    };

    const toggleFavorite = async (variantId: string, isFavorited: boolean) => {
        if (!onFavorite || favoriteBusy.includes(variantId)) return;
        setFavoriteBusy(current => [...current, variantId]);
        setFavoriteError(false);
        try { await onFavorite(variantId, isFavorited); }
        catch { setFavoriteError(true); }
        finally { setFavoriteBusy(current => current.filter(id => id !== variantId)); }
    };

    const saveVariantName = async () => {
        if (!onRename || !selectedVariant || savingName) return;
        setSavingName(true);
        try {
            await onRename(selectedVariant.id, variantName.trim());
            setRenameError(false);
        } catch {
            setRenameError(true);
        } finally {
            setSavingName(false);
        }
    };

    // Helper to calculate aspect ratio class
    const getAspectRatioClass = () => {
        switch (aspectRatio) {
            case "16:9": return "aspect-video";
            case "1:1": return "aspect-square";
            case "9:16": return "aspect-[9/16]";
            default: return "aspect-[9/16]";
        }
    };

    return (
        <div className={`flex flex-col gap-4 ${className}`}>
            {/* Main Viewer */}
            <div
                className={`relative w-full ${getAspectRatioClass()} ${viewerClassName} bg-elevated rounded-lg overflow-hidden border border-glass-border group cursor-pointer`}
                onClick={() => fullImageUrl && setZoomedImage(fullImageUrl)}
            >
                {displayUrl ? (
                    <>
                        <img
                            src={displayUrl}
                            alt="Selected Variant"
                            className="w-full h-full object-contain"
                        />
                        {/* Zoom hint */}
                        <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="flex items-center gap-1 px-2 py-1 bg-overlay rounded-md backdrop-blur-sm">
                                <Maximize2 size={12} className="text-foreground/80" />
                                <span className="text-xs text-foreground/80">{t("clickToZoom")}</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col gap-3 items-center justify-center text-text-muted">
                        {selectedVariant && previewLocator ? previewErrors.includes(selectedVariant.id) ? <>
                            <p role="alert">{t("previewLoadFailed")}</p>
                            <button type="button" onClick={(event) => { event.stopPropagation(); setPreviewAttempt((current) => current + 1); }}
                                className="min-h-11 rounded border border-glass-border px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{t("retryPreview")}</button>
                        </> : <p role="status">{t("previewLoading")}</p>
                            : variants.length ? <p role="alert">{t("selectedVariantUnavailable")}</p> : t("noImageGenerated")}
                    </div>
                )}

                {/* Overlay Actions */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                    {selectedVariant && (
                        <button
                            onClick={(e) => { e.stopPropagation(); if (confirm(t("confirmDeleteVariant"))) deleteVariant(selectedVariant.id); }}
                            className="p-2 bg-red-500/80 hover:bg-red-600 text-white rounded-full backdrop-blur-sm"
                            title={t("deleteVariant")}
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>

                {isGenerating && (
                    <div className="absolute inset-0 bg-overlay flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div>
                            <span className="text-white font-medium">{t("generatingVariants", { count: displayGeneratingBatchSize })}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls & Filmstrip */}
            <div className="flex flex-col gap-3">
                {/* Generation Controls */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 bg-elevated rounded-lg p-1 border border-glass-border">
                        {[1, 2, 3, 4].map(size => (
                            <button
                                key={size}
                                onClick={() => setBatchSize(size)}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${batchSize === size
                                    ? 'bg-blue-600 text-white'
                                    : 'text-text-secondary hover:text-foreground hover:bg-hover-bg'
                                    }`}
                            >
                                x{size}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => onGenerate(batchSize)}
                        disabled={isGenerating}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${isGenerating
                            ? 'bg-gray-700 text-text-secondary cursor-not-allowed'
                            : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20'
                            }`}
                    >
                        <Layers size={16} />
                        {t("generate")}
                    </button>
                </div>

                {filmstripTitle && <h4 className="text-xs font-medium text-text-secondary">{filmstripTitle}</h4>}
                {/* Variants Filmstrip */}
                {variants.length > 0 && (
                    <div className="relative">
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent snap-x">
                            {variants.map((variant, index) => {
                                const isSelected = variant.id === selectedId;
                                const isFavorited = variant.is_favorited || false;
                                const url = previewLocator ? previewUrls[variant.id] : getAssetUrl(variant.url);

                                return (
                                    <div
                                        key={variant.id}
                                        className={`
                                            relative flex-shrink-0 w-24 rounded-md overflow-hidden border-2 transition-all snap-start group/variant
                                            ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : isFavorited ? 'border-yellow-500/50' : 'border-transparent hover:border-gray-500'}
                                        `}
                                    >
                                        {/* Clickable image area */}
                                        {url ? <img
                                            src={url}
                                            alt={variant.display_name || variantNameFallback(index)}
                                            loading="lazy"
                                            className="h-20 w-full object-cover cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    selectVariant(variant.id);
                                                }
                                            }}
                                            onClick={() => selectVariant(variant.id)}
                                        /> : <div className="h-20 w-full bg-elevated" />}
                                        <span className="block truncate bg-surface px-1 py-1 text-[0.6875rem] text-foreground" title={variant.display_name || variantNameFallback(index)}>
                                            {variant.display_name || variantNameFallback(index)}
                                        </span>

                                        {/* Selected indicator */}
                                        {isSelected && (
                                            <div className="absolute top-1 left-1 bg-blue-500 rounded-full p-0.5">
                                                <Check size={10} className="text-white" />
                                            </div>
                                        )}

                                        {/* Favorite button */}
                                        {onFavorite && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void toggleFavorite(variant.id, !isFavorited);
                                                }}
                                                className={`absolute top-1 right-1 grid h-11 w-11 place-items-center rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 sm:h-6 sm:w-6 ${isFavorited
                                                    ? 'bg-yellow-500 text-white'
                                                    : 'bg-overlay/50 text-text-secondary sm:opacity-0 sm:group-hover/variant:opacity-100 focus-visible:opacity-100 hover:bg-yellow-500 hover:text-white'
                                                    }`}
                                                type="button"
                                                disabled={favoriteBusy.includes(variant.id)}
                                                aria-pressed={isFavorited}
                                                aria-label={isFavorited ? t("clickToUnfavorite") : t("clickToFavorite")}
                                                title={isFavorited ? t("clickToUnfavorite") : t("clickToFavorite")}
                                            >
                                                <Star size={12} fill={isFavorited ? 'currentColor' : 'none'} />
                                            </button>
                                        )}

                                        {/* Delete button - only show if NOT favorited */}
                                        {!isFavorited && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm(t("confirmDeleteVariant"))) {
                                                        deleteVariant(variant.id);
                                                    }
                                                }}
                                                className="absolute bottom-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded-full text-white opacity-0 group-hover/variant:opacity-100 transition-all"
                                                title={t("deleteVariant")}
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        )}

                                        {/* Favorited protection indicator */}
                                        {isFavorited && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-yellow-900/80 to-transparent py-1 px-1">
                                                <span className="text-[0.5rem] text-yellow-200 font-medium">{t("protected")}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                {onRename && selectedVariant && (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <label htmlFor={`variant-name-${selectedVariant.id}`} className="shrink-0 text-xs text-text-secondary">{variantNameLabel}</label>
                        <input
                            id={`variant-name-${selectedVariant.id}`}
                            value={variantName}
                            maxLength={120}
                            onChange={(event) => { setVariantName(event.target.value); setRenameError(false); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') void saveVariantName(); }}
                            placeholder={variantNameFallback(variants.indexOf(selectedVariant))}
                            className="h-9 min-w-0 flex-1 rounded border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        />
                        <button type="button" onClick={() => void saveVariantName()} disabled={savingName || variantName.trim() === (selectedVariant.display_name || '')} title={`保存${variantNameLabel}`} aria-label={`保存${variantNameLabel}`} className="grid h-11 w-11 shrink-0 place-items-center rounded border border-glass-border text-foreground hover:bg-hover-bg disabled:opacity-50">
                            <Save size={16} />
                        </button>
                        {onSetCover && <button type="button" onClick={() => void setCover()}
                            disabled={coverBusy || coverVariantId === selectedVariant.id}
                            className="min-h-11 shrink-0 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
                            {coverBusy ? "保存中…" : coverVariantId === selectedVariant.id ? "当前角色封面" : "设为角色封面"}
                        </button>}
                    </div>
                )}
                {coverError && <p role="alert" className="text-xs text-red-400">角色封面保存失败，请重试</p>}
                {favoriteError && <p role="alert" className="text-xs text-red-400">收藏更新失败，请重试</p>}
                {renameError && <p role="alert" className="text-xs text-red-400">{variantNameLabel}保存失败</p>}
            </div>

            {/* Lightbox Modal */}
            {zoomedImage && (
                <div
                    className="fixed inset-0 z-[100] bg-overlay flex items-center justify-center p-8"
                    onClick={() => setZoomedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-3 bg-hover-bg hover:bg-hover-bg rounded-full text-foreground transition-colors"
                        onClick={() => setZoomedImage(null)}
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={zoomedImage}
                        alt="Zoomed View"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};
