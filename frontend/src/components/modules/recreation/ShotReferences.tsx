"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Pencil, Save, Search, Upload, X } from "lucide-react";
import { API_URL } from "@/lib/api";
import { recreationApi, RecreationMedia, RecreationProject, RecreationShot, RecreationPlan, seconds } from "@/lib/recreation";

const ImageEditor = dynamic(() => import("@/components/shared/image-editor/ImageEditor"), { ssr: false });
const url = (path: string) => path.startsWith("/") ? `${API_URL}${path}` : path;
type Role = "reference" | "replacement";

function Picker({ onSelect, onClose }: { onSelect: (item: RecreationMedia) => void; onClose: () => void }) {
  const t = useTranslations("shotReferences");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("evidence_frame");
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState<{ items: RecreationMedia[]; next_cursor: number | null }>({ items: [], next_cursor: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(false);
    recreationApi.searchMedia({ q: search, kind, cursor, limit: 12 }).then(result => { if (active) setPage(result); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [search, kind, cursor, retry]);
  return <section aria-label={t("choose")} className="border-y border-border py-4 space-y-3">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setCursor(0); setSearch(query); }}>
      <input className="glass-input min-w-0 flex-1" aria-label={t("search")} value={query} onChange={e => setQuery(e.target.value)} />
      <button className="glass-button" title={t("search")} aria-label={t("search")}><Search size={16} /></button>
      <select className="glass-input max-w-full" aria-label={t("kind")} value={kind} onChange={e => { setKind(e.target.value); setCursor(0); }}>
        {["evidence_frame", "sample_frame", "contact_sheet", "reference_image", "replacement_image"].map(k => <option key={k} value={k}>{t(k)}</option>)}
      </select>
      <button type="button" className="glass-button" title={t("close")} aria-label={t("close")} onClick={onClose}><X size={16} /></button>
    </form>
    {error ? <div role="alert">{t("failed")} <button className="glass-button" onClick={() => setRetry(n => n + 1)}>{t("retry")}</button></div>
      : busy ? <p role="status">{t("loading")}</p> : <>
        {!page.items.length && <p>{t("empty")}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{page.items.map(item => <button type="button" key={item.media_id} className="min-w-0 rounded-lg border border-border overflow-hidden text-left" onClick={() => onSelect(item)}>
          <img loading="lazy" src={url(item.storage_path)} alt="" className="aspect-video w-full object-contain" /><span className="block p-2 text-sm truncate">{item.display_name}</span>
        </button>)}</div>
      </>}
    <div className="flex gap-2">
      <button className="glass-button" disabled={busy || cursor === 0} onClick={() => setCursor(n => Math.max(0, n - 12))}>{t("previous")}</button>
      <button className="glass-button" disabled={busy || error || page.next_cursor === null} onClick={() => setCursor(page.next_cursor!)}>{t("next")}</button>
    </div>
  </section>;
}

export default function ShotReferences({ project, disabled, onSaved }: { project: RecreationProject; disabled: boolean; onSaved: (project: RecreationProject) => void }) {
  const t = useTranslations("shotReferences");
  const [shotId, setShotId] = useState(project.timeline?.shots[0]?.id);
  const shot = project.timeline?.shots.find(s => s.id === shotId);
  const [plan, setPlan] = useState<RecreationPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState(false);
  const revision = useRef(project.revision);
  revision.current = project.revision;
  useEffect(() => { setPlan(null); setPlanError(false); }, [project.revision]);
  return <section className="border-t border-border py-5 space-y-4">
    <h3 className="font-semibold">{t("title")}</h3>
    {disabled && <p role="status">{t("confirmFirst")}</p>}
    <select aria-label={t("shot")} className="glass-input max-w-full" value={shotId || ""} onChange={e => setShotId(e.target.value)}>
      {project.timeline?.shots.map((s, i) => <option key={s.id} value={s.id}>{t("shot")} {i + 1} · {seconds(project.analysis!, s.start_pts).toFixed(6)} - {seconds(project.analysis!, s.end_pts).toFixed(6)} s</option>)}
    </select>
    {shot?.id && <ReferenceForm key={`${project.id}:${shot.id}`} project={project} shot={shot} disabled={disabled} onSaved={onSaved} />}
    <button className="glass-button" disabled={disabled || planBusy} onClick={async () => {
      const current = project.revision; setPlanBusy(true); setPlanError(false);
      try { const result = await recreationApi.generationPlan(project); if (revision.current === current) setPlan(result); }
      catch { if (revision.current === current) setPlanError(true); } finally { setPlanBusy(false); }
    }}>{t("checkPlan")}</button>
    {planError && <p role="alert">{t("failed")}</p>}
    {plan && !disabled && <div className="space-y-3">
      <p role="status">{t(plan.ready ? "planReady" : "planBlocked")}</p>
      {plan.blockers.map(block => <p key={block.shot_id}>{t("shot")} {block.shot_number}: {block.reasons.map(reason => t(reason)).join(" / ")}</p>)}
      {plan.shots.map(item => <details key={item.shot_id} className="border-t border-border py-2">
        <summary>{t("shot")} {item.shot_number} · {item.target_duration} s</summary>
        {item.images.map((image, i) => <p key={`${image.media_id}:${i}`} className="text-xs break-all">{image.label} · {image.media_id}</p>)}
        {item.prompt && <pre className="whitespace-pre-wrap break-words text-sm mt-2">{item.prompt}</pre>}
      </details>)}
    </div>}
  </section>;
}

function ReferenceForm({ project, shot, disabled, onSaved }: { project: RecreationProject; shot: RecreationShot; disabled: boolean; onSaved: (project: RecreationProject) => void }) {
  const t = useTranslations("shotReferences");
  const [selected, setSelected] = useState<Partial<Record<Role, RecreationMedia>>>({});
  const [description, setDescription] = useState(shot.description || "");
  const [instruction, setInstruction] = useState(shot.instruction || "");
  const [picker, setPicker] = useState<Role | null>(null);
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setFailed(false);
    Promise.all((["reference", "replacement"] as Role[]).map(async role => {
      const id = shot[`${role}_media_id`]; return [role, id ? await recreationApi.media(id) : undefined] as const;
    })).then(entries => { if (active) { setSelected(Object.fromEntries(entries)); setLoaded(true); } })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // Draft fields stay local until explicitly saved; revisions do not reset them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  const choose = (role: Role, item?: RecreationMedia) => { setSelected(all => ({ ...all, [role]: item })); setSaved(false); };
  async function upload(file: File, role: Role, parentId?: string) {
    if (file.size > 25 * 1024 * 1024) throw new Error("Image exceeds 25 MiB");
    const item = await recreationApi.uploadImage(project.id, file, role === "reference" ? "reference_image" : "replacement_image", parentId);
    if (alive.current) choose(role, item);
  }
  return <div className="space-y-4">
    {failed && <div role="alert">{t("failed")}{!loaded && <button className="glass-button" onClick={() => setRetry(n => n + 1)}>{t("retry")}</button>}</div>}
    {saved && <p role="status">{t("saved")}</p>}
    <fieldset disabled={disabled || busy || !loaded} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">{(["reference", "replacement"] as Role[]).map(role => <div key={role} className="min-w-0">
        <h4 className="text-sm font-medium mb-2">{t(role)}</h4>
        {selected[role] && <><img src={url(selected[role]!.storage_path)} alt={t(role)} className="aspect-video w-full object-contain bg-black" /><p className="text-sm break-words">{selected[role]!.display_name}</p></>}
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" className="glass-button" onClick={() => setPicker(role)}>{t("choose")}</button>
          <label className="glass-button flex items-center gap-2 cursor-pointer"><Upload size={16} />{t("upload")}
            <input type="file" aria-label={t(role) + " " + t("upload")} accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              setBusy(true); setFailed(false);
              try { await upload(file, role); } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); }
            }} /></label>
          {selected[role] && <button type="button" className="glass-button" title={t("detach")} aria-label={t("detach") + " " + t(role)} onClick={() => choose(role)}><X size={16} /></button>}
          {role === "reference" && selected.reference && <button type="button" className="glass-button" title={t("edit")} aria-label={t("edit")} onClick={() => setEditor(true)}><Pencil size={16} /></button>}
        </div>
      </div>)}</div>
      {picker && <Picker onClose={() => setPicker(null)} onSelect={item => { choose(picker, item); setPicker(null); }} />}
      <label className="block text-sm">{t("description")}<textarea className="glass-input block w-full mt-2" rows={4} maxLength={6000} value={description} onChange={e => { setDescription(e.target.value); setSaved(false); }} /></label>
      <label className="block text-sm">{t("instruction")}<textarea className="glass-input block w-full mt-2" rows={3} maxLength={4000} value={instruction} onChange={e => { setInstruction(e.target.value); setSaved(false); }} /></label>
      <button type="button" className="glass-button flex items-center gap-2" onClick={async () => {
        setBusy(true); setFailed(false); setSaved(false);
        try {
          const result = await recreationApi.bindShot(project, shot.id!, { reference_media_id: selected.reference?.media_id || null, replacement_media_id: selected.replacement?.media_id || null, instruction, description });
          if (alive.current) { onSaved(result); setSaved(true); }
        } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); }
      }}><Save size={16} />{t("save")}</button>
    </fieldset>
    {editor && selected.reference && <ImageEditor source={url(selected.reference.storage_path)} title={selected.reference.display_name} onClose={() => setEditor(false)} onSave={async file => {
      await upload(file, "reference", selected.reference!.media_id); if (alive.current) setEditor(false);
    }} />}
  </div>;
}
