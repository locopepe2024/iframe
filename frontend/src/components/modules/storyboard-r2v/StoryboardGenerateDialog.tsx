"use client";
/**
 * StoryboardGenerateDialog — wraps the LLM-driven '从剧本生成分镜' flow.
 *
 * Per Q grill outcomes:
 *   · Pre-flight runs in the dialog itself (no silent disabled button —
 *     user can always open the dialog and see WHY it's blocked + quick
 *     jump back to the Script step).
 *   · Confirm path replaces existing shots wholesale (clear-and-regenerate
 *     semantics, mirrors how a fresh 提取实体 → 生成分镜 onboarding feels).
 *   · Long-running call surfaces as a project-aware toast (not blocking
 *     overlay) so users can switch projects and learn when the other one
 *     finishes via the global ToastContainer.
 */
import { useMemo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, X, AlertTriangle, ArrowRight, Film, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";

import { api } from "@/lib/api";
import { useDirectorSkills } from "@/lib/directorSkills";
import DirectorSkillsSelector from "@/components/modules/DirectorSkillsSelector";
import type { StoryboardGenerationOptions } from "@/lib/storyboardAnalysis";

interface StoryboardGenerateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Currently-loaded project — all gating reads from here. */
    project: {
        id: string;
        title?: string;
        originalText?: string;
        original_text?: string;
        characters?: any[];
        frames?: any[];
    } | null;
    existingShotCount: number;
    /** Called when the user confirms. Dialog closes immediately; parent
     *  runs the API call in the background with toast feedback. */
    onConfirm: (options?: StoryboardGenerationOptions) => void;
    /** Jump to the Script step (used by the empty-text quick fix link). */
    onJumpToScript?: () => void;
}

