"use client";

import { useEffect, useId, useState, type MutableRefObject } from "react";
import { API_URL, api, authenticatedFetch, type PlatformReferenceResource } from "@/lib/api";
import { searchCharacterQuickPresets } from "@/lib/characterQuickActions";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, configurationQueryCategory, isConfigurationQuery, renderDictionaryPreset, dictionaryStructuredFields, dictionaryConfiguration, type DictionaryConfiguration, type CharacterDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { editablePlatformPrompt, isUsablePlatformPrompt } from "@/lib/platformPrompts";
import { CHARACTER_DICTIONARY_GROUPS, dictionaryCategoryPath, dictionaryCategorySearch, dictionarySlotCategory, localDictionaryCategories, platformDictionaryCategories } from "@/lib/characterDictionaryCategories";
import { PROMPT_TASKS, PROMPT_TOPICS, PROMPT_STYLES, templateDimensions, type PromptTask } from "@/lib/promptTemplateCategories";
import type { PromptSlashSuggestion } from "./playground/ReferencePromptEditor";
import type { CharacterConstraints } from "@/lib/characterStructuredDesign";

type Entry = {
  id: string; title: string; text: string; type: "词条" | "配置面板" | "Prompt 模板" | "Prompt 案例" | "Skill";
  categories: string[]; domain: string; source: string; search: string; resource?: PlatformReferenceResource;
  preset?: CharacterDictionaryPreset;
  slotValue?: string;
  motionText?: string;
  remainingText?: string;
  configuration?: DictionaryConfiguration;
  structuredFields?: { identity: Record<string, string>; look: Record<string, string>; constraints?: CharacterConstraints };
};
const DOMAINS: Record<string, string> = {
  "character.identity": "身份", "character.look": "造型", "character.performance": "表演", "world.style": "风格",
};
const buttonStyle = "min-h-11 rounded px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary hover:bg-hover-bg";

