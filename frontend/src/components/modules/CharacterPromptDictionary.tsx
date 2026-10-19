"use client";

import { useEffect, useId, useState, type MutableRefObject } from "react";
import { API_URL, api, authenticatedFetch, type PlatformReferenceResource } from "@/lib/api";
import { searchCharacterQuickPresets } from "@/lib/characterQuickActions";
import { editablePlatformPrompt, isUsablePlatformPrompt } from "@/lib/platformPrompts";
import type { PromptSlashSuggestion } from "./playground/ReferencePromptEditor";

type Entry = {
  id: string; title: string; text: string; type: "词条" | "组合方案" | "Prompt 案例" | "Skill";
  domain: string; source: string; search: string; resource?: PlatformReferenceResource;
};
const DOMAINS: Record<string, string> = {
  "character.identity": "身份", "character.look": "造型", "character.performance": "表演", "world.style": "风格",
};
const buttonStyle = "min-h-11 rounded px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary hover:bg-hover-bg";

export default function CharacterPromptDictionary({ suggestion, onClose, onApply, onSkill, canRunSkill, keyHandler }: {
  suggestion: PromptSlashSuggestion;
  onClose: () => void;
  onApply: (text: string, source: Entry) => void;
  onSkill?: () => void;
  canRunSkill: boolean;
  keyHandler: MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}) {
  const id = useId();
  const [resources, setResources] = useState<PlatformReferenceResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [type, setType] = useState("全部");
  const [domain, setDomain] = useState("全部");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [active, setActive] = useState(0);
  const needle = suggestion.query.trim().toLocaleLowerCase();
  useEffect(() => {
    setPreviewUrl("");
    const resource = selected?.resource;
    if (resource?.kind !== "image" || !resource.payload?.media_file) return;
    const controller = new AbortController();
    let objectUrl = "";
    void authenticatedFetch(`${API_URL}/platform-reference-library/${encodeURIComponent(resource.platform_resource_id)}/media?preview=true`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setPreviewUrl(""); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(false);
    void api.getPlatformReferenceLibrary().then((catalog) => { if (live) setResources(catalog.resources); })
      .catch(() => { if (live) { setResources([]); setError(true); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refresh]);
  const terms = resources.filter((resource) => resource.status === "active" && resource.kind === "prompt_preset"
    && resource.dictionary?.entry_type === "term" && DOMAINS[resource.dictionary.semantic_domain]
    && resource.payload?.structured_prompt?.content?.trim());
  const entries: Entry[] = searchCharacterQuickPresets("").map((preset) => ({
    id: preset.id, title: preset.label, text: preset.target === "route" ? preset.label : preset.value,
    type: "词条", domain: DOMAINS[preset.semanticDomain], source: `${preset.source} · v${preset.revision}`, search: preset.searchText,
  }));
  for (const resource of resources) {
    if (resource.status !== "active") continue;
    const source = `平台 · ${resource.platform_resource_id} · r${resource.revision} · ${resource.provenance.license}`;
    const common = { id: resource.platform_resource_id, title: resource.title, source, resource,
      domain: DOMAINS[resource.dictionary?.semantic_domain || ""] || "案例",
      search: [resource.title, resource.summary, resource.category_path, ...(resource.tags || [])].join(" ") };
    if (terms.includes(resource)) entries.push({ ...common, type: "词条", text: resource.payload!.structured_prompt!.content! });
    else if (isUsablePlatformPrompt(resource, "character/")) entries.push({ ...common, type: "Prompt 案例", text: editablePlatformPrompt(resource) });
    else if (resource.kind === "prompt_preset" && resource.dictionary?.entry_type === "pattern") {
      const members = resource.dictionary.members || [];
      const resolved = members.map((member) => terms.find((term) => term.platform_resource_id === member.platform_resource_id
        && term.revision === member.revision && term.dictionary?.semantic_domain === resource.dictionary?.semantic_domain));
      if (members.length >= 2 && members.length <= 12 && resolved.every(Boolean)
        && new Set(members.map((member) => `${member.platform_resource_id}@${member.revision}`)).size === members.length) {
        entries.push({ ...common, type: "组合方案", text: resolved.map((term) => term!.payload!.structured_prompt!.content).join("；") });
      }
    }
  }
  if (onSkill) entries.unshift({ id: "character-visual-design", title: "生成角色视觉设计草稿", type: "Skill", domain: "Skill",
    text: "角色身份与造型双 Skill 流程。输入：角色描述、侧栏身份与造型草稿及已选设计参考。下一步审核实际模型输入，确认后才执行。", source: "当前角色台已接入 Skill", search: "skill 技能 角色设计 身份 外观 草稿" });
  const visible = entries.filter((entry) => (!needle || `${entry.title} ${entry.search} ${entry.text}`.toLocaleLowerCase().includes(needle))
    && (type === "全部" || entry.type === type) && (domain === "全部" || entry.domain === domain));
  useEffect(() => { setActive(0); setSelected(null); }, [needle, type, domain]);
  const apply = () => {
    if (!selected) return;
    if (selected.type === "Skill") {
      if (!canRunSkill) return;
      suggestion.replaceWithText(""); onClose(); onSkill?.();
    } else { onApply(suggestion.replaceWithText(selected.text), selected); onClose(); }
  };
  useEffect(() => {
    keyHandler.current = (event) => {
      if (event.isComposing) return false;
      if (event.key === "Escape") { if (selected) setSelected(null); else onClose(); return true; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive((index) => visible.length ? (index + (event.key === "ArrowDown" ? 1 : visible.length - 1)) % visible.length : 0); return true;
      }
      if (event.key === "Enter") { if (selected) apply(); else if (visible.length) setSelected(visible[Math.min(active, visible.length - 1)]); return true; }
      return false;
    };
    return () => { keyHandler.current = null; };
  });
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, active]);
  return <div data-prompt-discovery role="dialog" aria-label="词典和 Skill 检索" onMouseDown={(event) => event.preventDefault()}
    className="absolute top-12 left-3 right-3 z-50 mb-2 max-h-[min(60vh,440px)] overflow-y-auto rounded-lg border border-glass-border bg-elevated p-3 shadow-xl">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-foreground">/ 词典和 Skill</p><button type="button" onClick={onClose} className={buttonStyle}>关闭</button></div>
    {selected ? <>
      <h4 className="mt-2 text-sm text-foreground">{selected.type} · {selected.title}</h4>
      <p className="mt-1 break-all text-xs text-text-muted">{selected.source}</p>
      {previewUrl && <img src={previewUrl} alt={`${selected.title} 案例预览`} className="mt-2 max-h-40 w-full rounded object-contain" />}
      <label className="mt-2 block text-xs text-text-secondary" htmlFor={`${id}-preview`}>{selected.type === "Skill" ? "Skill 操作说明" : "将插入的完整文字"}</label>
      <textarea id={`${id}-preview`} readOnly value={selected.text} rows={5} className="mt-1 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
      <p className="mt-1 text-xs text-text-muted">{selected.type === "Skill" ? "确认后进入输入审核。" : "替换光标处的 /检索词，保留其他文字与参考图；插入后可编辑。"}</p>
      <button type="button" disabled={selected.type === "Skill" && !canRunSkill} onClick={apply} className={`${buttonStyle} mt-2 bg-primary text-primary-foreground disabled:opacity-50`}>{selected.type === "Skill" ? "审核 Skill 输入" : "插入到当前 Prompt"}</button>
      {selected.type === "Skill" && !canRunSkill && <p className="text-xs text-text-muted">请先填写角色描述并选择设计模型，或等待当前设计完成。</p>}
      <button type="button" onClick={() => setSelected(null)} className={`${buttonStyle} ml-2`}>返回结果</button>
    </> : <>
      <div role="group" aria-label="词典内容类型" className="mt-2 flex flex-wrap gap-1">{["全部", "词条", "组合方案", "Prompt 案例", "Skill"].map((label) => <button key={label} type="button" aria-pressed={type === label} onClick={() => setType(label)} className={`${buttonStyle} ${type === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>
      <div role="group" aria-label="词典语义层" className="flex flex-wrap gap-1">{["全部", ...Object.values(DOMAINS)].map((label) => <button key={label} type="button" aria-pressed={domain === label} onClick={() => setDomain(label)} className={`${buttonStyle} ${domain === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>
      {loading && <p role="status" className="text-xs text-text-muted">正在读取平台词典…</p>}
      {error && <p role="status" className="text-xs text-text-muted">平台词典读取失败，本地词条仍可使用。<button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>重试</button></p>}
      {!loading && visible.length === 0 && <p role="status" className="py-2 text-xs text-text-muted">{type === "Prompt 案例" && !needle ? "平台尚无可用的已发布角色 Prompt 案例。可在创作台提交角色素材，经审核发布后在此选择。" : "没有匹配项，请更换关键词或分类。"}</p>}
      <div role="listbox" aria-label="词典和 Skill 结果" aria-activedescendant={visible.length ? `${id}-${Math.min(active, visible.length - 1)}` : undefined}>
        {visible.map((entry, index) => <button key={entry.id} id={`${id}-${index}`} type="button" role="option" aria-selected={active === index} onClick={() => setSelected(entry)} className={`${buttonStyle} block w-full py-2 text-left ${active === index ? "bg-primary/10" : ""}`}>
          <span className="block text-foreground">{entry.type} · {entry.title}</span><span className="block text-text-muted">{entry.domain} · {entry.source}</span>
        </button>)}
      </div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>刷新目录</button>
    </>}
  </div>;
}
