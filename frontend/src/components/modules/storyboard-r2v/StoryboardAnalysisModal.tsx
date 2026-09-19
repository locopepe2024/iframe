"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Film, Loader2, MessageSquare, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StoryboardDraftFrame } from "@/lib/storyboardAnalysis";

interface StoryboardAnalysisModalProps {
    isOpen: boolean;
    draft: StoryboardDraftFrame[] | null;
    feedback: string[];
    existingShotCount: number;
    isBusy: boolean;
    onRefine: (instruction: string) => Promise<void>;
    onApply: () => Promise<void>;
    onDiscard: () => void;
}

export default function StoryboardAnalysisModal({
    isOpen,
    draft,
    feedback,
    existingShotCount,
    isBusy,
    onRefine,
    onApply,
    onDiscard,
}: StoryboardAnalysisModalProps) {
    const t = useTranslations("storyboardGen");
    const [instruction, setInstruction] = useState("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setInstruction("");
            setError(null);
        }
    }, [isOpen]);

    if (!draft) return null;

    const refine = async () => {
        const value = instruction.trim();
        if (!value || isBusy || feedback.length >= 12) return;
        setError(null);
        try {
            await onRefine(value);
            setInstruction("");
        } catch (reason: any) {
            setError(String(reason?.response?.data?.detail || reason?.message || t("draftRefineFailed")));
        }
    };

    const apply = async () => {
        setError(null);
        try {
            await onApply();
        } catch (reason: any) {
            setError(String(reason?.response?.data?.detail || reason?.message || t("draftApplyFailed")));
        }
    };

    return (
        <AnimatePresence>
            {isOpen ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[130] grid place-items-center bg-overlay p-3 backdrop-blur-sm sm:p-5"
                    onClick={() => { if (!isBusy) onDiscard(); }}
                >
                    <motion.div
                        initial={{ scale: 0.97, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.97, opacity: 0 }}
                        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]"
                        onClick={event => event.stopPropagation()}
                    >
                        <header className="flex items-start gap-3 border-b border-glass-border px-5 py-4 sm:px-6">
                            <Film size={17} className="mt-0.5 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                                <h2 className="text-display font-medium text-foreground">{t("draftTitle")}</h2>
                                <p className="mt-1 text-xs leading-5 text-text-secondary">
                                    {t("draftSubtitle", { count: draft.length })}
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label={t("close")}
                                disabled={isBusy}
                                onClick={onDiscard}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-hover-bg hover:text-foreground disabled:opacity-40"
                            >
                                <X size={15} />
                            </button>
                        </header>

                        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.75fr)] md:overflow-hidden">
                            <div className="space-y-2 overflow-y-auto px-4 py-4 sm:px-6">
                                {draft.map((frame, index) => (
                                    <article key={index} className="rounded-md border border-glass-border bg-surface-inset px-3 py-2.5">
                                        <div className="flex items-center gap-2 text-xs text-text-muted">
                                            <span className="font-mono text-primary">{t("draftShot", { index: index + 1 })}</span>
                                            {frame.scene_ref_name ? <span className="truncate">{frame.scene_ref_name}</span> : null}
                                            {frame.duration ? <span className="ml-auto shrink-0">{frame.duration}s</span> : null}
                                        </div>
                                        <p className="mt-1 text-sm leading-5 text-foreground">
                                            {frame.action_summary || frame.action_description || t("draftUntitled")}
                                        </p>
                                        {frame.dialogue ? (
                                            <p className="mt-1 text-xs leading-5 text-text-secondary">
                                                {frame.speaker ? `${frame.speaker}: ` : ""}{typeof frame.dialogue === "string" ? frame.dialogue : JSON.stringify(frame.dialogue)}
                                            </p>
                                        ) : null}
                                    </article>
                                ))}
                            </div>

                            <section className="flex min-h-[300px] flex-col border-t border-glass-border bg-surface/45 md:min-h-0 md:border-l md:border-t-0">
                                <div className="flex items-center gap-2 border-b border-glass-border px-4 py-3 text-sm font-medium text-foreground">
                                    <MessageSquare size={15} />
                                    {t("draftRefineTitle")}
                                </div>
                                <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
                                    <div className="max-w-[92%] rounded-md bg-surface-inset px-3 py-2 text-xs leading-5 text-text-secondary">
                                        {feedback.length ? t("draftUpdated") : t("draftReady")}
                                    </div>
                                    {feedback.map((item, index) => (
                                        <div key={`${index}:${item}`} className="ml-auto max-w-[92%] rounded-md bg-primary/15 px-3 py-2 text-xs leading-5 text-foreground">
                                            {item}
                                        </div>
                                    ))}
                                    {isBusy ? (
                                        <div className="inline-flex items-center gap-2 text-xs text-text-muted">
                                            <Loader2 size={13} className="animate-spin" />
                                            {t("draftWorking")}
                                        </div>
                                    ) : null}
                                    {error ? <p className="text-xs leading-5 text-status-failed-fg">{error}</p> : null}
                                </div>
                                <div className="border-t border-glass-border p-3">
                                    <label htmlFor="storyboard-refinement" className="mb-1.5 block text-xs text-text-secondary">
                                        {t("draftRefineLabel")}
                                    </label>
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            id="storyboard-refinement"
                                            value={instruction}
                                            maxLength={2000}
                                            rows={3}
                                            disabled={isBusy}
                                            onChange={event => setInstruction(event.target.value)}
                                            onKeyDown={event => {
                                                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                    event.preventDefault();
                                                    void refine();
                                                }
                                            }}
                                            placeholder={t("draftRefinePlaceholder")}
                                            className="min-h-[72px] flex-1 resize-none rounded-md border border-glass-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 disabled:opacity-50"
                                        />
                                        <button
                                            type="button"
                                            aria-label={t("draftRefineSend")}
                                            disabled={!instruction.trim() || isBusy || feedback.length >= 12}
                                            onClick={() => void refine()}
                                            className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
                                        >
                                            {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        </button>
                                    </div>
                                    {feedback.length >= 12 ? <p className="mt-1.5 text-xs text-text-muted">{t("draftRefineLimit")}</p> : null}
                                </div>
                            </section>
                        </div>

                        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-glass-border px-4 py-3 sm:px-6">
                            {existingShotCount > 0 ? (
                                <p className="mr-auto text-xs text-accent">{t("draftApplyWarning", { count: existingShotCount })}</p>
                            ) : null}
                            <button
                                type="button"
                                disabled={isBusy}
                                onClick={onDiscard}
                                className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-text-secondary hover:bg-hover-bg hover:text-foreground disabled:opacity-40"
                            >
                                <X size={14} /> {t("draftDiscard")}
                            </button>
                            <button
                                type="button"
                                disabled={isBusy || draft.length === 0}
                                onClick={() => void apply()}
                                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40"
                            >
                                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                {t("draftApply")}
                            </button>
                        </footer>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
