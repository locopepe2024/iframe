"use client";
import { useEffect, useState } from "react";
import { BrainCircuit, Check, Loader2, Save, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import DirectorOverviewTemplateEditor, { type OverviewTemplateState } from "@/components/modules/DirectorOverviewTemplateEditor";

export default function SeriesDirectorProfilePanel({ seriesId, onSaved }: { seriesId: string; onSaved: () => void }) {
  const t = useTranslations("series");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [contextText, setContextText] = useState("");
  const [savedContextText, setSavedContextText] = useState("");
  const [sourceAudit, setSourceAudit] = useState<Record<string, unknown> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | "saveContext" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [overviewTemplate, setOverviewTemplate] = useState<OverviewTemplateState | null>(null);
  const dirty = draftText !== savedText;

  const load = async () => {
    const state = await api.getSeriesDirectorProfile(seriesId);
    const value = state.draft ?? state.profile;
    const text = value ? JSON.stringify(value, null, 2) : "";
    setDraftText(text); setSavedText(text); setDraftRevision(state.draft_revision ?? 0);
    setConfirmedRevision(state.confirmed_revisions?.at(-1)?.revision ?? null);
    const context = state.source_context ?? {};
    const contextValue = typeof context.text === "string" ? context.text : (typeof context.preamble === "string" ? context.preamble : "");
    setContextText(contextValue); setSavedContextText(contextValue);
  };
  useEffect(() => { void load().catch(e => setError(String(e?.message || e))); }, [seriesId]);
  useEffect(() => {
    let active = true;
    void api.getDirectorOverviewTemplate("series", seriesId).then(value => { if (active) setOverviewTemplate(value); }).catch(e => { if (active) setError(String(e?.message || e)); });
    return () => { active = false; };
  }, [seriesId]);

  const analyze = async () => {
    setBusy("analyze"); setError("");
    try {
      const result = await api.analyzeSeriesDirectorProfile(seriesId);
      const text = JSON.stringify(result.profile, null, 2);
      setDraftText(text); setSavedText(""); setSourceAudit(result.sourceAudit ?? null);
    }
    catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setError("");
    try {
      let value: Record<string, unknown>;
      try { value = JSON.parse(draftText); } catch {
        await api.saveSeriesSourceContext(seriesId, draftText);
        setContextText(draftText); setSavedContextText(draftText);
        setDraftText(""); setSavedText("");
        setError("已将自然语言内容保存为全剧资料；Director 理解仍需点击“生成全剧理解”。");
        onSaved();
        return;
      }
      const result = await api.saveSeriesDirectorDraft(seriesId, value); const text = JSON.stringify(result.draft ?? value, null, 2); setDraftText(text); setSavedText(text); setDraftRevision(result.draft_revision); onSaved();
    }
    catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); }
  };
  const saveContext = async () => {
    setBusy("saveContext"); setError("");
    try { await api.saveSeriesSourceContext(seriesId, contextText); setSavedContextText(contextText); onSaved(); }
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
    <div className="min-h-0 flex-1 overflow-y-auto p-8">
      {overviewTemplate && <details className="mb-5 rounded-lg border border-glass-border bg-background/30 p-4"><summary className="cursor-pointer text-sm font-medium">导演总览模板</summary><DirectorOverviewTemplateEditor scope="series" id={seriesId} state={overviewTemplate} onSaved={setOverviewTemplate} /></details>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="flex flex-col gap-3 rounded-lg border border-glass-border bg-background/30 p-5">
          <label className="text-xs font-medium text-text-secondary">{t("seriesDirectorContextInputLabel")}</label>
          <p className="text-xs leading-5 text-text-secondary">{t("seriesDirectorContextInputHint")}</p>
          <textarea aria-label={t("seriesDirectorContextInputLabel")} value={contextText} onChange={e => setContextText(e.target.value)} className="min-h-[14rem] resize-y rounded-lg border border-glass-border bg-background p-4 text-sm leading-6 text-foreground" />
          <div className="flex items-center justify-between"><span className="text-xs text-text-muted">{contextText !== savedContextText ? t("seriesDirectorContextUnsaved") : t("seriesDirectorContextSaved")}</span><WorkflowActionButton variant="secondary" leftIcon={<Save />} disabled={contextText === savedContextText || busy !== null} loading={busy === "saveContext"} onClick={saveContext}>{t("seriesDirectorContextSave")}</WorkflowActionButton></div>
        </div>
        <aside className="rounded-lg border border-glass-border bg-background/30 p-4"><h3 className="text-sm font-semibold text-foreground">{t("seriesDirectorContext")}</h3><p className="mt-1 text-xs leading-5 text-text-secondary">{t("seriesDirectorContextHint")}</p><p className="mt-3 text-xs leading-5 text-text-muted">{contextText ? `${contextText.length} 字符，作为全剧 Director 输入。` : t("seriesDirectorContextEmpty")}</p>{sourceAudit && <><h3 className="mt-4 text-sm font-semibold text-foreground">分析来源</h3><p className="mt-1 text-xs leading-5 text-text-secondary">本次结果来自可追溯的原文范围和分块摘要；它们只用于审阅来源，不是新的剧本事实。</p><pre className="mt-3 max-h-[12rem] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-text-muted">{JSON.stringify({ source_mode: sourceAudit.source_mode, source_char_count: sourceAudit.source_char_count, chunk_count: sourceAudit.chunk_count, chunk_ranges: sourceAudit.chunk_ranges, raw_response_received: sourceAudit.raw_response_received }, null, 2)}</pre></>}</aside>
      </div>
      <div className="mt-5 flex min-h-0 flex-col gap-3 rounded-lg border border-glass-border bg-background/30 p-5"><label className="text-xs font-medium text-text-secondary">{t("seriesDirectorDraftLabel")}</label><p className="text-xs leading-5 text-text-secondary">{t("seriesDirectorDraftHint")}</p><textarea aria-label={t("seriesDirectorDraftLabel")} value={draftText} onChange={e => setDraftText(e.target.value)} className="min-h-[22rem] resize-y rounded-lg border border-glass-border bg-background p-4 font-mono text-xs leading-5 text-foreground" spellCheck={false} /><div className="flex items-center justify-between"><span className="text-xs text-text-muted">{dirty ? t("seriesDirectorUnsaved") : t("seriesDirectorSaved", { revision: draftRevision })}</span><div className="flex gap-2"><WorkflowActionButton variant="secondary" leftIcon={<Save />} disabled={!dirty || busy !== null} loading={busy === "save"} onClick={save}>{t("seriesDirectorSave")}</WorkflowActionButton><WorkflowActionButton leftIcon={<Check />} disabled={!draftText || dirty || busy !== null} loading={busy === "confirm"} onClick={confirm}>{t("seriesDirectorConfirm")}</WorkflowActionButton></div></div></div>
    </div>
  </section>;
}
