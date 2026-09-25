"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Save, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { extractErrorDetail } from "@/lib/utils";
import type {
    DirectorProfile,
    ScriptFactLedgerEntry,
    ScriptFactLedgerSnapshot,
} from "@/store/projectStore";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";

type LedgerEvidence = {
    ledger_revision: number;
    source_revision: number;
    source_revision_id: string;
    offset_unit: string;
    total_facts: number;
    truncated: boolean;
    facts: (ScriptFactLedgerEntry & {
        evidence: { start: number; end: number; text: string }[];
    })[];
};

const emptyLedger = "[]";

function importDirectorFacts(profile: DirectorProfile | undefined, sourceRevision: number): ScriptFactLedgerEntry[] {
    const state = profile?.canon_state;
    if (!state || typeof state !== "object") return [];
    return Object.entries(state).flatMap(([category, rawItems]) => {
        if (!Array.isArray(rawItems)) return [];
        return rawItems.filter(item => item && typeof item === "object").map((item, index) => {
            const fact = item as Record<string, unknown>;
            const subject = typeof fact.subject === "string" ? fact.subject : "";
            const baseId = String(fact.fact_id || category + "-" + (index + 1));
            return {
                fact_id: baseId + "-" + category,
                kind: typeof fact.kind === "string" ? fact.kind : category,
                subject_ids: [],
                phase: typeof fact.phase === "string" ? fact.phase : null,
                source_revision: sourceRevision,
                source_ranges: [],
                value: {
                    subject,
                    value: fact.value ?? fact,
                    source_refs: fact.source_refs ?? [],
                },
                // Director canon items can be useful candidates, but they do
                // not yet carry exact source ranges. Keep them unconfirmed.
                evidence_status: "uncertain" as const,
                conflict_group_id: typeof fact.conflict_group_id === "string" ? fact.conflict_group_id : null,
            };
        });
    });
}