export default function CharacterPromptDictionary({ suggestion, onClose, onApply, onSkill, canRunSkill, keyHandler, onConfiguration }: {
  suggestion: PromptSlashSuggestion;
  onClose: () => void;
  onApply: (text: string, source: Entry) => void;
  onConfiguration?: (configuration: DictionaryConfiguration) => void;
  onSkill?: (currentPrompt: string) => void;
  canRunSkill: boolean;
  keyHandler: MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}) {
  const id = useId();
  const [resources, setResources] = useState<PlatformReferenceResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [section, setSection] = useState<"基础面板" | "Prompt 模板">("基础面板");
  const [task, setTask] = useState<PromptTask | null>(null);
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(!suggestion.query.trim());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState("");
  const [active, setActive] = useState(0);
  const needle = suggestion.query.trim().toLocaleLowerCase();
  const selectedFields = selected?.preset ? dictionaryPresetFields(selected.preset, fieldValues) : [];
  const fieldGroups = selected?.preset?.sections
    ? selected.preset.sections.map((section) => ({ label: section.label, fields: selectedFields.filter((field) => section.parts.some((part) => part.includes(`[${field.key}]`))) })).filter((group) => group.fields.length > 0)
    : [{ label: "选择细节，预览同步更新", fields: selectedFields }];
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
  // Search the template itself, not its configured defaults (e.g. a default
  // round face must not make every template a result for /圆脸).
  entries.push(...CHARACTER_DICTIONARY_PRESETS.map((preset) => ({ ...preset, preset })));
  for (const resource of resources) {
    if (resource.status !== "active" || resource.dictionary?.entry_type === "pattern") continue;
    const source = `平台 · ${resource.platform_resource_id} · r${resource.revision} · ${resource.provenance.license}`;
    const common = { id: resource.platform_resource_id, title: resource.title, source, resource,
      categories: platformDictionaryCategories(resource.category_path), domain: DOMAINS[resource.dictionary?.semantic_domain || ""] || "案例",
      search: [resource.title, resource.summary, resource.category_path, ...(resource.tags || [])].join(" ") };
    if (terms.includes(resource)) entries.push({ ...common, type: "词条", text: resource.payload!.structured_prompt!.content! });
    else if (isUsablePlatformPrompt(resource, "character/")) entries.push({ ...common, type: "Prompt 案例", text: editablePlatformPrompt(resource) });

  }
  if (onSkill && !suggestion.slot) entries.unshift({ id: "character-visual-design", title: "AI 完善角色设计", type: "Skill", categories: [], domain: "Skill",
    text: "使用角色描述和当前 Prompt 细节完善角色设计。打开后选择设计模型并提交，检查返回的提示词，再保存草稿或确认设计。", source: "当前角色台已接入 Skill", search: "skill 技能 角色设计 完善 润色 身份 外观 草稿" });
  const group = CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === category);
  const inCategory = (entry: Entry, key: string) => entry.categories.includes(key)
    || CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === key)?.children.some(([child]) => entry.categories.includes(child));
  const count = (key: string) => entries.filter(entry => (entry.type === "词条" || entry.type === "配置面板") && inCategory(entry, key)).length;
  const showCategories = section === "基础面板" && browsing && (!category || !!group);
  const panelEntries = showCategories && !suggestion.slot && category
    ? entries.filter(entry => entry.type === "配置面板" && inCategory(entry, category)) : [];
  const navigation = !showCategories ? [] : group ? group.children.map(([key, label]) => ({ id: key, label, detail: `${count(key)} 个选项` }))
    : CHARACTER_DICTIONARY_GROUPS.filter(item => item.id !== "performance" || count(item.id) > 0)
      .map(item => ({ id: item.id, label: item.label, detail: item.children.map(([, label]) => label).join("、") }));
  const visible = showCategories ? [] : entries.filter(entry => {
    if (entry.type === "Skill") return false;
    const template = entry.type === "Prompt 模板" || entry.type === "Prompt 案例";
    if (suggestion.slot ? entry.type !== "词条" : section === "Prompt 模板" ? !template : template && (browsing || !needle || isConfigurationQuery(needle))) return false;
    if (!browsing && needle && !`${entry.title} ${entry.search} ${entry.text} ${entry.categories.map(dictionaryCategorySearch).join(" ")}`.toLocaleLowerCase().includes(needle)) return false;
    if (section === "基础面板" && !suggestion.slot && isConfigurationQuery(needle) && !browsing)
      return entry.type === "配置面板" && inCategory(entry, configurationQueryCategory(needle)!);
    if (section === "Prompt 模板") {
      const dimensions = templateDimensions(entry.title, entry.search);
      return (!task || dimensions.tasks.includes(task)) && (!topic || dimensions.topics.includes(topic as typeof PROMPT_TOPICS[number]))
        && (!style || dimensions.styles.includes(style as typeof PROMPT_STYLES[number]));
    }
    return !browsing || !category || inCategory(entry, category);
  }).sort((a, b) => Number(b.type === "配置面板") - Number(a.type === "配置面板"));
  const related = section === "基础面板" && !browsing ? Array.from(new Set(visible.flatMap(entry => entry.categories))) : [];
  const enterCategory = (key: string) => { setCategory(key); setBrowsing(true); setActive(0); };
  const showTasks = section === "Prompt 模板" && !task && browsing;
  const options = [
    ...(showTasks ? PROMPT_TASKS.map(([key, label]) => ({ id: `task-${key}`, label, detail: "选择任务，再按题材和画风筛选", choose: () => setTask(key) })) : []),
    ...navigation.map(item => ({ id: `category-${item.id}`, label: item.label, detail: item.detail, choose: () => enterCategory(item.id) })),
    ...(showTasks ? [] : [...panelEntries, ...visible].map(entry => ({ id: entry.id,
      label: `${entry.type === "词条" ? "选项" : entry.type === "Prompt 案例" ? "Prompt 模板" : entry.type} · ${entry.title}`,
      detail: `${entry.domain} · ${entry.source}`, choose: () => { setSelected(entry); setFieldValues({}); } }))),
    ...related.map(key => ({ id: `browse-${key}`, label: `浏览 ${dictionaryCategoryPath(key)}`, detail: `${count(key)} 个选项，可比较其他描述`, choose: () => enterCategory(key) })),
  ];
  useEffect(() => {
    setActive(0); setSelected(null); setFieldValues({}); setCategory(dictionarySlotCategory(suggestion.slot)); setBrowsing(!needle);
    setTask(null); setTopic(""); setStyle("");
    setSection(!suggestion.slot && /^(古装|古风|现代|女装|动漫|国风|换装|写真|电商|ugc)$/i.test(needle) ? "Prompt 模板" : "基础面板");
  }, [needle, suggestion.slot, suggestion.contextKey]);
  useEffect(() => { setActive(0); setSelected(null); }, [section, category, browsing, task, topic, style]);
  const back = () => {
    if (selected) setSelected(null);
    else if (section === "Prompt 模板" && task) { setTask(null); }
    else if (category) { setCategory(group ? null : CHARACTER_DICTIONARY_GROUPS.find((item) => item.children.some(([key]) => key === category))?.id || null); }
    else onClose();
  };
  const apply = () => {
    if (!selected || !selectedText.trim()) return;
    if (selected.type === "Skill") {
      if (!canRunSkill) return;
      const currentPrompt = suggestion.replaceWithText(""); onClose(); onSkill?.(currentPrompt);
    } else {
      if (!suggestion.slot && selected.preset) onConfiguration?.(dictionaryConfiguration(selected.preset, fieldValues));
      const fields = !suggestion.slot && selected.preset ? dictionaryStructuredFields(selected.preset, fieldValues) : undefined;
      onApply(suggestion.replaceWithText(selectedText), { ...selected, text: selectedText,
        remainingText: suggestion.remainingText,
        structuredFields: fields && (Object.keys(fields.identity).length || Object.keys(fields.look).length) ? fields : undefined });
      onClose();
    }
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
  return <div data-prompt-discovery role="dialog" aria-label="基础面板和 Prompt 模板" onMouseDown={(event) => {
    if (!(event.target as HTMLElement).closest("input, select, textarea")) event.preventDefault();
  }}
    className="absolute top-12 left-3 right-3 z-50 mb-2 max-h-[min(60vh,440px)] overflow-y-auto rounded-lg border border-glass-border bg-elevated p-3 shadow-xl">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-foreground">{suggestion.slot ? `填写 [${suggestion.slot}]` : "/ 基础面板与 Prompt 模板"}</p><button type="button" onClick={onClose} className={buttonStyle}>关闭</button></div>
    {selected ? <>
      <h4 className="mt-2 text-sm text-foreground">{selected.type === "词条" ? "选项" : selected.type === "Prompt 案例" ? "Prompt 模板" : selected.type} · {selected.title}</h4>
      <p className="mt-1 break-all text-xs text-text-muted">{selected.source}</p>
      {!suggestion.slot && selectedFields.length > 0 && <div className="mt-2 space-y-3">
        {fieldGroups.map((group) => <fieldset key={group.label} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-medium text-text-secondary">{group.label}</legend>
        {group.fields.map((field) => <label key={field.key} className="text-xs text-text-secondary">
          {field.label}<select aria-label={field.label} value={fieldValues[field.key] ?? field.value}
            onChange={(event) => {
              const value = event.target.value;
              setFieldValues((values) => {
                const next = { ...values, [field.key]: value };
                for (const key of field.dependentKeys || []) delete next[key];
                return next;
              });
            }}
            className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {dictionarySlotCategory(field.label) === "expression" ? <>
              {field.options.includes("") && <option value="">不指定</option>}
              {CHARACTER_DICTIONARY_GROUPS.find((group) => group.id === "expression")!.children.map(([key, label]) => <optgroup key={key} label={label}>
                {CHARACTER_DICTIONARY_PRESETS.filter((term) => term.type === "词条" && term.categories.includes(key)).map((term) => <option key={term.id} value={term.title}>{term.title}</option>)}
              </optgroup>)}
              <option value={`[${field.label}]`}>稍后填写 [{field.label}]</option>
            </> : field.options.map((value) => <option key={value} value={value}>{value === "" ? "不指定" : value.startsWith("[") ? `稍后填写 ${value}` : value}</option>)}
          </select>
        </label>)}
      </fieldset>)}
      </div>}
      {(selected.motionText || selectedFields.some((field) => dictionarySlotCategory(field.label) === "expression")) && <details className="mt-2 text-xs text-text-secondary">
        <summary className="min-h-11 cursor-pointer py-3">动态表演参考（不随图片表情插入）</summary>
        <p>{selected.motionText || CHARACTER_DICTIONARY_PRESETS.find((term) => term.type === "词条" && term.motionText && term.title === (fieldValues["表情"] ?? selectedFields.find((field) => field.label === "表情")?.value))?.motionText || "选择表情后可查看原始动态描述。"}</p>
      </details>}
      {previewUrl && <img src={previewUrl} alt={`${selected.title} 案例预览`} className="mt-2 max-h-40 w-full rounded object-contain" />}
      <label className="mt-2 block text-xs text-text-secondary" htmlFor={`${id}-preview`}>{selected.type === "Skill" ? "操作说明" : "将插入的完整文字"}</label>
      <textarea id={`${id}-preview`} readOnly value={selectedText} placeholder="选择项目后在此预览；不指定的项目不会写入。" rows={5} className="mt-1 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
      <p className="mt-1 text-xs text-text-muted">{selected.type === "Skill" ? "打开角色设计后可调整细节和模型，点击提交才会执行 AI 完善。" : suggestion.slot ? `仅替换当前 [${suggestion.slot}]，保留模板其他文字与参考图；也可关闭后手动填写。` : (selected.type === "Prompt 模板" || selected.type === "配置面板") ? "先在面板选择细节，确认后插入预览文字；也可保留 [变量] 稍后填写。" : "替换光标处的 /检索词，保留其他文字与参考图；插入后可编辑。"}</p>
      <button type="button" disabled={!selectedText.trim() || (selected.type === "Skill" && !canRunSkill)} onClick={apply} className={`${buttonStyle} mt-2 bg-primary text-primary-foreground disabled:opacity-50`}>{selected.type === "Skill" ? "打开角色设计" : suggestion.slot ? "填写当前槽位" : selected.type === "配置面板" ? "应用配置" : selected.type === "Prompt 模板" ? "使用此模板" : "插入到当前 Prompt"}</button>
      {selected.type === "Skill" && !canRunSkill && <p className="text-xs text-text-muted">请等待当前设计完成；此入口需在角色工作台中使用。</p>}
      <button type="button" onClick={() => setSelected(null)} className={`${buttonStyle} ml-2`}>返回结果</button>
    </> : <>
      {!suggestion.slot && <div role="tablist" aria-label="检索范围" className="mt-2 flex gap-2">{(["基础面板", "Prompt 模板"] as const).map(label => <button key={label} type="button" role="tab" aria-selected={section === label} tabIndex={section === label ? 0 : -1}
        onClick={() => { setSection(label); setCategory(null); setTask(null); setBrowsing(true); }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "基础面板" : event.key === "End" ? "Prompt 模板" : section === "基础面板" ? "Prompt 模板" : "基础面板";
          setSection(next); setCategory(null); setTask(null); setBrowsing(true);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === "基础面板" ? 0 : 1]?.focus();
        }} className={`${buttonStyle} ${section === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>}
      {section === "Prompt 模板" && !suggestion.slot && <div className="mt-2 flex flex-wrap gap-2">
        {task && <button type="button" onClick={() => setTask(null)} className={buttonStyle}>返回任务分类</button>}
        {task && <span className="py-3 text-xs text-text-secondary">{PROMPT_TASKS.find(([key]) => key === task)?.[1]}</span>}
        <label className="text-xs text-text-secondary">题材<select aria-label="模板题材" value={topic} onChange={event => setTopic(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">不限题材</option>{PROMPT_TOPICS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label className="text-xs text-text-secondary">画风<select aria-label="模板画风" value={style} onChange={event => setStyle(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">不限画风</option>{PROMPT_STYLES.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>}
      {section === "基础面板" && <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {category ? <><button type="button" onClick={back} className={buttonStyle}>返回上一级</button><span>{dictionaryCategoryPath(category)}</span></>
          : <p className="py-2">{browsing ? "选择部位面板调整细节，也可输入 /关键词直接搜索。" : "搜索结果 · 进入所属分类可比较其他选项"}</p>}
        {browsing && needle && <button type="button" onClick={() => { setCategory(null); setBrowsing(false); }} className={buttonStyle}>返回搜索结果</button>}
      </div>}
      {!suggestion.slot && onSkill && <button type="button" disabled={!canRunSkill} onClick={() => setSelected(entries.find(entry => entry.type === "Skill") || null)} className={`${buttonStyle} mt-1 border border-glass-border disabled:opacity-50`}>AI 完善角色设计</button>}
      {loading && <p role="status" className="text-xs text-text-muted">正在读取平台词典…</p>}
      {error && <p role="status" className="text-xs text-text-muted">平台词典读取失败，本地词条仍可使用。<button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>重试</button></p>}
      {!loading && options.length === 0 && <p role="status" className="py-2 text-xs text-text-muted">{section === "Prompt 模板" ? "当前分类暂无可用模板，请调整题材、画风或选择其他任务。" : "没有匹配项，请更换关键词或分类。"}</p>}
      <div role="listbox" aria-label="面板和模板结果" aria-activedescendant={options.length ? `${id}-${Math.min(active, options.length - 1)}` : undefined}>
        {options.map((option, index) => <button key={option.id} id={`${id}-${index}`} type="button" role="option" aria-selected={active === index} onClick={option.choose} className={`${buttonStyle} block w-full py-2 text-left ${active === index ? "bg-primary/10" : ""}`}>
          <span className="block text-foreground">{option.label}</span><span className="block text-text-muted">{option.detail}</span>
        </button>)}
      </div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>刷新目录</button>
    </>}
  </div>;
}
