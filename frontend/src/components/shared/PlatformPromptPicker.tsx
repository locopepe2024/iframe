"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { API_URL, api, authenticatedFetch, type PlatformReferenceResource } from "@/lib/api";

export type PromptResource = PlatformReferenceResource & { payload: { prompt_used: string; media_file?: string | null } };

export function isUsablePlatformPrompt(resource: PlatformReferenceResource, categoryPrefix: string): resource is PromptResource {
  return resource.status === "active" && resource.category_path?.startsWith(categoryPrefix) === true
    && (resource.kind === "prompt_preset" || resource.kind === "image")
    && typeof resource.payload?.prompt_used === "string" && resource.payload.prompt_used.trim().length > 0;
}

export default function PlatformPromptPicker({ currentPrompt, onApply, disabled = false, categoryPrefix, stationLabel }: {
  currentPrompt: string;
  onApply: (text: string, resource: PlatformReferenceResource, operation: "replace" | "append") => void;
  disabled?: boolean;
  categoryPrefix: string;
  stationLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState<PromptResource[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const selected = resources.find((resource) => resource.platform_resource_id === selectedId);
  const visible = useMemo(() => resources.filter((resource) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [resource.title, resource.summary, resource.category_path, ...(resource.tags ?? [])]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  }), [query, resources]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError("");
    void api.getPlatformReferenceLibrary().then((catalog) => {
      if (!active) return;
      setResources(catalog.resources.filter((resource): resource is PromptResource => isUsablePlatformPrompt(resource, categoryPrefix)));
    }).catch(() => { if (active) setError("平台参考库读取失败，请重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, categoryPrefix, refresh]);

  useEffect(() => {
    setPreviewUrl("");
    if (!selected || selected.kind !== "image" || !selected.payload.media_file) {
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    void authenticatedFetch(`${API_URL}/platform-reference-library/${encodeURIComponent(selected.platform_resource_id)}/media?preview=true`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        objectUrl = URL.createObjectURL(await response.blob());
        if (!controller.signal.aborted) setPreviewUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setPreviewUrl(""); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);

  const apply = (operation: "replace" | "append") => {
    if (!selected) return;
    const sourcePrompt = selected.payload.prompt_used.trim();
    const text = operation === "append" && currentPrompt.trim()
      ? `${currentPrompt.trim()}\n${sourcePrompt}` : sourcePrompt;
    onApply(text, selected, operation);
    setOpen(false); setSelectedId(""); setQuery("");
  };

  return <section className="mt-2 rounded-md border border-glass-border bg-surface-inset p-2" aria-label={`平台${stationLabel} Prompt`}>
    <button type="button" disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); setSelectedId(""); }}
      className="min-h-11 rounded-md border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      @ 平台 Prompt
    </button>
    {open && <div className="mt-2 rounded-md border border-glass-border bg-elevated p-2">
      <p className="text-xs leading-5 text-text-muted">已发布的{stationLabel} Prompt。案例图片仅用于预览；插入文字不会附加参考图。</p>
      {selected ? <>
        <button type="button" onClick={() => setSelectedId("")} className="mt-2 flex min-h-10 items-center gap-1 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeft size={14} />返回结果</button>
        <h4 className="mt-1 text-sm font-medium text-foreground">{selected.title}</h4>
        <p className="mt-1 break-all text-xs text-text-muted">平台参考 · {selected.category_path} · r{selected.revision} · {selected.provenance.license}</p>
        {previewUrl && <img src={previewUrl} alt={`${selected.title} 案例预览`} className="mt-2 max-h-48 w-full rounded-md object-contain" />}
        <label className="mt-2 block text-xs text-text-secondary" htmlFor="platform-character-prompt-preview">将插入的完整 Prompt</label>
        <textarea id="platform-character-prompt-preview" readOnly value={selected.payload.prompt_used} rows={8}
          className="mt-1 w-full resize-y rounded-md border border-glass-border bg-surface p-2 text-xs leading-5 text-foreground" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => apply("replace")} className="min-h-11 rounded-md bg-primary px-3 text-xs text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">替换当前 Prompt</button>
          {currentPrompt.trim() && <button type="button" onClick={() => apply("append")} className="min-h-11 rounded-md border border-glass-border px-3 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">追加到末尾</button>}
        </div>
      </> : <>
        <label className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-glass-border px-2 text-xs text-foreground focus-within:ring-2 focus-within:ring-primary"><Search size={14} aria-hidden="true" /><input aria-label={`搜索平台${stationLabel} Prompt`} value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
        {loading && <p className="mt-2 text-xs text-text-muted">正在读取平台目录…</p>}
        {error && <div className="mt-2 text-xs text-failed-fg">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)} className="ml-2 underline">重试</button></div>}
        {!loading && !error && visible.length === 0 && <p className="mt-2 text-xs text-text-muted">没有可用的{stationLabel} Prompt 案例。</p>}
        <div className="mt-2 max-h-64 overflow-y-auto">
          {visible.map((resource) => <button key={resource.platform_resource_id} type="button" onClick={() => setSelectedId(resource.platform_resource_id)}
            className="flex min-h-11 w-full flex-col justify-center rounded-md px-2 py-1.5 text-left hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <span className="text-xs font-medium text-foreground">{resource.title}</span>
            <span className="text-[11px] text-text-muted">{resource.kind === "image" ? "带图案例" : "仅 Prompt"} · {resource.category_path} · r{resource.revision}</span>
          </button>)}
        </div>
      </>}
    </div>}
  </section>;
}
