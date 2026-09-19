"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Users, MapPin, Box, Check, X, Send, Loader2, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ExtractionPreview {
    characters: { name: string; description?: string }[];
    scenes: { name: string; description?: string }[];
    props: { name: string; description?: string }[];
}

interface EntityConfirmModalProps {
    isOpen: boolean;
    preview: ExtractionPreview | null;
    currentCounts: { characters: number; scenes: number; props: number };
    onConfirm: () => void;
    onDiscard: () => void;
    onRefine: (instruction: string) => Promise<void>;
    feedback: string[];
    isRefining: boolean;
}

export default function EntityConfirmModal({
    isOpen,
    preview,
    currentCounts,
    onConfirm,
    onDiscard,
    onRefine,
    feedback,
    isRefining,
}: EntityConfirmModalProps) {
    const t = useTranslations("script");
    const [instruction, setInstruction] = useState("");
    const [refineError, setRefineError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setInstruction("");
            setRefineError(null);
        }
    }, [isOpen]);

    if (!preview) return null;

    const sections = [
        { key: "characters" as const, icon: Users, items: preview.characters, prev: currentCounts.characters },
        { key: "scenes" as const, icon: MapPin, items: preview.scenes, prev: currentCounts.scenes },
        { key: "props" as const, icon: Box, items: preview.props, prev: currentCounts.props },
    ];

    const submitRefinement = async () => {
        const value = instruction.trim();
        if (!value || isRefining || feedback.length >= 12) return;
        setRefineError(null);
        try {
            await onRefine(value);
            setInstruction("");
        } catch (error: any) {
            setRefineError(String(error?.response?.data?.detail || error?.message || t("analysisRefineFailed")));
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] grid place-items-center bg-overlay backdrop-blur-sm"
                    onClick={() => { if (!isRefining) onDiscard(); }}
                >
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="relative mx-3 flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <header className="px-6 py-5 border-b border-glass-border">
                            <h2 className="font-display text-display font-medium text-foreground">
                                {t("extractConfirmTitle")}
                            </h2>
                            <p className="text-xs text-text-secondary mt-1">
                                {t("extractConfirmSubtitle")}
                            </p>
                        </header>

                        {/* Body */}
                        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] md:overflow-hidden">
                            <div className="space-y-4 overflow-y-auto px-5 py-4 md:px-6">
                                {sections.map(({ key, icon: Icon, items, prev }) => (
                                    <div key={key} className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                                            <Icon size={14} />
                                            <span className="font-medium">{t(`entityKind_${key}`)}</span>
                                            <span className="ml-auto text-xs opacity-70">{prev} → {items.length}</span>
                                        </div>
                                        {items.length > 0 ? (
                                            <div className="flex flex-wrap gap-1.5">
                                                {items.map((item, i) => (
                                                    <span key={i} className="inline-flex items-center rounded-md border border-glass-border bg-surface-inset px-2 py-0.5 text-xs text-foreground" title={item.description}>
                                                        {item.name}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : <p className="text-xs italic text-text-tertiary">{t("noEntities")}</p>}
                                    </div>
                                ))}
                            </div>

                            <div className="flex min-h-[260px] flex-col border-t border-glass-border bg-surface/45 md:min-h-0 md:border-l md:border-t-0">
                                <div className="flex items-center gap-2 border-b border-glass-border px-4 py-3 text-sm font-medium text-foreground">
                                    <MessageSquare size={15} />
                                    {t("analysisRefineTitle")}
                                </div>
                                <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
                                    <div className="max-w-[92%] rounded-md bg-surface-inset px-3 py-2 text-xs leading-5 text-text-secondary">
                                        {feedback.length ? t("analysisDraftUpdated") : t("analysisRefineReady")}
                                    </div>
                                    {feedback.map((item, index) => (
                                        <div key={`${index}:${item}`} className="ml-auto max-w-[92%] rounded-md bg-primary/15 px-3 py-2 text-xs leading-5 text-foreground">
                                            {item}
                                        </div>
                                    ))}
                                    {isRefining ? (
                                        <div className="inline-flex items-center gap-2 text-xs text-text-muted">
                                            <Loader2 size={13} className="animate-spin" />
                                            {t("analysisRefining")}
                                        </div>
                                    ) : null}
                                    {refineError ? <p className="text-xs leading-5 text-status-failed-fg">{refineError}</p> : null}
                                </div>
                                <div className="border-t border-glass-border p-3">
                                    <label htmlFor="analysis-refinement" className="mb-1.5 block text-xs text-text-secondary">{t("analysisRefineLabel")}</label>
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            id="analysis-refinement"
                                            value={instruction}
                                            maxLength={2000}
                                            rows={3}
                                            disabled={isRefining}
                                            onChange={(event) => setInstruction(event.target.value)}
                                            onKeyDown={(event) => {
                                                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                    event.preventDefault();
                                                    void submitRefinement();
                                                }
                                            }}
                                            placeholder={t("analysisRefinePlaceholder")}
                                            className="min-h-[72px] flex-1 resize-none rounded-md border border-glass-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 disabled:opacity-50"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void submitRefinement()}
                                            disabled={!instruction.trim() || isRefining || feedback.length >= 12}
                                            aria-label={t("analysisRefineSend")}
                                            className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                        >
                                            {isRefining ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        </button>
                                    </div>
                                    {feedback.length >= 12 ? <p className="mt-1.5 text-xs text-text-muted">{t("analysisRefineLimit")}</p> : null}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-glass-border">
                            <button
                                onClick={onDiscard}
                                disabled={isRefining}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-foreground hover:bg-hover-bg transition-colors"
                            >
                                <X size={14} />
                                {t("extractDiscard")}
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={isRefining}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
                            >
                                <Check size={14} />
                                {t("extractApply")}
                            </button>
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
