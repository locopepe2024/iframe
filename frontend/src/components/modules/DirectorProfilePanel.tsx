"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BrainCircuit, Check, CheckCircle2, Loader2, RotateCcw, Save, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useProjectStore, type DirectorProfile, type DirectorProfileRevision } from "@/store/projectStore";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import { toast } from "@/store/toastStore";
import { extractErrorDetail } from "@/lib/utils";
import ScriptFactLedgerPanel from "./ScriptFactLedgerPanel";
import DirectorInterpretationVisualEditor from "./DirectorInterpretationVisualEditor";

const editableProfile = (profile?: DirectorProfile) => {
    if (!profile) return "";
    const { revision: _revision, content_hash: _hash, confirmed_at: _confirmed, ...draft } = profile;
    return JSON.stringify(draft, null, 2);
};

type DirectorAction = "analyze" | "refine" | "save" | "apply";
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
    const [busy, setBusy] = useState<"analyze" | "refine" | "save" | "apply" | null>(null);
    const [status, setStatus] = useState<DirectorStatus>({ kind: "idle" });
    const [revisions, setRevisions] = useState<DirectorProfileRevision[]>([]);
    const [draftRevision, setDraftRevision] = useState(0);
    const [draftSourceRevision, setDraftSourceRevision] = useState<number | null>(null);
    const [draftContextSourceRevision, setDraftContextSourceRevision] = useState<number | null>(null);
    const [savedDraftText, setSavedDraftText] = useState(() => editableProfile(confirmed));
    const sourceRevision = currentProject?.source_revision ?? 1;
    const isDirty = draftText !== savedDraftText;
    const hasStaleDraft = draftContextSourceRevision !== null && draftContextSourceRevision !== sourceRevision;
    const needsDraftSave = isDirty || draftContextSourceRevision !== draftSourceRevision;

    useEffect(() => {
        const fallback = editableProfile(confirmed);
        setDraftText(fallback);
        setSavedDraftText(fallback);
        setDraftRevision(0);
        setDraftSourceRevision(null);
        setDraftContextSourceRevision(null);
        setInstruction("");
        setHistory([]);
        setStatus({ kind: "idle" });
        if (!currentProject) return;
        let active = true;
        api.getDirectorProfileDraft(currentProject.id)
            .then(saved => {
                if (!active) return;
                const loaded = saved.draft ? JSON.stringify(saved.draft, null, 2) : fallback;
                setDraftText(loaded);
                setSavedDraftText(loaded);
                setDraftRevision(saved.draft_revision);
                setDraftSourceRevision(saved.source_revision);
                setDraftContextSourceRevision(saved.source_revision);
            })
            .catch(() => {
                if (!active) return;
                setDraftText(fallback);
                setSavedDraftText(fallback);
                setDraftContextSourceRevision(null);
            });
        return () => { active = false; };
    }, [currentProject?.id, confirmed?.content_hash, sourceRevision]);

    useEffect(() => {
        if (!isDirty || typeof window === "undefined") return;
        const warnBeforeLeave = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warnBeforeLeave);
        return () => window.removeEventListener("beforeunload", warnBeforeLeave);
    }, [isDirty]);

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
            setDraftContextSourceRevision(sourceRevision);
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
            setDraftContextSourceRevision(sourceRevision);
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
            if (hasStaleDraft) {
                throw new Error(t("directorDraftStaleActionRequired"));
            }
            const draft = parseDraft();
            let expectedDraftRevision = draftRevision;
            let confirmedDraft = draft;
            if (isDirty || draftSourceRevision !== sourceRevision) {
                const saved = await api.saveDirectorProfileDraft(
                    currentProject.id,
                    sourceRevision,
                    draftRevision,
                    draft,
                );
                expectedDraftRevision = saved.draft_revision;
                setDraftRevision(saved.draft_revision);
                setDraftSourceRevision(saved.source_revision);
                setDraftContextSourceRevision(saved.source_revision);
                const savedText = JSON.stringify(saved.draft ?? draft, null, 2);
                setDraftText(savedText);
                setSavedDraftText(savedText);
                confirmedDraft = saved.draft ?? draft;
            }
            const updated = await api.applyDirectorProfile(
                currentProject.id,
                confirmedDraft,
                confirmed?.revision,
                expectedDraftRevision,
            );
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

    const saveDraft = async () => {
        if (!currentProject || !draftText) return;
        setBusy("save");
        setStatus({ kind: "running", action: "save" });
        try {
            if (hasStaleDraft) {
                throw new Error(t("directorDraftStaleActionRequired"));
            }
            const draft = parseDraft();
            const saved = await api.saveDirectorProfileDraft(
                currentProject.id,
                sourceRevision,
                draftRevision,
                draft,
            );
            setDraftRevision(saved.draft_revision);
            setDraftSourceRevision(saved.source_revision);
            setDraftContextSourceRevision(saved.source_revision);
            const savedText = JSON.stringify(saved.draft ?? draft, null, 2);
            setDraftText(savedText);
            setSavedDraftText(savedText);
            setStatus({ kind: "success", action: "save" });
            toast.success(t("directorDraftSaved"), { projectId: currentProject.id, projectTitle: currentProject.title });
        } catch (error) {
            const message = extractErrorDetail(error, t("directorDraftSaveFailed"));
            setStatus({ kind: "error", action: "save", message });
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
                    : status.action === "save"
                        ? t("directorStatus.savingDraft")
                        : t("directorStatus.applying")
        : status.kind === "success"
            ? status.action === "analyze"
                ? t("directorStatus.analyzed")
                : status.action === "refine"
                    ? t("directorStatus.refined")
                    : status.action === "save"
                        ? t("directorStatus.draftSaved")
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
        <>
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
                    {draftRevision > 0 && (
                        <span className={`text-xs ${draftSourceRevision !== sourceRevision ? "text-amber-300" : "text-text-muted"}`}>
                            {draftSourceRevision !== sourceRevision
                                ? t("directorDraftStale", { revision: draftRevision, sourceRevision: draftSourceRevision ?? 0, currentSourceRevision: sourceRevision })
                                : t("directorDraftRevision", { revision: draftRevision })}
                        </span>
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
                    {(() => {
                        try {
                            return (
                                <DirectorInterpretationVisualEditor
                                    profile={parseDraft()}
                                    onChange={value => setDraftText(JSON.stringify(value, null, 2))}
                                />
                            );
                        } catch {
                            return (
                                <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                    {t("directorDraftInvalidVisual")}
                                </div>
                            );
                        }
                    })()}
                    <details className="rounded-md border border-border bg-background/40 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                            {t("directorAdvancedJson")}
                        </summary>
                        <textarea
                            aria-label={t("directorDraft")}
                            value={draftText}
                            onChange={event => setDraftText(event.target.value)}
                            className="mt-3 min-h-[22rem] w-full resize-y rounded-md border border-border bg-background p-4 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                            spellCheck={false}
                        />
                    </details>
                    {hasStaleDraft && (
                        <p role="alert" className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                            {t("directorDraftStaleActionRequired")}
                        </p>
                    )}
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
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-text-muted">
                            {needsDraftSave ? t("directorUnsavedHint") : t("directorApplyHint")}
                        </p>
                        <div className="flex items-center gap-2">
                            <WorkflowActionButton
                                variant="secondary"
                                leftIcon={<Save />}
                                loading={busy === "save"}
                                disabled={busy !== null || !needsDraftSave || hasStaleDraft}
                                onClick={saveDraft}
                            >
                                {t("directorSaveDraft")}
                            </WorkflowActionButton>
                            <WorkflowActionButton
                                leftIcon={<Check />}
                                loading={busy === "apply"}
                                disabled={busy !== null || hasStaleDraft || (!needsDraftSave && draftRevision === 0)}
                                onClick={apply}
                            >
                                {t("directorApply")}
                            </WorkflowActionButton>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex min-h-32 items-center justify-center border border-dashed border-border text-sm text-text-muted">
                    {t("directorEmpty")}
                </div>
            )}
        </section>
        {currentProject && (
            <ScriptFactLedgerPanel
                projectId={currentProject.id}
                sourceRevision={currentProject.source_revision ?? 1}
                directorProfile={confirmed}
            />
        )}
        </>
    );
}