export default function StoryboardGenerateDialog({
    isOpen,
    onClose,
    project,
    existingShotCount,
    onConfirm,
    onJumpToScript,
}: StoryboardGenerateDialogProps) {
    const t = useTranslations("storyboardGen");
    const skills = useDirectorSkills(isOpen ? project?.id : undefined, "storyboard");
    const [mode, setMode] = useState<"plan" | "script">("script");
    const [planState, setPlanState] = useState<"loading" | "ready" | "none" | "stale" | "error">("loading");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!isOpen || !project?.id) return;
        let active = true;
        setPlanState("loading");
        void api.getDirectorShootingPlan(project.id).then(state => {
            if (!active) return;
            setPlanState(state.current_revision ? state.current_stale ? "stale" : "ready" : "none");
            setMode(state.current_revision ? "plan" : "script");
        }).catch(() => { if (active) setPlanState("error"); });
        return () => { active = false; };
    }, [isOpen, project?.id, retry]);

    const text = (project as any)?.original_text ?? project?.originalText ?? "";
    const charsCount = project?.characters?.length ?? 0;
    const checks = useMemo(() => {
        return [
            {
                key: "text" as const,
                pass: text.trim().length >= 40,
                label: t("checkText"),
                hint: t("checkTextHint"),
            },
            {
                key: "chars" as const,
                pass: charsCount > 0,
                label: t("checkChars"),
                hint: t("checkCharsHint"),
            },
        ];
    }, [text, charsCount, t]);

    const allPass = checks.every((c) => c.pass);

    const workflowReady = planState !== "loading" && planState !== "error" && (mode === "plan" ? planState === "ready" : skills.canRun);
    const handleConfirm = () => {
        if (!allPass || !workflowReady) return;
        onClose();
        onConfirm({ mode, skills: mode === "script" ? skills.selected : [] });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[120] bg-overlay backdrop-blur-sm grid place-items-center p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="w-full max-w-md rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-glass-border">
                            <div className="flex items-center gap-2">
                                <Sparkles size={15} className="text-primary" />
                                <h2 className="text-display font-medium text-foreground">分镜设计</h2>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label={t("close")}
                                className="p-1.5 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors"
                            >
                                <X size={15} />
                            </button>
                        </header>

                        {/* Body */}
                        <div className="px-5 py-4 space-y-4">
                            {/* Project context line */}
                            <p className="text-body-sm text-text-secondary">
                                <span className="text-text-muted">{t("forProject")}</span>{" "}
                                <span className="text-foreground font-medium">{project?.title || "—"}</span>
                            </p>

                            <section className="space-y-3" aria-label="分镜生成来源">
                                <div className="grid grid-cols-2 gap-2">
                                    <button type="button" aria-pressed={mode === "plan"} disabled={planState !== "ready" && planState !== "stale"} title="逐镜转换已确认计划，保留镜头关联；不另行调用设计模型" onClick={() => setMode("plan")} className={`min-h-11 rounded-md border p-2 text-sm disabled:opacity-40 ${mode === "plan" ? "border-primary text-primary" : "border-border"}`}>按导演计划生成</button>
                                    <button type="button" aria-pressed={mode === "script"} title="从剧本重新规划分镜，可选择本阶段 Skills" onClick={() => setMode("script")} className={`min-h-11 rounded-md border p-2 text-sm ${mode === "script" ? "border-primary text-primary" : "border-border"}`}>从剧本设计分镜</button>
                                </div>
                                {planState === "loading" && <p role="status" className="text-xs text-text-muted">正在检查导演计划…</p>}
                                {planState === "error" && <p role="alert" className="text-xs text-accent">导演计划加载失败 <button onClick={() => setRetry(n => n + 1)} className="underline">重试</button></p>}
                                {mode === "plan" && planState === "stale" && <p role="alert" className="text-xs text-accent">导演计划已过期，请先重新确认。</p>}
                                {mode === "script" && <DirectorSkillsSelector state={skills} />}
                            </section>
                            {/* Pre-flight checks */}
                            <section>
                                <h3 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("preflightTitle")}
                                </h3>
                                <ul className="space-y-2">
                                    {checks.map((c) => (
                                        <li
                                            key={c.key}
                                            className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                                                c.pass
                                                    ? "border-status-completed-border bg-status-completed-bg/5"
                                                    : "border-accent/40 bg-accent/10"
                                            }`}
                                        >
                                            <span
                                                className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[0.625rem] font-bold ${
                                                    c.pass ? "bg-status-completed-bg/20 text-status-completed-fg" : "bg-accent/20 text-accent"
                                                }`}
                                            >
                                                {c.pass ? "✓" : "!"}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[0.78125rem] text-foreground">{c.label}</p>
                                                {!c.pass && (
                                                    <p className="text-[0.6875rem] text-text-muted mt-0.5">{c.hint}</p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                {!allPass && onJumpToScript && (
                                    <button
                                        onClick={onJumpToScript}
                                        className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] text-primary hover:text-primary-hover transition-colors"
                                    >
                                        {t("goFixInScript")}
                                        <ArrowRight size={11} />
                                    </button>
                                )}
                            </section>

                            {/* Destructive warning when shots already exist */}
                            {allPass && existingShotCount > 0 && (
                                <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
                                    <AlertTriangle size={13} className="text-accent mt-0.5 shrink-0" />
                                    <p className="text-[0.75rem] text-accent">
                                        {t(mode === "plan" ? "planReplaceWarning" : "willReplaceWarning", { count: existingShotCount })}
                                    </p>
                                </div>
                            )}

                            {/* Healthy CTA hint */}
                            {allPass && existingShotCount === 0 && (
                                <p className="text-[0.75rem] text-text-muted flex items-center gap-1.5">
                                    <Film size={12} />
                                    {t(mode === "plan" ? "planFreshHint" : "freshHint")}
                                </p>
                            )}
                        </div>

                        {/* Footer */}
                        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-glass-border">
                            <WorkflowActionButton
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                            >
                                {t("cancel")}
                            </WorkflowActionButton>
                            <WorkflowActionButton
                                variant="primary"
                                size="sm"
                                disabled={!allPass || !workflowReady}
                                leftIcon={<Wand2 />}
                                onClick={handleConfirm}
                            >
                                {mode === "plan"
                                    ? t(existingShotCount > 0 ? "replaceFromPlan" : "applyPlan")
                                    : t(existingShotCount > 0 ? "replaceAndGenerate" : "generate")}
                            </WorkflowActionButton>
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
