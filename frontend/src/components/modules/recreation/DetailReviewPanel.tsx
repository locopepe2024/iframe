"use client";

import { useState } from "react";
import { Check, FileInput, Save } from "lucide-react";
import { useLocale } from "next-intl";
import { DetailReview, DetailReviewItem, RecreationProject, recreationApi, ShotReviewDecision } from "@/lib/recreation";

const decisions: ShotReviewDecision[] = ["pending", "accept", "edit", "reject", "unknown"];
const footOptions = {
  screen_foot: ["screen_left", "screen_right", "unknown"],
  anatomical_foot: ["left", "right", "unknown"],
  support_state: ["supporting", "touching", "swinging", "airborne", "unknown"],
  sole_contact: ["full_sole", "heel", "forefoot", "toe", "rolling", "none", "unknown"],
  contact_target: ["ground", "object", "none", "unknown"],
} as const;
type FootValues = NonNullable<DetailReviewItem["reviewed_values"]>;

function candidateFootValues(item: DetailReviewItem): FootValues {
  const source = item.source;
  return {
    screen_foot: source.screen_foot as FootValues["screen_foot"],
    anatomical_foot: source.anatomical_foot as FootValues["anatomical_foot"],
    support_state: source.support_state as FootValues["support_state"],
    sole_contact: source.sole_contact as FootValues["sole_contact"],
    contact_target: source.contact_target as FootValues["contact_target"],
    uncertainty: String(source.uncertainty ?? ""),
  };
}

