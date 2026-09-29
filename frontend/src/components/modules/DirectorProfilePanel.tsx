"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BrainCircuit, Check, CheckCircle2, Loader2, RotateCcw, Save, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
    useProjectStore,
    type DirectorProfile,
    type DirectorProfileRevision,
    type ScriptFactLedgerQueryResult,
    type ScriptFactLedgerSnapshot,
} from "@/store/projectStore";
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

const directorLocalDraftKey = (projectId: string, sourceRevision: number) =>
    `iframe.director-profile-draft.v1:${projectId}:source-${sourceRevision}`;

type LocalDirectorDraft = {
    schemaVersion: 1;
    projectId: string;
    sourceRevision: number;
    confirmedHash: string;
    draftRevision: number;
    draft: Record<string, unknown>;
    savedAt: number;
};

export default function DirectorProfilePanel({ mindMapOnly = false, onApplied }: { mindMapOnly?: boolean; onApplied?: () => void }) {
    const t = useTranslations("artDirection");
    const { currentProject, updateProject } = useProjectStore();
    const confirmed = currentProject?.art_direction?.director_profile;
    const [draftText, setDraftText] = useState(() => editableProfile(confirmed));
    const [instruction, setInstruction] = useState("");
    const [draftName, setDraftName] = useState("");
    const [revisionScope, setRevisionScope] = useState<"local" | "full">("local");
    const [history, setHistory] = useState<string[]>([]);
    const [busy, setBusy] = useState<"analyze" | "refine" | "save" | "apply" | null>(null);
    const [status, setStatus] = useState<DirectorStatus>({ kind: "idle" });
    const [revisions, setRevisions] = useState<DirectorProfileRevision[]>([]);
    const [draftRevision, setDraftRevision] = useState(0);
    const [draftSourceRevision, setDraftSourceRevision] = useState<number | null>(null);
    const [draftContextSourceRevision, setDraftContextSourceRevision] = useState<number | null>(null);
    const [savedDraftText, setSavedDraftText] = useState(() => editableProfile(confirmed));
    const [candidateText, setCandidateText] = useState<string | null>(null);
    const [candidateAction, setCandidateAction] = useState<"analyze" | "refine" | null>(null);
    const [candidateNoChange, setCandidateNoChange] = useState(false);
    const [factEvidence, setFactEvidence] = useState<ScriptFactLedgerQueryResult | null>(null);
    const [factsLoading, setFactsLoading] = useState(false);
    const [factsError, setFactsError] = useState("");
    const [factRefreshToken, setFactRefreshToken] = useState(0);
    const draftHydratedRef = useRef(false);
    const sourceRevision = currentProject?.source_revision ?? 1;
    const isDirty = draftText !== savedDraftText;
    const hasStaleDraft = draftContextSourceRevision !== null && draftContextSourceRevision !== sourceRevision;
    const needsDraftSave = isDirty || draftContextSourceRevision !== draftSourceRevision;
    const requestedFactLedgerRevision = useMemo(() => {
        try {
            const parsed = JSON.parse(draftText) as { story_map?: { fact_ledger_revision?: number | null } };
            return parsed.story_map?.fact_ledger_revision ?? null;
        } catch {
            return null;
        }
    }, [draftText]);
    const storyMapHasFactReferences = useMemo(() => {
        try {
            const parsed = JSON.parse(draftText) as { story_map?: { phases?: Array<{ events?: Array<{ source_fact_ids?: unknown }> }>; relationship_arcs?: Array<{ states?: Array<{ source_fact_ids?: unknown }> }> } };
            return (parsed.story_map?.phases ?? []).some(phase => (phase.events ?? []).some(event => Array.isArray(event.source_fact_ids) && event.source_fact_ids.length > 0))
                || (parsed.story_map?.relationship_arcs ?? []).some(arc => (arc.states ?? []).some(state => Array.isArray(state.source_fact_ids) && state.source_fact_ids.length > 0));
        } catch {
            return false;
        }
    }, [draftText]);

    useEffect(() => {
        if (!currentProject) {
            setFactEvidence(null);
            return;
        }
        let active = true;
        setFactsLoading(true);
        setFactsError("");
        void (async () => {
            const revisions: ScriptFactLedgerSnapshot[] = await api.listScriptFactLedgerRevisions(currentProject.id);
            const currentRevisions = revisions
                .filter(item => item.source_revision === sourceRevision)
                .sort((a, b) => b.revision - a.revision);
            const snapshot = currentRevisions.find(item => item.revision === requestedFactLedgerRevision)
                ?? currentRevisions[0];
            if (!snapshot) {
                if (active) setFactEvidence(null);
                return;
            }
            const firstPage = await api.getScriptFactLedger(currentProject.id, sourceRevision, snapshot.revision, 0, 100);
            const offsets = [];
            for (let offset = 100; offset < Math.min(firstPage.total_facts, 500); offset += 100) offsets.push(offset);
            const nextPages = await Promise.all(offsets.map(offset =>
                api.getScriptFactLedger(currentProject.id, sourceRevision, snapshot.revision, offset, 100),
            ));
            if (active) setFactEvidence({
                ...firstPage,
                facts: [firstPage, ...nextPages].flatMap(page => page.facts),
                truncated: firstPage.total_facts > 500,
            });
        })().catch(() => {
            if (active) {
                setFactEvidence(null);
                setFactsError(storyMapHasFactReferences ? t("directorEditor.storyMap.factLoadFailed") : "");
            }
        }).finally(() => {
            if (active) setFactsLoading(false);
        });
        return () => { active = false; };
    }, [currentProject?.id, sourceRevision, requestedFactLedgerRevision, factRefreshToken, storyMapHasFactReferences, t]);

    useEffect(() => {
        const fallback = editableProfile(confirmed);
        draftHydratedRef.current = false;
        setDraftText(fallback);
        setSavedDraftText(fallback);
        setDraftRevision(0);
        setDraftSourceRevision(null);
        setDraftContextSourceRevision(null);
        setInstruction("");
        setHistory([]);
        setStatus({ kind: "idle" });
        setCandidateText(null);
        setCandidateAction(null);
        setCandidateNoChange(false);
        if (!currentProject) return;
        let active = true;
        api.getDirectorProfileDraft(currentProject.id)
            .then(saved => {
                if (!active) return;
                const serverLoaded = saved.draft ? JSON.stringify(saved.draft, null, 2) : fallback;
                setDraftName(saved.draft_name ?? "");
                let loaded = serverLoaded;
                let loadedRevision = saved.draft_revision;
                try {
                    const raw = window.localStorage.getItem(directorLocalDraftKey(currentProject.id, sourceRevision));
                    const local = raw ? JSON.parse(raw) as Partial<LocalDirectorDraft> : null;
                    if (local?.schemaVersion === 1 && local.projectId === currentProject.id
                        && local.sourceRevision === sourceRevision && local.draft && typeof local.draft === "object") {
                        const serverUpdatedAt = saved.updated_at ? saved.updated_at * 1000 : 0;
                        if (!serverUpdatedAt || (local.savedAt ?? 0) >= serverUpdatedAt) {
                            loaded = JSON.stringify(local.draft, null, 2);
                            loadedRevision = saved.draft_revision;
                        }
                    }
                } catch {
                    // Local draft recovery is best effort; server state remains authoritative.
                }
                setDraftText(loaded);
                setSavedDraftText(serverLoaded);
                setDraftRevision(loadedRevision);
                setDraftSourceRevision(saved.source_revision);
                setDraftContextSourceRevision(saved.source_revision);
                draftHydratedRef.current = true;
            })
            .catch(() => {
                if (!active) return;
                setDraftText(fallback);
                setSavedDraftText(fallback);
                setDraftContextSourceRevision(null);
                draftHydratedRef.current = true;
            });
        return () => { active = false; };
    }, [currentProject?.id, confirmed?.content_hash, sourceRevision]);

    useEffect(() => {
        if (!draftHydratedRef.current || !currentProject || !isDirty || typeof window === "undefined") return;
        try {
            const draft = JSON.parse(draftText) as Record<string, unknown>;
            window.localStorage.setItem(directorLocalDraftKey(currentProject.id, sourceRevision), JSON.stringify({
                schemaVersion: 1,
                projectId: currentProject.id,
                sourceRevision,
                confirmedHash: confirmed?.content_hash ?? "",
                draftRevision,
                draft,
                savedAt: Date.now(),
            } satisfies LocalDirectorDraft));
        } catch {
            // Invalid JSON is already shown by the editor; do not persist it as a recoverable draft.
        }
    }, [draftText, isDirty, currentProject?.id, sourceRevision, confirmed?.content_hash, draftRevision]);

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

    const clearLocalDraft = () => {
        if (typeof window === "undefined" || !currentProject) return;
        try { window.localStorage.removeItem(directorLocalDraftKey(currentProject.id, sourceRevision)); } catch { /* storage unavailable */ }
    };

    const saveDraftWithRecovery = async (draft: Record<string, unknown>, expectedRevision: number) => {
        if (!currentProject) throw new Error(t("directorDraftSaveFailed"));
        try {
            return draftName
                ? await api.saveDirectorProfileDraft(currentProject.id, sourceRevision, expectedRevision, draft, draftName)
                : await api.saveDirectorProfileDraft(currentProject.id, sourceRevision, expectedRevision, draft);
        } catch (error) {
            const detail = extractErrorDetail(error, "");
            if (!detail.toLowerCase().includes("draft revision changed")) throw error;
            toast.info(t("directorDraftConflictRecovering"));
            const latest = await api.getDirectorProfileDraft(currentProject.id);
            if (latest.source_revision !== null && latest.source_revision !== sourceRevision) {
                throw new Error(t("directorDraftStaleActionRequired"));
            }
            const latestText = latest.draft ? JSON.stringify(latest.draft) : "";
            const draftTextValue = JSON.stringify(draft);
            if (latestText === draftTextValue) return latest;
            return draftName
                ? await api.saveDirectorProfileDraft(currentProject.id, sourceRevision, latest.draft_revision, draft, draftName)
                : await api.saveDirectorProfileDraft(currentProject.id, sourceRevision, latest.draft_revision, draft);
        }
    };

    const queueCandidate = (profile: Record<string, unknown>, action: "analyze" | "refine") => {
        const next = JSON.stringify(profile, null, 2);
        let unchanged = false;
        try {
            unchanged = draftContextSourceRevision === sourceRevision
                && JSON.stringify(JSON.parse(next)) === JSON.stringify(JSON.parse(draftText));
        } catch {
            unchanged = false;
        }
        setCandidateText(next);
        setCandidateAction(action);
        setCandidateNoChange(unchanged);
    };

    const acceptCandidate = () => {
        if (!candidateText || candidateNoChange) return;
        const acceptedAction = candidateAction;
        setDraftText(candidateText);
        setDraftContextSourceRevision(sourceRevision);
        setCandidateText(null);
        setCandidateAction(null);
        setCandidateNoChange(false);
        setStatus({ kind: "success", action: acceptedAction ?? "refine", jobStatus: "completed" });
    };

    const discardCandidate = () => {
        setCandidateText(null);
        setCandidateAction(null);
        setCandidateNoChange(false);
        setStatus({ kind: "success", action: "refine", jobStatus: "candidate_discarded" });
    };

    const analyze = async () => {
        if (!currentProject) return;
        setBusy("analyze");
        setStatus({ kind: "running", action: "analyze", jobStatus: "queued" });
        try {
            const profile = await api.analyzeDirectorProfile(currentProject.id, jobStatus => {
                setStatus({ kind: "running", action: "analyze", jobStatus });
            });
            queueCandidate(profile, "analyze");
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
        const scopedInstruction = revisionScope === "full"
            ? `[FULL_REANALYSIS] ${currentInstruction}`
            : currentInstruction;
        const nextHistory = [...history, currentInstruction];
        try {
            const profile = await api.refineDirectorProfile(
                currentProject.id,
                parseDraft(),
                // Earlier changes are already merged into the visible draft;
                // resending the full history would recreate the context
                // avalanche on every rethink.
                [scopedInstruction],
                jobStatus => setStatus({ kind: "running", action: "refine", jobStatus }),
            );
            queueCandidate(profile, "refine");
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
                const saved = await saveDraftWithRecovery(draft, draftRevision);
                expectedDraftRevision = saved.draft_revision;
                setDraftRevision(saved.draft_revision);
                setDraftSourceRevision(saved.source_revision);
                setDraftContextSourceRevision(saved.source_revision);
                const savedText = JSON.stringify(saved.draft ?? draft, null, 2);
            setDraftText(savedText);
            setSavedDraftText(savedText);
            confirmedDraft = saved.draft ?? draft;
            clearLocalDraft();
            }
            // A previous request may have committed the draft while its
            // response was lost. Refresh the server revision before confirm
            // so the next action is not blocked by a stale optimistic value.
            const latestDraft = await api.getDirectorProfileDraft(currentProject.id);
            if (latestDraft.source_revision === sourceRevision && latestDraft.draft_revision !== expectedDraftRevision) {
                const latestText = latestDraft.draft ? JSON.stringify(latestDraft.draft) : "";
                if (latestText === JSON.stringify(confirmedDraft)) {
                    expectedDraftRevision = latestDraft.draft_revision;
                } else {
                    const saved = await saveDraftWithRecovery(confirmedDraft, latestDraft.draft_revision);
                    expectedDraftRevision = saved.draft_revision;
                    confirmedDraft = saved.draft ?? confirmedDraft;
                    setDraftRevision(saved.draft_revision);
                    setDraftSourceRevision(saved.source_revision);
                    setDraftContextSourceRevision(saved.source_revision);
                    const savedText = JSON.stringify(confirmedDraft, null, 2);
                    setDraftText(savedText);
                    setSavedDraftText(savedText);
                }
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
            onApplied?.();
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
        const requestedName = window.prompt(t("directorDraftNamePrompt"), draftName || t("directorDraftNameDefault"));
        if (requestedName === null) return;
        const trimmedName = requestedName.trim();
        if (!trimmedName) {
            toast.info(t("directorDraftNameRequired"));
            return;
        }
        setDraftName(trimmedName);
        setBusy("save");
        setStatus({ kind: "running", action: "save" });
        try {
            if (hasStaleDraft) {
                throw new Error(t("directorDraftStaleActionRequired"));
            }
            const draft = parseDraft();
            const saved = await saveDraftWithRecovery(draft, draftRevision);
            setDraftRevision(saved.draft_revision);
            setDraftSourceRevision(saved.source_revision);
            setDraftContextSourceRevision(saved.source_revision);
            const savedText = JSON.stringify(saved.draft ?? draft, null, 2);
            setDraftText(savedText);
            setSavedDraftText(savedText);
            clearLocalDraft();
            setStatus({ kind: "success", action: "save" });
            toast.success(t("directorDraftSaved"), { projectId: currentProject.id, projectTitle: currentProject.title });
        } catch (error) {
            const message = `${extractErrorDetail(error, t("directorDraftSaveFailed"))} ${t("directorDraftRetainedLocally")}`;
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
                    {candidateText && (
                        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label={t("directorCandidateTitle")}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">{t("directorCandidateTitle")}</h3>
                                    <p className="mt-1 text-xs leading-5 text-text-secondary">
                                        {candidateNoChange ? t("directorCandidateNoChange") : t("directorCandidateHint")}
                                    </p>
                                </div>
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                                    {candidateAction === "analyze" ? t("directorCandidateFromAnalysis") : t("directorCandidateFromRefine")}
                                </span>
                            </div>
                            {!candidateNoChange && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <WorkflowActionButton variant="secondary" leftIcon={<X />} onClick={discardCandidate} disabled={busy !== null}>{t("directorDiscardCandidate")}</WorkflowActionButton>
                                    <WorkflowActionButton leftIcon={<Check />} onClick={acceptCandidate} disabled={busy !== null}>{t("directorAcceptCandidate")}</WorkflowActionButton>
                                </div>
                            )}
                        </section>
                    )}
                    {revisions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" aria-label={t("directorVersionManagement")}>
                            <label htmlFor="director-version-management">{t("directorVersionManagement")}</label>
                            <select
                                id="director-version-management"
                                defaultValue=""
                                onChange={event => {
                                    const revision = revisions.find(item => String(item.revision) === event.target.value);
                                    if (revision) setDraftText(JSON.stringify(revision.profile, null, 2));
                                    event.currentTarget.value = "";
                                }}
                                className="min-h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                            >
                                <option value="">{t("directorVersionManagementPlaceholder")}</option>
                                {revisions.slice().reverse().map(revision => (
                                    <option key={`${revision.revision}-${revision.content_hash}`} value={revision.revision}>
                                        {t("directorRevision", { revision: revision.revision })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    {(() => {
                        try {
                            return (
                                <DirectorInterpretationVisualEditor
                                    profile={parseDraft()}
                                    sourceRevision={sourceRevision}
                                    characters={currentProject?.characters ?? []}
                                    facts={factEvidence?.facts ?? []}
                                    factLedgerRevision={factEvidence?.ledger_revision ?? null}
                                    factsLoading={factsLoading}
                                    factsError={factsError}
                                    onReloadFacts={() => setFactRefreshToken(token => token + 1)}
                                    onChange={value => setDraftText(JSON.stringify(value, null, 2))}
                                    mindMapOnly={mindMapOnly}
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
                            {t("directorTechnicalTools")}
                        </summary>
                        <p className="mt-2 text-xs leading-5 text-text-muted">{t("directorTechnicalToolsHint")}</p>
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
                    <section className="rounded-lg border border-border bg-background/30 p-3" aria-labelledby="director-revision-title">
                        <div className="mb-3">
                            <h3 id="director-revision-title" className="text-sm font-semibold text-foreground">{t("directorRevisionTitle")}</h3>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">{t("directorRevisionHint")}</p>
                        </div>
                        <div className="mb-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("directorRevisionScopeLabel")}>
                            {(["local", "full"] as const).map(scope => (
                                <label key={scope} className={`flex min-h-16 cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors ${revisionScope === scope ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/60"}`}>
                                    <input
                                        type="radio"
                                        name="director-revision-scope"
                                        value={scope}
                                        checked={revisionScope === scope}
                                        onChange={() => setRevisionScope(scope)}
                                        className="mt-0.5 accent-primary"
                                    />
                                    <span>
                                        <span className="block text-xs font-semibold text-foreground">{t(`directorRevisionScope.${scope}.title`)}</span>
                                        <span className="mt-1 block text-[11px] leading-4 text-text-muted">{t(`directorRevisionScope.${scope}.hint`)}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <textarea
                                value={instruction}
                                onChange={event => setInstruction(event.target.value)}
                                maxLength={2000}
                                aria-label={t("directorRevisionInstructionLabel")}
                                placeholder={t("directorRevisionPlaceholder")}
                                className="min-h-20 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/70"
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
                    </section>
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
                <div className="space-y-3">
                    {candidateText ? (
                        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label={t("directorCandidateTitle")}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">{t("directorCandidateTitle")}</h3>
                                    <p className="mt-1 text-xs leading-5 text-text-secondary">
                                        {candidateNoChange ? t("directorCandidateNoChange") : t("directorCandidateHint")}
                                    </p>
                                </div>
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                                    {candidateAction === "analyze" ? t("directorCandidateFromAnalysis") : t("directorCandidateFromRefine")}
                                </span>
                            </div>
                            {!candidateNoChange && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <WorkflowActionButton variant="secondary" leftIcon={<X />} onClick={discardCandidate} disabled={busy !== null}>{t("directorDiscardCandidate")}</WorkflowActionButton>
                                    <WorkflowActionButton leftIcon={<Check />} onClick={acceptCandidate} disabled={busy !== null}>{t("directorAcceptCandidate")}</WorkflowActionButton>
                                </div>
                            )}
                        </section>
                    ) : (
                        <div className="flex min-h-32 items-center justify-center border border-dashed border-border text-sm text-text-muted">
                            {t("directorEmpty")}
                        </div>
                    )}
                </div>
            )}
        </section>
        {currentProject && (
            <ScriptFactLedgerPanel
                projectId={currentProject.id}
                sourceRevision={currentProject.source_revision ?? 1}
                directorProfile={confirmed}
                readOnly
            />
        )}
        </>
    );
}
