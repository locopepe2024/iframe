"use client";

import { useEffect, useId, useState, type MutableRefObject } from "react";
import { API_URL, api, authenticatedFetch, type PlatformReferenceResource } from "@/lib/api";
import { searchCharacterQuickPresets } from "@/lib/characterQuickActions";
import { CHARACTER_DICTIONARY_PRESETS, renderDictionaryPreset, type CharacterDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { editablePlatformPrompt, isUsablePlatformPrompt } from "@/lib/platformPrompts";
import { CHARACTER_DICTIONARY_GROUPS, dictionaryCategoryPath, dictionaryCategorySearch, dictionarySlotCategory, localDictionaryCategories, platformDictionaryCategories } from "@/lib/characterDictionaryCategories";
import type { PromptSlashSuggestion } from "./playground/ReferencePromptEditor";

type Entry = {
  id: string; title: string; text: string; type: "词条" | "服装方案" | "Prompt 模板" | "组合方案" | "Prompt 案例" | "Skill";
  categories: string[]; domain: string; source: string; search: string; resource?: PlatformReferenceResource;
  preset?: CharacterDictionaryPreset;
  slotValue?: string;
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
  const [section, setSection] = useState<"词典" | "Skill">("词典");
  const [category, setCategory] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(!suggestion.query.trim());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState("");
  const [active, setActive] = useState(0);
  const needle = suggestion.query.trim().toLocaleLowerCase();
  const selectedText = selected ? suggestion.slot ? selected.slotValue || selected.text
    : selected.preset ? renderDictionaryPreset(selected.preset, fieldValues) : selected.text : "";
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
  // Design routes select a Skill workflow; they are not descriptions to insert.
  const entries: Entry[] = searchCharacterQuickPresets("").filter((preset) => preset.target !== "route").map((preset) => ({
    id: preset.id, title: preset.label, text: preset.target === "route" ? preset.label : preset.value,
    type: "词条", categories: localDictionaryCategories(preset.id), domain: DOMAINS[preset.semanticDomain], source: `${preset.source} · v${preset.revision}`, search: preset.searchText,
  }));
  entries.push(...CHARACTER_DICTIONARY_PRESETS.map((preset) => ({ ...preset, preset, text: renderDictionaryPreset(preset) })));
  for (const resource of resources) {
    if (resource.status !== "active") continue;
    const source = `平台 · ${resource.platform_resource_id} · r${resource.revision} · ${resource.provenance.license}`;
    const common = { id: resource.platform_resource_id, title: resource.title, source, resource,
      categories: platformDictionaryCategories(resource.category_path), domain: DOMAINS[resource.dictionary?.semantic_domain || ""] || "案例",
      search: [resource.title, resource.summary, resource.category_path, ...(resource.tags || [])].join(" ") };
    if (terms.includes(resource)) entries.push({ ...common, type: "词条", text: resource.payload!.structured_prompt!.content! });
    else if (isUsablePlatformPrompt(resource, "character/")) entries.push({ ...common, type: "Prompt 案例", text: editablePlatformPrompt(resource) });
    else if (resource.kind === "prompt_preset" && resource.dictionary?.entry_type === "pattern") {
      const members = resource.dictionary.members || [];
      const resolved = members.map((member) => terms.find((term) => term.platform_resource_id === member.platform_resource_id
        && term.revision === member.revision && term.dictionary?.semantic_domain === resource.dictionary?.semantic_domain));
      if (members.length >= 2 && members.length <= 12 && resolved.every(Boolean)
        && new Set(members.map((member) => `${member.platform_resource_id}@${member.revision}`)).size === members.length) {
        entries.push({ ...common, categories: Array.from(new Set(resolved.flatMap((term) => platformDictionaryCategories(term!.category_path)))), type: "组合方案", text: resolved.map((term) => term!.payload!.structured_prompt!.content).join("；") });
      }
    }
  }
  if (onSkill && !suggestion.slot) entries.unshift({ id: "character-visual-design", title: "生成角色视觉设计草稿", type: "Skill", categories: [], domain: "Skill",
    text: "角色身份与造型双 Skill 流程。输入：角色描述、侧栏身份与造型草稿及已选设计参考。下一步审核实际模型输入，确认后才执行。", source: "当前角色台已接入 Skill", search: "skill 技能 角色设计 身份 外观 草稿" });
  const group = CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === category);
  const inCategory = (entry: Entry, key: string) => entry.categories.includes(key)
    || CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === key)?.children.some(([child]) => entry.categories.includes(child));
  const count = (key: string) => entries.filter((entry) => ["词条", "服装方案", "Prompt 模板"].includes(entry.type) && inCategory(entry, key)).length;
  const showCategories = section === "词典" && browsing && (type === "全部" || type === "词条" || type === "服装方案") && (!category || !!group);
  const navigation = !showCategories ? [] : group ? group.children.map(([key, label]) => ({ id: key, label, detail: `${count(key)} 个条目` }))
    : CHARACTER_DICTIONARY_GROUPS.filter((item) => item.id !== "performance" || count(item.id) > 0)
      .map((item) => ({ id: item.id, label: item.label, detail: item.children.map(([, label]) => label).join("、") }));
  const visible = showCategories ? [] : entries.filter((entry) =>
    (section === "Skill" ? entry.type === "Skill" : entry.type !== "Skill")
    && (browsing || !needle || `${entry.title} ${entry.search} ${entry.text} ${entry.categories.map(dictionaryCategorySearch).join(" ")}`.toLocaleLowerCase().includes(needle))
    && (!suggestion.slot || entry.type === "词条")
    && (section === "Skill" || type === "全部" || entry.type === type)
    && (!browsing || !category || inCategory(entry, category)))
    .sort((a, b) => Number(b.type === "Prompt 模板") - Number(a.type === "Prompt 模板"));
  const related = section === "词典" && !browsing ? Array.from(new Set(visible.flatMap((entry) => entry.categories))) : [];
  const enterCategory = (key: string) => { setCategory(key); setBrowsing(true); setType("全部"); setActive(0); };
  const options = [
    ...navigation.map((item) => ({ id: `category-${item.id}`, label: item.label, detail: item.detail, choose: () => enterCategory(item.id) })),
    ...visible.map((entry) => ({ id: entry.id, label: `${entry.type} · ${entry.title}`, detail: `${entry.domain} · ${entry.source}`, choose: () => { setSelected(entry); setFieldValues({}); } })),
    ...related.map((key) => ({ id: `browse-${key}`, label: `浏览 ${dictionaryCategoryPath(key)}`, detail: `${count(key)} 个词条，可比较其他选项`, choose: () => enterCategory(key) })),
  ];
  useEffect(() => { setActive(0); setSelected(null); setFieldValues({}); setCategory(dictionarySlotCategory(suggestion.slot)); setBrowsing(!needle); setType(!suggestion.slot && /^(古装|古风|现代|女装)$/.test(needle) ? "Prompt 模板" : "全部"); setSection("词典"); }, [needle, suggestion.slot, suggestion.contextKey]);
  useEffect(() => { setActive(0); setSelected(null); }, [type, section, category, browsing]);
  const back = () => {
    if (selected) setSelected(null);
    else if (category) { setCategory(group ? null : CHARACTER_DICTIONARY_GROUPS.find((item) => item.children.some(([key]) => key === category))?.id || null); }
    else onClose();
  };
  const apply = () => {
    if (!selected) return;
    if (selected.type === "Skill") {
      if (!canRunSkill) return;
      suggestion.replaceWithText(""); onClose(); onSkill?.();
    } else { onApply(suggestion.replaceWithText(selectedText), { ...selected, text: selectedText }); onClose(); }
  };
  useEffect(() => {
    keyHandler.current = (event) => {
      if (event.isComposing) return false;
      if (event.key === "Escape") { back(); return true; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive((index) => options.length ? (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0); return true;
      }
      if (event.key === "Enter") { if (selected) apply(); else if (options.length) options[Math.min(active, options.length - 1)].choose(); return true; }
      return false;
    };
    return () => { keyHandler.current = null; };
  });
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, active]);
  return <div data-prompt-discovery role="dialog" aria-label="词典和 Skill 检索" onMouseDown={(event) => {
    if (!(event.target as HTMLElement).closest("input, select, textarea")) event.preventDefault();
  }}
    className="absolute top-12 left-3 right-3 z-50 mb-2 max-h-[min(60vh,440px)] overflow-y-auto rounded-lg border border-glass-border bg-elevated p-3 shadow-xl">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-foreground">{suggestion.slot ? `填写 [${suggestion.slot}]` : "/ 词典和 Skill"}</p><button type="button" onClick={onClose} className={buttonStyle}>关闭</button></div>
    {selected ? <>
      <h4 className="mt-2 text-sm text-foreground">{selected.type} · {selected.title}</h4>
      <p className="mt-1 break-all text-xs text-text-muted">{selected.source}</p>
      {!suggestion.slot && selected.preset?.fields && <fieldset className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="text-xs text-text-secondary">调整穿搭，完整描述会同步更新</legend>
        {selected.preset.fields.map((field) => <label key={field.key} className="text-xs text-text-secondary">
          {field.label}<select aria-label={field.label} value={fieldValues[field.key] || field.value}
            onChange={(event) => setFieldValues((values) => ({ ...values, [field.key]: event.target.value }))}
            className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {field.options.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>)}
      </fieldset>}
      {previewUrl && <img src={previewUrl} alt={`${selected.title} 案例预览`} className="mt-2 max-h-40 w-full rounded object-contain" />}
      <label className="mt-2 block text-xs text-text-secondary" htmlFor={`${id}-preview`}>{selected.type === "Skill" ? "Skill 操作说明" : "将插入的完整文字"}</label>
      <textarea id={`${id}-preview`} readOnly value={selectedText} rows={5} className="mt-1 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
      <p className="mt-1 text-xs text-text-muted">{selected.type === "Skill" ? "确认后进入输入审核。" : suggestion.slot ? `仅替换当前 [${suggestion.slot}]，保留模板其他文字与参考图；也可关闭后手动填写。` : selected.type === "Prompt 模板" ? "先插入完整模板，再点击其中的 [变量] 从词典选择细节；所有文字均可编辑。" : "替换光标处的 /检索词，保留其他文字与参考图；插入后可编辑。"}</p>
      <button type="button" disabled={selected.type === "Skill" && !canRunSkill} onClick={apply} className={`${buttonStyle} mt-2 bg-primary text-primary-foreground disabled:opacity-50`}>{selected.type === "Skill" ? "审核 Skill 输入" : suggestion.slot ? "填写当前槽位" : selected.type === "Prompt 模板" ? "使用此模板" : "插入到当前 Prompt"}</button>
      {selected.type === "Skill" && !canRunSkill && <p className="text-xs text-text-muted">请先填写角色描述并选择设计模型，或等待当前设计完成。</p>}
      <button type="button" onClick={() => setSelected(null)} className={`${buttonStyle} ml-2`}>返回结果</button>
    </> : <>
      {!suggestion.slot && <div role="tablist" aria-label="检索范围" className="mt-2 flex gap-2">{(["词典", "Skill"] as const).map((label) => <button key={label} type="button" role="tab" aria-selected={section === label} tabIndex={section === label ? 0 : -1}
        onClick={() => { setSection(label); setCategory(null); }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "词典" : event.key === "End" ? "Skill" : section === "词典" ? "Skill" : "词典";
          setSection(next); setCategory(null);
          const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          tabs?.[next === "词典" ? 0 : 1]?.focus();
        }}
        className={`${buttonStyle} ${section === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>}
      {section === "词典" && !suggestion.slot && <div role="group" aria-label="词典内容类型" className="flex flex-wrap gap-1">{["全部", "Prompt 模板", "词条", "服装方案", "组合方案", "Prompt 案例"].map((label) => <button key={label} type="button" aria-pressed={type === label} onClick={() => { setType(label); setCategory(label === "服装方案" ? "outfit" : null); }} className={`${buttonStyle} ${type === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>}
      {section === "词典" && <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {category ? <><button type="button" onClick={back} className={buttonStyle}>返回上一级</button><span>{dictionaryCategoryPath(category)}</span></>
          : <p className="py-2">{browsing ? "先选择分类，再比较候选词条。也可继续输入 /关键词直接搜索。" : "搜索结果 · 选择所属分类可比较其他选项"}</p>}
        {browsing && needle && <button type="button" onClick={() => { setCategory(null); setBrowsing(false); }} className={buttonStyle}>返回搜索结果</button>}
      </div>}
      {loading && <p role="status" className="text-xs text-text-muted">正在读取平台词典…</p>}
      {error && <p role="status" className="text-xs text-text-muted">平台词典读取失败，本地词条仍可使用。<button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>重试</button></p>}
      {!loading && options.length === 0 && <p role="status" className="py-2 text-xs text-text-muted">{type === "Prompt 案例" && !needle ? "平台尚无可用的已发布角色 Prompt 案例。可在创作台提交角色素材，经审核发布后在此选择。" : "没有匹配项，请更换关键词或分类。"}</p>}
      <div role="listbox" aria-label="词典和 Skill 结果" aria-activedescendant={options.length ? `${id}-${Math.min(active, options.length - 1)}` : undefined}>
        {options.map((option, index) => <button key={option.id} id={`${id}-${index}`} type="button" role="option" aria-selected={active === index} onClick={option.choose} className={`${buttonStyle} block w-full py-2 text-left ${active === index ? "bg-primary/10" : ""}`}>
          <span className="block text-foreground">{option.label}</span><span className="block text-text-muted">{option.detail}</span>
        </button>)}
      </div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>刷新目录</button>
    </>}
  </div>;
}
