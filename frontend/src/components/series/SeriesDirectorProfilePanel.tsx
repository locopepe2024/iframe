"use client";
import { useEffect, useState } from "react";
import { BrainCircuit, Check, Loader2, Save, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";

export default function SeriesDirectorProfilePanel({ seriesId, onSaved }: { seriesId: string; onSaved: () => void }) {
  const t = useTranslations("series");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [contextText, setContextText] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const dirty = draftText !== savedText;

  const load = async () => {
    const state = await api.getSeriesDirectorProfile(seriesId);
    const value = state.draft ?? state.profile;
    const text = value ? JSON.stringify(value, null, 2) : "";
    setDraftText(text); setSavedText(text); setDraftRevision(state.draft_revision ?? 0);
    setConfirmedRevision(state.confirmed_revisions?.at(-1)?.revision ?? null);
    setContextText(JSON.stringify(state.source_context ?? {}, null, 2));
  };
  useEffect(() => { void load().catch(e => setError(String(e?.message || e))); }, [seriesId]);

  const analyze = async () => {
    setBusy("analyze"); setError("");
    try { const profile = await api.analyzeSeriesDirectorProfile(seriesId); const text = JSON.stringify(profile, null, 2); setDraftText(text); setSavedText(""); }
    catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setError("");
    try { const value = JSON.parse(draftText); const result = await api.saveSeriesDirectorDraft(seriesId, value); const text = JSON.stringify(result.draft ?? value, null, 2); setDraftText(text); setSavedText(text); setDraftRevision(result.draft_revision); onSaved(); }
    catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); }
  };
  const confirm = async () => {
    setBusy("confirm"); setError("");
    try { const result = await api.confirmSeriesDirectorProfile(seriesId); setConfirmedRevision(result.revision); onSaved(); }
    catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); }
  };

  return <section className="flex h-full flex-col overflow-hidden bg-surface">
    <header className="flex shrink-0 items-center gap-3 border-b border-glass-border px-8 py-5">
      <BrainCircuit size={22} className="text-emerald-400" />
      <div className="flex-1"><h2 className="font-display text-xl text-foreground">{t("seriesDirectorTitle")}</h2><p className="mt-1 text-xs text-text-secondary">{t("seriesDirectorHint")}</p></div>
      {confirmedRevision && <span className="text-xs text-text-secondary">{t("seriesDirectorConfirmed", { revision: confirmedRevision })}</span>}
      <WorkflowActionButton variant="secondary" leftIcon={<RotateCcw />} loading={busy === "analyze"} disabled={busy !== null} onClick={analyze}>{t("seriesDirectorAnalyze")}</WorkflowActionButton>
    </header>
    {error && <p role="alert" className="mx-8 mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}
    <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
      <div className="flex min-h-0 flex-col gap-3"><label className="text-xs font-medium text-text-secondary">{t("seriesDirectorDraftLabel")}</label><textarea aria-label={t("seriesDirectorDraftLabel")} value={draftText} onChange={e => setDraftText(e.target.value)} className="min-h-[30rem] flex-1 resize-y rounded-lg border border-glass-border bg-background p-4 font-mono text-xs leading-5 text-foreground" spellCheck={false} /><div className="flex items-center justify-between"><span className="text-xs text-text-muted">{dirty ? t("seriesDirectorUnsaved") : t("seriesDirectorSaved", { revision: draftRevision })}</span><div className="flex gap-2"><WorkflowActionButton variant="secondary" leftIcon={<Save />} disabled={!dirty || busy !== null} loading={busy === "save"} onClick={save}>{t("seriesDirectorSave")}</WorkflowActionButton><WorkflowActionButton leftIcon={<Check />} disabled={!draftText || dirty || busy !== null} loading={busy === "confirm"} onClick={confirm}>{t("seriesDirectorConfirm")}</WorkflowActionButton></div></div></div>
      <aside className="rounded-lg border border-glass-border bg-background/30 p-4"><h3 className="text-sm font-semibold text-foreground">{t("seriesDirectorContext")}</h3><p className="mt-1 text-xs leading-5 text-text-secondary">{t("seriesDirectorContextHint")}</p><pre className="mt-3 max-h-[30rem] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-text-muted">{contextText || "{}"}</pre></aside>
    </div>
  </section>;
}