export default function DetailReviewPanel({ project, timelineKey, onSaved, seek }: {
  project: RecreationProject; timelineKey: string; onSaved: (record: RecreationProject) => void; seek: (frame: number) => void;
}) {
  const zh = useLocale().startsWith("zh");
  const [draft, setDraft] = useState<DetailReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const review = draft && draft.review_revision === project.detail_review?.review_revision ? draft : project.detail_review ?? null;
  const macro = project.macro_review;
  const macroCurrent = Boolean(macro && macro.timeline_key === timelineKey && macro.macro_revision === project.shot_review?.review_revision);
  const detailCurrent = Boolean(review && macroCurrent && review.macro_digest === macro?.digest && review.timeline_key === timelineKey);
  const pending = review?.items.filter(item => item.decision === "pending").length ?? 0;

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const candidate = JSON.parse(await file.text()) as Record<string, unknown>;
      const record = await recreationApi.importDetailReview(project, timelineKey, candidate);
      setDraft(null); onSaved(record);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function save(approve: boolean) {
    if (!review) return;
    setBusy(true); setMessage("");
    try {
      const record = await recreationApi.saveDetailReview(project, timelineKey, review, approve);
      setDraft(null); onSaved(record);
      setMessage(zh ? (approve ? "二审已签收" : "二审草稿已保存") : (approve ? "Detail review approved" : "Detail draft saved"));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const update = (id: string, field: "decision" | "edited_text", value: string) => {
    if (!review) return;
    setDraft({ ...review, items: review.items.map(item => {
      if (item.id !== id) return item;
      if (field === "decision") {
        const { reviewed_values, ...rest } = item;
        return { ...rest, decision: value as ShotReviewDecision,
          ...(value === "edit" && item.kind === "foot" ? { reviewed_values: reviewed_values ?? candidateFootValues(item) } : {}) };
      }
      return { ...item, edited_text: value };
    }) });
  };

  const updateFoot = (id: string, field: keyof FootValues, value: string) => {
    if (!review) return;
    setDraft({ ...review, items: review.items.map(item => item.id === id && item.kind === "foot" && item.decision === "edit"
      ? { ...item, reviewed_values: { ...(item.reviewed_values ?? candidateFootValues(item)), [field]: value } } : item) });
  };

  return <section aria-label={zh ? "逐帧细节二审" : "Frame detail review"} className="border-t border-border pt-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h4 className="text-sm font-semibold">{zh ? "逐帧细节二审" : "Frame detail review"}</h4>
        <p className="text-xs text-text-muted">
          {macroCurrent ? (zh ? `一审已冻结 · v${macro?.macro_revision}` : `Macro frozen · v${macro?.macro_revision}`) : (zh ? "等待一审冻结" : "Awaiting macro freeze")}
          {review && ` · ${review.run_id} · ${review.items.length - pending}/${review.items.length} · ${review.status}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="glass-button inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm"><FileInput size={16} />{zh ? "导入专项分析 JSON" : "Import detail JSON"}<input type="file" accept="application/json,.json" className="sr-only" disabled={!macroCurrent || busy || review?.status === "approved"} onChange={event => void importFile(event.target.files?.[0])} /></label>
        <button type="button" className="glass-button inline-flex min-h-9 items-center gap-2 text-sm" disabled={!detailCurrent || busy || review?.status === "approved"} onClick={() => void save(false)}><Save size={16} />{zh ? "保存二审" : "Save detail"}</button>
        <button type="button" className="glass-button inline-flex min-h-9 items-center gap-2 text-sm" disabled={!detailCurrent || busy || review?.status === "approved" || pending > 0} onClick={() => void save(true)}><Check size={16} />{zh ? "签收二审" : "Approve detail"}</button>
      </div>
    </div>
    {message && <p role="status" className="text-sm text-text-muted break-words">{message}</p>}
    {review && !detailCurrent && <p role="alert" className="text-sm text-amber-300">{zh ? "一审或源帧已改变，细节审核失效。" : "Macro review or source changed; detail review is stale."}</p>}
    {review && <div className="max-h-[50vh] overflow-y-auto border-t border-border divide-y divide-border">
      {review.items.map(item => <div key={item.id} className="py-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2"><button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => seek(item.frame_span[0])}>{item.frame_span[0]}–{item.frame_span[1]}</button><strong className="font-medium">{item.kind}</strong><span className="text-xs text-text-muted">{item.id}</span></div>
        {item.kind === "foot" && <p className="text-xs text-text-muted">{String(item.source.screen_foot)} · {String(item.source.anatomical_foot)} · {String(item.source.support_state)} · {String(item.source.sole_contact)} · {String(item.source.contact_target)}</p>}
        {item.kind === "foot" && item.decision === "edit" && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(footOptions) as (keyof typeof footOptions)[]).map(field => <label key={field} className="text-xs text-text-muted">{field}<select className="glass-input mt-1 block w-full min-h-9 text-foreground" value={item.reviewed_values?.[field] ?? String(item.source[field])} disabled={!detailCurrent || review.status === "approved"} onChange={event => updateFoot(item.id, field, event.target.value)}>{footOptions[field].map(option => <option key={option} value={option}>{option}</option>)}</select></label>)}
          <label className="text-xs text-text-muted sm:col-span-2 lg:col-span-3">{zh ? "不确定原因" : "Uncertainty reason"}<input className="glass-input mt-1 block w-full min-h-9 text-foreground" value={item.reviewed_values?.uncertainty ?? String(item.source.uncertainty ?? "")} disabled={!detailCurrent || review.status === "approved"} onChange={event => updateFoot(item.id, "uncertainty", event.target.value)} /></label>
        </div>}
        <p className="whitespace-pre-wrap">{item.candidate}</p>
        <div className="flex flex-wrap gap-1">{item.evidence_frames.map(frame => <button key={frame} type="button" className="glass-button px-2 py-1 text-xs font-mono" onClick={() => seek(frame)}>{frame}</button>)}</div>
        <div className="flex flex-wrap gap-2"><select className="glass-input min-h-9 text-foreground" aria-label={zh ? "审核结论" : "Decision"} value={item.decision} disabled={!detailCurrent || review.status === "approved"} onChange={event => update(item.id, "decision", event.target.value)}>{decisions.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <textarea className="glass-input min-h-9 min-w-[220px] flex-1 text-foreground" aria-label={zh ? "人工修订" : "Human correction"} value={item.edited_text} disabled={!detailCurrent || review.status === "approved"} onChange={event => update(item.id, "edited_text", event.target.value)} /></div>
      </div>)}
    </div>}
  </section>;
}