export default function ScriptFactLedgerPanel({
    projectId,
    sourceRevision,
    directorProfile,
}: {
    projectId: string;
    sourceRevision: number;
    directorProfile?: DirectorProfile;
}) {
    const t = useTranslations("artDirection");
    const [draftText, setDraftText] = useState(emptyLedger);
    const [savedText, setSavedText] = useState(emptyLedger);
    const [draftRevision, setDraftRevision] = useState(0);
    const [draftSourceRevision, setDraftSourceRevision] = useState<number | null>(null);
    const [savedSourceRevision, setSavedSourceRevision] = useState<number | null>(null);
    const [ledgerRevision, setLedgerRevision] = useState(0);
    const [history, setHistory] = useState<ScriptFactLedgerSnapshot[]>([]);
    const [evidence, setEvidence] = useState<LedgerEvidence | null>(null);
    const [evidenceOffset, setEvidenceOffset] = useState(0);
    const [busy, setBusy] = useState<"save" | "confirm" | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        void Promise.all([
            api.getScriptFactLedgerDraft(projectId),
            api.listScriptFactLedgerRevisions(projectId),
        ]).then(([draft, revisions]) => {
            if (!active) return;
            const hasSavedDraft = draft.draft_revision > 0;
            const facts = hasSavedDraft
                ? draft.facts
                : importDirectorFacts(directorProfile, sourceRevision);
            const nextText = JSON.stringify(facts, null, 2);
            setDraftText(nextText);
            setSavedText(hasSavedDraft ? nextText : emptyLedger);
            setDraftRevision(draft.draft_revision);
            setDraftSourceRevision(draft.source_revision);
            setSavedSourceRevision(draft.source_revision);
            setHistory(revisions);
            const latest = revisions.reduce((max, item) => Math.max(max, item.revision), 0);
            setLedgerRevision(latest);
            if (latest > 0) {
                const snapshot = revisions.find(item => item.revision === latest);
                if (snapshot) {
                    void api.getScriptFactLedger(projectId, snapshot.source_revision, latest)
                        .then((result: LedgerEvidence) => {
                            if (active) {
                                setEvidence(result);
                                setEvidenceOffset(0);
                            }
                        })
                        .catch(() => { if (active) setEvidence(null); });
                }
            }
        }).catch(() => {
            if (active) setError(t("factLedgerLoadFailed"));
        });
        return () => { active = false; };
    }, [projectId, sourceRevision, directorProfile?.content_hash, t]);

    const isDirty = draftText !== savedText
        || draftSourceRevision !== savedSourceRevision
        || draftRevision === 0;
    const staleDraft = draftSourceRevision !== null && draftSourceRevision !== sourceRevision;
    const canConfirm = !isDirty && draftRevision > 0 && draftSourceRevision === sourceRevision;

    const parseFacts = (): ScriptFactLedgerEntry[] => {
        const value: unknown = JSON.parse(draftText);
        if (!Array.isArray(value)) throw new Error(t("factLedgerInvalidJson"));
        return value as ScriptFactLedgerEntry[];
    };

    const saveDraft = async () => {
        setBusy("save");
        setError("");
        try {
            const result = await api.saveScriptFactLedgerDraft(
                projectId,
                sourceRevision,
                draftRevision,
                parseFacts(),
            );
            const nextRevision = result.draft_revision as number;
            const nextFacts = result.facts as ScriptFactLedgerEntry[];
            setDraftRevision(nextRevision);
            setDraftSourceRevision(sourceRevision);
            setSavedSourceRevision(sourceRevision);
            setDraftText(JSON.stringify(nextFacts, null, 2));
            setSavedText(JSON.stringify(nextFacts, null, 2));
            toast.success(t("factLedgerDraftSaved"));
        } catch (cause) {
            const message = extractErrorDetail(cause, t("factLedgerSaveFailed"));
            setError(message);
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const confirm = async () => {
        if (!canConfirm) return;
        setBusy("confirm");
        setError("");
        try {
            await api.confirmScriptFactLedger(projectId, ledgerRevision, draftRevision);
            const revisions = await api.listScriptFactLedgerRevisions(projectId);
            setHistory(revisions);
            const latest = revisions.reduce((max, item) => Math.max(max, item.revision), 0);
            setLedgerRevision(latest);
            const snapshot = revisions.find(item => item.revision === latest);
            if (snapshot) {
                const result = await api.getScriptFactLedger(projectId, snapshot.source_revision, latest);
                setEvidence(result as LedgerEvidence);
                setEvidenceOffset(0);
            }
            toast.success(t("factLedgerConfirmed"));
        } catch (cause) {
            const message = extractErrorDetail(cause, t("factLedgerConfirmFailed"));
            setError(message);
            toast.error(message);
        } finally {
            setBusy(null);
        }
    };

    const importCurrentDirectorFacts = () => {
        const facts = importDirectorFacts(directorProfile, sourceRevision);
        setDraftText(JSON.stringify(facts, null, 2));
        setDraftSourceRevision(sourceRevision);
        setError("");
    };

    return (
        <section className="mt-6 rounded-lg border border-border bg-background/40 p-4" aria-labelledby="fact-ledger-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 id="fact-ledger-title" className="text-sm font-semibold text-foreground">
                        {t("factLedgerTitle")}
                    </h3>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-text-secondary">
                        {t("factLedgerHint", { sourceRevision })}
                    </p>
                    {staleDraft && (
                        <p role="alert" className="mt-2 text-xs text-amber-200">
                            {t("factLedgerStaleDraft", { draftRevision: draftSourceRevision, sourceRevision })}
                        </p>
                    )}
                </div>
                <span className="text-xs text-text-muted">{t("factLedgerCurrent", { revision: ledgerRevision })}</span>
            </div>

            {history.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" aria-label={t("factLedgerHistory")}>
                    <span className="text-text-muted">{t("factLedgerHistory")}:</span>
                    {history.map(item => (
                        <button
                            key={item.revision}
                            type="button"
                            className="rounded border border-border px-2 py-1 text-text-secondary hover:border-primary hover:text-foreground"
                            onClick={() => {
                                void api.getScriptFactLedger(projectId, item.source_revision, item.revision, 0)
                                    .then((result: LedgerEvidence) => {
                                        setEvidence(result);
                                        setEvidenceOffset(0);
                                    })
                                    .catch(cause => {
                                        const message = extractErrorDetail(cause, t("factLedgerLoadFailed"));
                                        setError(message);
                                        toast.error(message);
                                    });
                            }}
                        >
                            {t("factLedgerHistoryItem", {
                                revision: item.revision,
                                sourceRevision: item.source_revision,
                                count: item.fact_count,
                            })}
                        </button>
                    ))}
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
                <WorkflowActionButton variant="secondary" size="sm" onClick={importCurrentDirectorFacts} disabled={busy !== null}>
                    {t("factLedgerImportDirector")}
                </WorkflowActionButton>
                <span className="self-center text-xs text-text-muted">{t("factLedgerImportNote")}</span>
            </div>

            <details className="mt-3 text-xs text-text-secondary">
                <summary className="cursor-pointer">{t("factLedgerSchema")}</summary>
                <pre className="mt-2 overflow-x-auto rounded border border-border bg-background p-3 text-[11px] leading-5">
{JSON.stringify([{
    fact_id: "fact-001",
    kind: "character_action",
    subject_ids: ["character-id"],
    phase: null,
    source_revision: sourceRevision,
    source_revision_id: "filled-by-server",
    source_ranges: [{ start: 0, end: 6 }],
    value: { claim: "周涵牵着沈夏" },
    evidence_status: "uncertain",
    conflict_group_id: null,
}], null, 2)}
                </pre>
            </details>

            <textarea
                aria-label={t("factLedgerDraft")}
                value={draftText}
                onChange={event => setDraftText(event.target.value)}
                className="mt-3 min-h-64 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary"
                spellCheck={false}
            />

            {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <WorkflowActionButton
                    variant="secondary"
                    leftIcon={busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                    loading={busy === "save"}
                    disabled={busy !== null || !isDirty || staleDraft}
                    onClick={saveDraft}
                >
                    {t("factLedgerSaveDraft")}
                </WorkflowActionButton>
                <WorkflowActionButton
                    leftIcon={busy === "confirm" ? <Loader2 className="animate-spin" /> : <Check />}
                    loading={busy === "confirm"}
                    disabled={busy !== null || !canConfirm}
                    onClick={confirm}
                >
                    {t("factLedgerConfirm")}
                </WorkflowActionButton>
                <span className="text-xs text-text-muted">{t("factLedgerConfirmHint")}</span>
            </div>

            {evidence && evidence.facts.length > 0 && (
                <details className="mt-4 rounded border border-border p-3">
                    <summary className="cursor-pointer text-xs font-medium text-foreground">
                        {t("factLedgerEvidence", {
                            count: evidence.facts.length,
                            total: evidence.total_facts,
                            revision: evidence.ledger_revision,
                            sourceRevision: evidence.source_revision,
                        })}
                    </summary>
                    <ul className="mt-3 space-y-2">
                        {evidence.facts.map(fact => (
                            <li key={fact.fact_id} className="text-xs">
                                <span className="font-medium text-foreground">{fact.fact_id}</span>
                                <span className="ml-2 text-text-muted">{fact.evidence_status}</span>
                                {fact.evidence.map((span, index) => (
                                <blockquote key={fact.fact_id + "-" + index} className="mt-1 border-l-2 border-emerald-500/60 pl-2 text-text-secondary">
                                        {t("factLedgerSourceRange", { start: span.start, end: span.end })}: {span.text}
                                    </blockquote>
                                ))}
                            </li>
                        ))}
                    </ul>
                    {evidence.total_facts > 100 && (
                        <div className="mt-3 flex items-center gap-2 text-xs">
                            <button
                                type="button"
                                className="rounded border border-border px-2 py-1 disabled:opacity-40"
                                disabled={evidenceOffset === 0}
                                onClick={() => {
                                    const nextOffset = Math.max(0, evidenceOffset - 100);
                                    void api.getScriptFactLedger(projectId, evidence.source_revision, evidence.ledger_revision, nextOffset)
                                        .then((result: LedgerEvidence) => {
                                            setEvidence(result);
                                            setEvidenceOffset(nextOffset);
                                        });
                                }}
                            >
                                {t("factLedgerPrevious")}
                            </button>
                            <span className="text-text-muted">
                                {t("factLedgerPage", {
                                    start: evidenceOffset + 1,
                                    end: Math.min(evidenceOffset + evidence.facts.length, evidence.total_facts),
                                    total: evidence.total_facts,
                                })}
                            </span>
                            <button
                                type="button"
                                className="rounded border border-border px-2 py-1 disabled:opacity-40"
                                disabled={!evidence.truncated}
                                onClick={() => {
                                    const nextOffset = evidenceOffset + 100;
                                    void api.getScriptFactLedger(projectId, evidence.source_revision, evidence.ledger_revision, nextOffset)
                                        .then((result: LedgerEvidence) => {
                                            setEvidence(result);
                                            setEvidenceOffset(nextOffset);
                                        });
                                }}
                            >
                                {t("factLedgerNext")}
                            </button>
                        </div>
                    )}
                </details>
            )}

            <div className="mt-3 flex items-start gap-2 text-xs text-amber-200/80">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                <span>{t("factLedgerCaution")}</span>
            </div>
        </section>
    );
}
