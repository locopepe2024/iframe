"use client";
import { useEffect, useState } from "react";
import { BrainCircuit, Check, Loader2, Save, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import type { DirectorProfile } from "@/store/projectStore";

function readable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(item => readable(item)).filter(Boolean).join("；");
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return readable(item.description ?? item.summary ?? item.event ?? item.title ?? item.arc ?? item.change ?? item.label);
  }
  return "";
}

function SeriesUnderstandingReport({ profile, t }: { profile: DirectorProfile | null; t: ReturnType<typeof useTranslations> }) {
  if (!profile) return <p className="text-sm text-text-muted">{t("seriesUnderstandingEmpty")}</p>;
  const setting = profile.setting || {};
  const sections = [
    { title: t("seriesUnderstandingWorld"), values: [readable(setting.premise), readable(setting.story_summary), readable(setting.world_overview), readable(setting.era), readable(setting.geography)] },
    { title: t("seriesUnderstandingProgress"), values: [...(profile.timeline || [])].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).map(readable) },
    { title: t("seriesUnderstandingEvents"), values: (profile.key_events || []).map(readable) },
    { title: t("seriesUnderstandingRelationships"), values: (profile.relationships || []).map(readable) },
    { title: t("seriesUnderstandingContinuity"), values: (profile.continuity_constraints || []).map(readable) },
    { title: t("seriesUnderstandingQuestions"), values: (profile.unresolved_questions || []).map(readable) },
  ].map(section => ({ ...section, values: section.values.filter(Boolean) })).filter(section => section.values.length);
  if (!sections.length) return <p className="text-sm text-text-muted">{t("seriesUnderstandingNoReadableFields")}</p>;
  return <div className="grid gap-4 md:grid-cols-2">
    {sections.map(section => <section key={section.title} className="rounded-lg border border-glass-border bg-background/30 p-4">
      <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-text-secondary">{section.values.map((value, index) => <li key={`${section.title}-${index}`}>{value}</li>)}</ul>
    </section>)}
  </div>;
}

