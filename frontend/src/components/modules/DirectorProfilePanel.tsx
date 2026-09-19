"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, Check, RotateCcw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useProjectStore, type DirectorProfile } from "@/store/projectStore";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import { toast } from "@/store/toastStore";
import { extractErrorDetail } from "@/lib/utils";

const editableProfile = (profile?: DirectorProfile) => {
    if (!profile) return "";
    const { revision: _revision, content_hash: _hash, confirmed_at: _confirmed, ...draft } = profile;
    return JSON.stringify(draft, null, 2);
};

export default function DirectorProfilePanel() {
    const t = useTranslations("artDirection");
    const { currentProject, updateProject } = useProjectStore();
    const confirmed = currentProject?.art_direction?.director_profile;
    const [draftText, setDraftText] = useState(() => editableProfile(confirmed));
    const [instruction, setInstruction] = useState("");
    const [history, setHistory] = useState<string[]>([]);
    const [busy, setBusy] = useState<"analyze" | "refine" | "apply" | null>(null);

    useEffect(() => {
        setDraftText(editableProfile(confirmed));
        setInstruction("");
        setHistory([]);
    }, [currentProject?.id, confirmed?.content_hash]);

    const parseDraft = () => {
        const value = JSON.parse(draftText);
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(t("directorInvalidJson"));
        return value;
    };

    const analyze = async () => {
        if (!currentProject) return;
        setBusy("analyze");
        try {
            const profile = await api.analyzeDirectorProfile(currentProject.id);
            setDraftText(JSON.stringify(profile, null, 2));
            setHistory([]);
        } catch (error) {
            toast.error(extractErrorDetail(error, t("directorAnalyzeFailed")));
        } finally {
            setBusy(null);
        }
    };

    const refine = async () => {
        if (!currentProject || !instruction.trim()) return;
        setBusy("refine");
        const nextHistory = [...history, instruction.trim()];
        try {
            const profile = await api.refineDirectorProfile(currentProject.id, parseDraft(), nextHistory);
            setDraftText(JSON.stringify(profile, null, 2));
            setHistory(nextHistory);
            setInstruction("");
        } catch (error) {
            toast.error(extractErrorDetail(error, t("directorRefineFailed")));
        } finally {
            setBusy(null);
        }
    };

    const apply = async () => {
        if (!currentProject) return;
        setBusy("apply");
        try {
            const updated = await api.applyDirectorProfile(currentProject.id, parseDraft());
            updateProject(currentProject.id, updated);
            toast.success(t("directorApplied"), { projectId: currentProject.id, projectTitle: currentProject.title });
        } catch (error) {
            toast.error(extractErrorDetail(error, t("directorApplyFailed")));
        } finally {
            setBusy(null);
        }
    };

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

            {draftText ? (
                <div className="space-y-3">
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
