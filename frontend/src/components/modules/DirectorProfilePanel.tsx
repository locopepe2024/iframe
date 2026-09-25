"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BrainCircuit, Check, CheckCircle2, Loader2, RotateCcw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useProjectStore, type DirectorProfile, type DirectorProfileRevision } from "@/store/projectStore";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import { toast } from "@/store/toastStore";
import { extractErrorDetail } from "@/lib/utils";

const editableProfile = (profile?: DirectorProfile) => {
    if (!profile) return "";
    const { revision: _revision, content_hash: _hash, confirmed_at: _confirmed, ...draft } = profile;
    return JSON.stringify(draft, null, 2);
};

type DirectorAction = "analyze" | "refine" | "apply";
type DirectorStatus = {
    kind: "idle" | "running" | "success" | "error";
    action?: DirectorAction;
    jobStatus?: string;
    message?: string;
};

const jobStateKey = (status: string) => {
    const normalized = status.toLowerCase();
    if (["queued", "pending"].includes(normalized)) return "queued";
    if (["processing", "started", "in_progress"].includes(normalized)) return "processing";
    if (normalized === "completed") return "completed";
    if (["failed", "error"].includes(normalized)) return "failed";
    return "running";
};

export default function DirectorProfilePanel() {
    const t = useTranslations("artDirection");
    const { currentProject, updateProject } = useProjectStore();
    const confirmed = currentProject?.art_direction?.director_profile;
    const [draftText, setDraftText] = useState(() => editableProfile(confirmed));
    const [instruction, setInstruction] = useState("");
    const [history, setHistory] = useState<string[]>([]);
    const [busy, setBusy] = useState<"analyze" | "refine" | "apply" | null>(null);
    const [status, setStatus] = useState<DirectorStatus>({ kind: "idle" });
    const [revisions, setRevisions] = useState<DirectorProfileRevision[]>([]);

    useEffect(() => {
        setDraftText(editableProfile(confirmed));
        setInstruction("");
        setHistory([]);
        setStatus({ kind: "idle" });
    }, [currentProject?.id, confirmed?.content_hash]);

    useEffect(() => {
        if (!currentProject) return;
        let active = true;
        api.listDirectorProfileRevisions(currentProject.id)
            .then(value => { if (active) setRevisions(value as DirectorProfileRevision[]); })
            .catch(() => { if (active) setRevisions([]); });
        return () => { active = false; };
    }, [currentProject?.id, confirmed?.content_hash]);

    const parseDraft = () => {
        const value = JSON.parse(draftText);
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(t("directorInvalidJson"));
        return value;
    };

    const analyze = async () => {
        if (!currentProject) return;
        setBusy("analyze");
        setStatus({ kind: "running", action: "analyze", jobStatus: "queued" });
        try {
            const profile = await api.analyzeDirectorProfile(currentProject.id, jobStatus => {
                setStatus({ kind: "running", action: "analyze", jobStatus });
            });
            setDraftText(JSON.stringify(profile, null, 2));
            setHistory([]);
            setStatus({ kind: "success", action: "analyze", jobStatus: "completed" });
        } catch (error) {
            const message = extractErrorDetail(error, t("directorAnalyzeFailed"));
            setStatus({ kind: "error", action: "analyze", message });
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const refine = async () => {
        if (!currentProject || !instruction.trim()) return;
        setBusy("refine");
        setStatus({ kind: "running", action: "refine", jobStatus: "queued" });
        const currentInstruction = instruction.trim();
        const nextHistory = [...history, currentInstruction];
        try {
            const profile = await api.refineDirectorProfile(
                currentProject.id,
                parseDraft(),
                // Earlier changes are already merged into the visible draft;
                // resending the full history would recreate the context
                // avalanche on every rethink.
                [currentInstruction],
                jobStatus => setStatus({ kind: "running", action: "refine", jobStatus }),
            );
            setDraftText(JSON.stringify(profile, null, 2));
            setHistory(nextHistory);
            setInstruction("");
            setStatus({ kind: "success", action: "refine", jobStatus: "completed" });
        } catch (error) {
            const message = extractErrorDetail(error, t("directorRefineFailed"));
            setStatus({ kind: "error", action: "refine", message });
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const apply = async () => {
        if (!currentProject) return;
        setBusy("apply");
        setStatus({ kind: "running", action: "apply" });
        try {
            const updated = await api.applyDirectorProfile(currentProject.id, parseDraft());
            updateProject(currentProject.id, updated);
            setStatus({ kind: "success", action: "apply", jobStatus: "completed" });
            toast.success(t("directorApplied"), { projectId: currentProject.id, projectTitle: currentProject.title });
        } catch (error) {
            const message = extractErrorDetail(error, t("directorApplyFailed"));
            setStatus({ kind: "error", action: "apply", message });
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const statusText = status.kind === "running"
        ? status.action === "analyze"
            ? t("directorStatus.analyzing")
            : status.action === "refine"
                ? t("directorStatus.refining")
                : t("directorStatus.applying")
        : status.kind === "success"
            ? status.action === "analyze"
                ? t("directorStatus.analyzed")
                : status.action === "refine"
                    ? t("directorStatus.refined")
                    : t("directorStatus.applied")
            : status.kind === "error"
                ? t("directorStatus.failed", { message: status.message || t("directorAnalyzeFailed") })
                : "";

    const statusClass = status.kind === "running"
        ? "border-primary/30 bg-primary/10 text-primary"
        : status.kind === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-red-500/30 bg-red-500/10 text-red-300";

    return (
        <section className="border-b border-border pb-8" aria-labelledby="director-profile-title">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h2 id="director-profile-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
                        <BrainCircuit size={20} className="text-emerald-400" />
                        {t("directorAnalysis")}
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">{t("directorAnalysisHint")}</p>
                </div>
                <div className="flex items-center gap-2">
                    {confirmed && (
                        <span className="text-xs text-text-secondary">{t("directorRevision", { revision: confirmed.revision })}</span>
                    )}
                    <WorkflowActionButton
                        variant="secondary"
                        size="sm"
                        leftIcon={<RotateCcw />}
                        loading={busy === "analyze"}
                        disabled={busy !== null}
                        onClick={analyze}
                    >
                        {draftText ? t("directorReanalyze") : t("directorAnalyze")}
                    </WorkflowActionButton>
                </div>
            </div>

            {status.kind !== "idle" && (
                <div
                    role="status"
                    aria-live="polite"
                    className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${statusClass}`}
                >
                    {status.kind === "running" ? (
                        <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
                    ) : status.kind === "success" ? (
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    ) : (
                        <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                        <span className="font-medium">{statusText}</span>
                        {status.kind === "running" && status.jobStatus && (
                            <span className="ml-2 text-text-secondary">
                                {t(`directorStatus.jobState.${jobStateKey(status.jobStatus)}`)}
                            </span>
                        )}
                    </span>
                </div>
            )}

            {draftText ? (
                <div className="space-y-3">
                    {revisions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" aria-label={t("directorHistory")}>
                            <span>{t("directorHistory")}</span>
                            {revisions.slice().reverse().map(revision => (
                                <button
                                    key={`${revision.revision}-${revision.content_hash}`}
                                    type="button"
                                    className="rounded border border-border px-2 py-1 hover:border-primary"
                                    onClick={() => setDraftText(JSON.stringify(revision.profile, null, 2))}
                                >
                                    {t("directorRevision", { revision: revision.revision })}
                                </button>
                            ))}
                        </div>
                    )}
                    <textarea
                        aria-label={t("directorDraft")}
                        value={draftText}
                        onChange={event => setDraftText(event.target.value)}
                        className="min-h-[22rem] w-full resize-y rounded-md border border-border bg-background p-4 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <textarea
                            value={instruction}
                            onChange={event => setInstruction(event.target.value)}
                            maxLength={2000}
                            placeholder={t("directorRevisionPlaceholder")}
                            className="min-h-20 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <div className="flex shrink-0 items-end gap-2">
                            <WorkflowActionButton
                                variant="secondary"
                                leftIcon={<Send />}
                                loading={busy === "refine"}
                                disabled={busy !== null || !instruction.trim() || history.length >= 12}
                                onClick={refine}
                            >
                                {t("directorRefine")}
                            </WorkflowActionButton>
                            <WorkflowActionButton
                                leftIcon={<Check />}
                                loading={busy === "apply"}
                                disabled={busy !== null}
                                onClick={apply}
                            >
                                {t("directorApply")}
                            </WorkflowActionButton>
                        </div>
                    </div>
                    <p className="text-xs text-text-muted">{t("directorApplyHint")}</p>
                </div>
            ) : (
                <div className="flex min-h-32 items-center justify-center border border-dashed border-border text-sm text-text-muted">
                    {t("directorEmpty")}
                </div>
            )}
        </section>
    );
}
