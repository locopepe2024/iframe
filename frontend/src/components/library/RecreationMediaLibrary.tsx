"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";
import { recreationApi, RecreationMedia, RecreationMediaKind, RecreationProject } from "@/lib/recreation";

const kinds: RecreationMediaKind[] = ["source_video", "contact_sheet", "evidence_frame", "sample_frame", "reference_image", "replacement_image"];
const mediaUrl = (path: string) => path.startsWith("/") ? `${API_URL}${path}` : path;

export default function RecreationMediaLibrary() {
  const t = useTranslations("recreationMedia");
  const [projects, setProjects] = useState<RecreationProject[]>([]);
  const [projectError, setProjectError] = useState(false);
  const [draft, setDraft] = useState("");
  const [filters, setFilters] = useState({ q: "", kind: "", project_id: "" });
  const [items, setItems] = useState<RecreationMedia[]>([]);
  const [cursor, setCursor] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<RecreationMedia | null>(null);

  useEffect(() => {
    let active = true;
    setProjectError(false);
    recreationApi.list().then(result => { if (active) setProjects(result); })
      .catch(() => { if (active) setProjectError(true); });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    let active = true;
    setBusy(true); setError(false);
    recreationApi.searchMedia({ q: filters.q || undefined, kind: filters.kind || undefined,
      project_id: filters.project_id || undefined, limit: 24, cursor }).then(page => {
      if (!active) return;
      setItems(previous => Array.from(new Map([...(cursor === 0 ? [] : previous), ...page.items].map(item => [item.media_id, item])).values()));
      setNext(page.next_cursor);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [filters, cursor, retry]);

  function filter(patch: Partial<typeof filters>) {
    setFilters(current => ({ ...current, ...patch }));
    setCursor(0); setNext(null); setItems([]); setSelected(null);
  }
  const sourceName = (id: string) => projects.find(project => project.id === id)?.title || id;

  return <section className="flex-1 min-h-0 overflow-y-auto p-4 md:p-7" aria-label={t("media")}>
    <h1 className="text-2xl font-semibold mb-4">{t("media")}</h1>
    <form className="flex flex-wrap gap-3 mb-4" onSubmit={event => { event.preventDefault(); filter({ q: draft.trim() }); }}>
      <input aria-label={t("search")} placeholder={t("search")} value={draft} onChange={event => setDraft(event.target.value)} className="glass-input min-w-0 flex-1" />
      <button className="glass-button" type="submit">{t("searchButton")}</button>
      <select aria-label={t("kind")} value={filters.kind} onChange={event => filter({ kind: event.target.value })} className="glass-input max-w-full">
        <option value="">{t("allKinds")}</option>{kinds.map(kind => <option key={kind} value={kind}>{t(kind)}</option>)}
      </select>
      <select aria-label={t("project")} value={filters.project_id} onChange={event => filter({ project_id: event.target.value })} className="glass-input max-w-full">
        <option value="">{t("allProjects")}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select>
    </form>
    {(error || projectError) && <div role="alert" className="mb-4">
      <p>{t(error ? "error" : "projectError")}</p>
      <button type="button" disabled={busy} className="glass-button" onClick={() => setRetry(value => value + 1)}>{t("retry")}</button>
    </div>}
    <p role="status" className="text-text-secondary mb-3">{busy ? t("loading") : t("loaded", { count: items.length })}</p>
    {!busy && !error && items.length === 0 && <p>{t("empty")}</p>}
    {selected && <div className="glass-panel rounded-xl p-4 mb-5">
      <button type="button" className="glass-button mb-3" onClick={() => setSelected(null)}>{t("close")}</button>
      <h2 className="break-words">{selected.display_name}</h2>
      {selected.kind === "source_video" ? <video controls preload="metadata" src={mediaUrl(selected.storage_path)} className="max-h-96 w-full" />
        : <img src={mediaUrl(selected.storage_path)} alt={selected.display_name} className="max-h-96 w-full object-contain" />}
      <dl className="mt-3 text-sm break-all space-y-1">
        <div><dt>{t("project")}</dt><dd>{sourceName(selected.project_id)}</dd></div>
        <div><dt>{t("identity")}</dt><dd>{selected.media_id}</dd></div>
        {selected.metadata.parent_media_id && <div><dt>{t("parent")}</dt><dd>{selected.metadata.parent_media_id}</dd></div>}
        {selected.metadata.analysis_id && <div><dt>{t("analysis")}</dt><dd>{selected.metadata.analysis_id}</dd></div>}
        {selected.metadata.pts != null && <div><dt>{t("timestamp")}</dt><dd>{selected.metadata.pts} ({selected.metadata.time_base}) · {selected.metadata.role}</dd></div>}
      </dl>
    </div>}
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map(item => <button key={item.media_id} type="button" onClick={() => setSelected(item)} aria-label={t("preview", { name: item.display_name })}
        className="glass-panel min-w-0 rounded-xl overflow-hidden text-left focus-visible:ring-2 focus-visible:ring-primary">
        {item.kind === "source_video" ? <div className="aspect-video grid place-items-center bg-surface-inset">{t("source_video")}</div>
          : <img loading="lazy" src={mediaUrl(item.storage_path)} alt="" className="aspect-video w-full object-contain bg-surface-inset" />}
        <div className="p-3"><p className="truncate">{item.display_name}</p><p className="text-sm text-text-secondary truncate">{t(item.kind)} · {sourceName(item.project_id)}</p></div>
      </button>)}
    </div>
    {next !== null && !error && <button type="button" disabled={busy} onClick={() => setCursor(next)} className="glass-button mt-5">{t("more")}</button>}
  </section>;
}