export default function SeriesDirectorProfilePanel({ seriesId, onSaved }: { seriesId: string; onSaved: () => void }) {
  const t = useTranslations("series");
  const [draftText, setDraftText] = useState("");
  const [profile, setProfile] = useState<DirectorProfile | null>(null);
  const [savedText, setSavedText] = useState("");
  const [contextText, setContextText] = useState("");
  const [savedContextText, setSavedContextText] = useState("");
  const [sourceAudit, setSourceAudit] = useState<Record<string, unknown> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [styleReviewRequired, setStyleReviewRequired] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "save" | "saveContext" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const dirty = draftText !== savedText;

  const load = async () => {
    const state = await api.getSeriesDirectorProfile(seriesId);
    const value = state.draft ?? state.profile;
    setProfile(value ? value as unknown as DirectorProfile : null);
    setHasDraft(Boolean(state.draft));
    const text = value ? JSON.stringify(value, null, 2) : "";
    setDraftText(text); setSavedText(text); setDraftRevision(state.draft_revision ?? 0);
    setConfirmedRevision(state.confirmed_revisions?.at(-1)?.revision ?? null);
    setStyleReviewRequired(state.style_review_required ?? false);
    const context = state.source_context ?? {};
    const contextValue = typeof context.text === "string" ? context.text : (typeof context.preamble === "string" ? context.preamble : "");
    setContextText(contextValue); setSavedContextText(contextValue);
  };
  useEffect(() => { void load().catch(e => setError(String(e?.message || e))); }, [seriesId]);

  const analyze = async () => {
    setBusy("analyze"); setError("");
    try {
      const result = await api.analyzeSeriesDirectorProfile(seriesId);
      setProfile(result.profile as unknown as DirectorProfile);
      setHasDraft(true);
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
      const result = await api.saveSeriesDirectorDraft(seriesId, value); const savedProfile = (result.draft ?? value) as unknown as DirectorProfile; setProfile(savedProfile); setHasDraft(true); const text = JSON.stringify(savedProfile, null, 2); setDraftText(text); setSavedText(text); setDraftRevision(result.draft_revision); onSaved();
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
    try { const result = await api.confirmSeriesDirectorProfile(seriesId); setConfirmedRevision(result.revision); setHasDraft(false); setStyleReviewRequired(false); onSaved(); }
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
    {styleReviewRequired && <p role="status" className="mx-8 mt-4 rounded border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{t("seriesDirectorStyleReview")}</p>}
    <div className="min-h-0 flex-1 overflow-y-auto p-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="flex flex-col gap-3 rounded-lg border border-glass-border bg-background/30 p-5">
          <label className="text-xs font-medium text-text-secondary">{t("seriesDirectorContextInputLabel")}</label>
          <p className="text-xs leading-5 text-text-secondary">{t("seriesDirectorContextInputHint")}</p>
          <textarea aria-label={t("seriesDirectorContextInputLabel")} value={contextText} onChange={e => setContextText(e.target.value)} className="min-h-[14rem] resize-y rounded-lg border border-glass-border bg-background p-4 text-sm leading-6 text-foreground" />
          <div className="flex items-center justify-between"><span className="text-xs text-text-muted">{contextText !== savedContextText ? t("seriesDirectorContextUnsaved") : t("seriesDirectorContextSaved")}</span><WorkflowActionButton variant="secondary" leftIcon={<Save />} disabled={contextText === savedContextText || busy !== null} loading={busy === "saveContext"} onClick={saveContext}>{t("seriesDirectorContextSave")}</WorkflowActionButton></div>
        </div>
        <aside className="rounded-lg border border-glass-border bg-background/30 p-4"><h3 className="text-sm font-semibold text-foreground">{t("seriesDirectorContext")}</h3><p className="mt-1 text-xs leading-5 text-text-secondary">{t("seriesDirectorContextHint")}</p><p className="mt-3 text-xs leading-5 text-text-muted">{contextText ? `${contextText.length} 字符，作为全剧 Director 输入。` : t("seriesDirectorContextEmpty")}</p>{sourceAudit && <><h3 className="mt-4 text-sm font-semibold text-foreground">分析来源</h3><p className="mt-1 text-xs leading-5 text-text-secondary">本次结果来自可追溯的原文范围和分块摘要；它们只用于审阅来源，不是新的剧本事实。</p><pre className="mt-3 max-h-[12rem] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-text-muted">{JSON.stringify({ source_mode: sourceAudit.source_mode, source_char_count: sourceAudit.source_char_count, chunk_count: sourceAudit.chunk_count, chunk_ranges: sourceAudit.chunk_ranges, raw_response_received: sourceAudit.raw_response_received }, null, 2)}</pre></>}</aside>
      </div>
      <div className="mt-5 rounded-lg border border-glass-border bg-background/30 p-5"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-base font-semibold text-foreground">{t("seriesUnderstandingReport")}</h3><p className="mt-1 text-xs leading-5 text-text-secondary">{t("seriesUnderstandingReportHint")}</p></div>{profile && <span className="rounded border border-glass-border px-2 py-1 text-xs text-text-secondary">{hasDraft ? t("seriesUnderstandingDraft") : confirmedRevision ? t("seriesUnderstandingConfirmed", { revision: confirmedRevision }) : t("seriesUnderstandingUnconfirmed")}</span>}</div><p className="mb-4 rounded border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-text-secondary">{t("seriesUnderstandingCompatibilityNote")}</p><SeriesUnderstandingReport profile={profile} t={t} /></div>
      <details className="mt-5 rounded-lg border border-glass-border bg-background/30 p-5"><summary className="cursor-pointer text-sm font-semibold text-foreground">{t("seriesUnderstandingStructuredDraft")}</summary><div className="mt-3 flex min-h-0 flex-col gap-3"><p className="text-xs leading-5 text-text-secondary">{t("seriesUnderstandingStructuredDraftHint")}</p><textarea aria-label={t("seriesDirectorDraftLabel")} value={draftText} onChange={e => setDraftText(e.target.value)} className="min-h-[22rem] resize-y rounded-lg border border-glass-border bg-background p-4 font-mono text-xs leading-5 text-foreground" spellCheck={false} /><div className="flex items-center justify-between"><span className="text-xs text-text-muted">{dirty ? t("seriesDirectorUnsaved") : t("seriesDirectorSaved", { revision: draftRevision })}</span><div className="flex gap-2"><WorkflowActionButton variant="secondary" leftIcon={<Save />} disabled={!dirty || busy !== null} loading={busy === "save"} onClick={save}>{t("seriesDirectorSave")}</WorkflowActionButton><WorkflowActionButton leftIcon={<Check />} disabled={!draftText || dirty || busy !== null} loading={busy === "confirm"} onClick={confirm}>{t("seriesDirectorConfirm")}</WorkflowActionButton></div></div></div></details>
    </div>
  </section>;
}
