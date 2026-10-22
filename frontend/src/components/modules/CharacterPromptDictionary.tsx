"use client";

import { OPEN_AI_CANVAS_PROMPTS } from "@/lib/openAiCanvasPrompts";
import { Search, X } from "lucide-react";
import { createContext, Fragment, useContext, useEffect, useId, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { API_URL, api, authenticatedFetch, type PlatformReferenceResource } from "@/lib/api";
import { searchCharacterQuickPresets } from "@/lib/characterQuickActions";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, configurationQueryCategory, isConfigurationQuery, renderDictionaryPreset, dictionaryStructuredFields, dictionaryConfiguration, type DictionaryConfiguration, type CharacterDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { IDENTITY_FIELDS, LOOK_FIELDS, type IdentityFeatures, type LookFeatures } from "@/lib/characterStructuredDesign";
import { editablePlatformPrompt, isUsablePlatformPrompt } from "@/lib/platformPrompts";
import { CHARACTER_DICTIONARY_GROUPS, dictionaryCategoryPath, dictionaryCategorySearch, dictionarySlotCategory, localDictionaryCategories, platformDictionaryCategories } from "@/lib/characterDictionaryCategories";
import { PROMPT_TASKS, PROMPT_TOPICS, PROMPT_STYLES, templateDimensions, characterTemplateKind, type PromptTask } from "@/lib/promptTemplateCategories";
import { CHARACTER_PANEL_GROUPS, CHARACTER_PANEL_LABELS, CHARACTER_PANEL_ORDER, characterPanelGroup } from "@/lib/characterPanelCatalog";
import type { PromptSlashSuggestion } from "./playground/ReferencePromptEditor";
import type { CharacterConstraints } from "@/lib/characterStructuredDesign";
import { characterDictionaryField } from "@/lib/characterDictionaryFields";

type Entry = {
  id: string; title: string; text: string; type: "词条" | "配置面板" | "Prompt 模板" | "Prompt 案例";
  categories: string[]; domain: string; source: string; search: string; resource?: PlatformReferenceResource;
  preset?: CharacterDictionaryPreset;
  promptTask?: PromptTask;
  promptTag?: string;
  usageHint?: string;
  editableText?: boolean;
  slotValue?: string;
  motionText?: string;
  remainingText?: string;
  configuration?: DictionaryConfiguration;
  structuredFields?: { identity: Record<string, string>; look: Record<string, string>; constraints?: CharacterConstraints };
};
const DOMAINS: Record<string, string> = {
  "character.identity": "身份", "character.look": "造型", "character.performance": "表演", "world.style": "风格",
};
const DISCOVERY_SECTIONS = ["基础面板", "词典", "Prompt 模板"] as const;
export const CharacterDictionaryHost = createContext<HTMLElement | null>(null);

const buttonStyle = "min-h-11 rounded px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary hover:bg-hover-bg";
const sectionLookKeys: Record<string, keyof LookFeatures> = { "服装": "clothing", "鞋履": "footwear", "首饰": "jewelry", "装饰": "decoration" };

function currentConfigurationSelections(configuration: DictionaryConfiguration, currentFields?: { identity: IdentityFeatures; look: LookFeatures }) {
  if (!currentFields) return {};
  const preset = CHARACTER_DICTIONARY_PRESETS.find(item => item.id === configuration.preset_id);
  if (!preset) return {};
  const projected = dictionaryStructuredFields(preset, configuration.selections);
  return Object.fromEntries(Object.entries(configuration.selections).filter(([key]) => {
    const target = characterDictionaryField(key)?.structured;
    if (target) {
      const current = currentFields[target.section] as Record<string, string | undefined>;
      return !!current[target.key] && current[target.key] === projected[target.section][target.key];
    }
    const section = preset.sections?.find(item => item.parts.some(part => part.includes(`[${key}]`)));
    const lookKey = section && sectionLookKeys[section.label];
    return !!lookKey && !!currentFields.look[lookKey] && currentFields.look[lookKey] === projected.look[lookKey];
  }));
}

export default function CharacterPromptDictionary({ suggestion, onClose, onApply, keyHandler, onConfiguration, configurations, currentFields }: {
  suggestion: PromptSlashSuggestion;
  onClose: () => void;
  onApply: (text: string, source: Entry) => void;
  onConfiguration?: (configuration: DictionaryConfiguration) => void;
  configurations?: DictionaryConfiguration[];
  currentFields?: { identity: IdentityFeatures; look: LookFeatures };
  keyHandler: MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}) {
  const host = useContext(CharacterDictionaryHost);
  const id = useId();
  const [resources, setResources] = useState<PlatformReferenceResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [section, setSection] = useState<typeof DISCOVERY_SECTIONS[number]>("基础面板");
  const [task, setTask] = useState<PromptTask | null>(null);
  const [promptTag, setPromptTag] = useState("");
  const [editedText, setEditedText] = useState<string | null>(null);
  const [characterKind, setCharacterKind] = useState("");
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(!suggestion.query.trim());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [inheritedSources, setInheritedSources] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [active, setActive] = useState(0);
  const externalNeedle = suggestion.query.trim().toLocaleLowerCase();
  const [searchQuery, setSearchQuery] = useState(suggestion.query);
  const needle = searchQuery.trim().toLocaleLowerCase();
  const quickPanels = section === "基础面板" && !suggestion.slot;
  const selectedFields = selected?.preset ? dictionaryPresetFields(selected.preset, fieldValues) : [];
  const fieldGroups = selected?.preset?.sections
    ? selected.preset.sections.map((section) => ({ label: section.label, fields: selectedFields.filter((field) => section.parts.some((part) => part.includes(`[${field.key}]`))) })).filter((group) => group.fields.length > 0)
    : [{ label: "选择细节，预览同步更新", fields: selectedFields }];
  const selectedText = editedText ?? (selected ? suggestion.slot ? selected.slotValue || selected.text
    : selected.preset ? renderDictionaryPreset(selected.preset, fieldValues) : selected.text : "");
  const projectedFields = selected?.type === "配置面板" && selected.preset
    ? dictionaryStructuredFields(selected.preset, fieldValues) : null;
  const fieldLabels = Object.fromEntries([...IDENTITY_FIELDS, ...LOOK_FIELDS]);
  const conflictingFields = projectedFields && currentFields ? [
    ...Object.entries(projectedFields.identity).filter(([key, value]) => {
      const current = currentFields.identity[key as keyof IdentityFeatures];
      return current && current !== value;
    })
      .map(([key]) => fieldLabels[key] || key),
    ...Object.entries(projectedFields.look).filter(([key, value]) => {
      const current = currentFields.look[key as keyof LookFeatures];
      return current && current !== value;
    })
      .map(([key]) => fieldLabels[key] || key),
  ] : [];
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
  entries.push(...OPEN_AI_CANVAS_PROMPTS);
  for (const resource of resources) {
    if (resource.status !== "active" || resource.dictionary?.entry_type === "pattern") continue;
    const source = `平台 · ${resource.platform_resource_id} · r${resource.revision} · ${resource.provenance.license}`;
    const common = { id: resource.platform_resource_id, title: resource.title, source, resource,
      categories: platformDictionaryCategories(resource.category_path), domain: DOMAINS[resource.dictionary?.semantic_domain || ""] || "案例",
      search: [resource.title, resource.summary, resource.category_path, ...(resource.tags || [])].join(" ") };
    if (terms.includes(resource)) entries.push({ ...common, type: "词条", text: resource.payload!.structured_prompt!.content! });
    else if (isUsablePlatformPrompt(resource, "character/")) entries.push({ ...common, type: "Prompt 案例", text: editablePlatformPrompt(resource) });

  }
  const group = CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === category);
  const inCategory = (entry: Entry, key: string) => entry.categories.includes(key)
    || CHARACTER_DICTIONARY_GROUPS.find((item) => item.id === key)?.children.some(([child]) => entry.categories.includes(child));
  const count = (key: string) => entries.filter(entry => entry.type === "词条" && inCategory(entry, key)).length;
  const showCategories = section === "词典" && browsing && (!category || !!group);
  const navigation = !showCategories ? [] : group
    ? group.children.filter(([key]) => count(key) > 0).map(([key, label]) => ({ id: key, label, detail: `${count(key)} 个选项` }))
    : CHARACTER_DICTIONARY_GROUPS.filter(item => item.id !== "templates" && count(item.id) > 0)
      .map(item => ({ id: item.id, label: item.label,
        detail: item.children.filter(([key]) => count(key) > 0).slice(0, 3).map(([, label]) => label).join("、") + (item.children.length > 3 ? "等" : "") }));
  const visible = showCategories ? [] : entries.filter(entry => {
    const template = entry.type === "Prompt 模板" || entry.type === "Prompt 案例";
    if (suggestion.slot || section === "词典") {
      if (entry.type !== "词条") return false;
    } else if (section === "基础面板") {
      if (entry.type !== "配置面板") return false;
      if (!browsing && isConfigurationQuery(needle)) return inCategory(entry, configurationQueryCategory(needle)!);
    } else if (!template) return false;
    if (!browsing && needle && !`${CHARACTER_PANEL_LABELS[entry.id] || ""} ${entry.title} ${entry.search} ${entry.text} ${entry.categories.map(dictionaryCategorySearch).join(" ")}`.toLocaleLowerCase().includes(needle)) return false;
    if (section === "Prompt 模板") {
      const dimensions = templateDimensions(entry.title, entry.search);
      const kind = characterTemplateKind(entry.title, entry.categories);
      const neutralExpression = kind === "expression";
      return (task !== "character" || !characterKind || kind === characterKind)
        && (!task || (entry.promptTask ? entry.promptTask === task : dimensions.tasks.includes(task))) && (!promptTag || entry.promptTag === promptTag) && (!topic || neutralExpression || dimensions.topics.includes(topic as typeof PROMPT_TOPICS[number]))
        && (!style || neutralExpression || dimensions.styles.includes(style as typeof PROMPT_STYLES[number]));
    }
    return section === "基础面板" || !browsing || !category || inCategory(entry, category);
  }).sort((a, b) => quickPanels ? CHARACTER_PANEL_ORDER.indexOf(a.id) - CHARACTER_PANEL_ORDER.indexOf(b.id) : 0);
  const related = section === "词典" && !browsing ? Array.from(new Set(visible.flatMap(entry => entry.categories))) : [];
  const enterCategory = (key: string) => { setCategory(key); setBrowsing(true); setActive(0); };
  const showTasks = section === "Prompt 模板" && !task && browsing;
  const templateTiles = section === "Prompt 模板" && !suggestion.slot;
  const tileLayout = quickPanels || templateTiles;
  const options = [
    ...(showTasks ? PROMPT_TASKS.map(([key, label]) => ({ id: `task-${key}`, label, detail: "选择任务，再按题材和画风筛选", choose: () => { setTask(key); setPromptTag(""); setTopic(""); setStyle(""); } })) : []),
    ...navigation.map(item => ({ id: `category-${item.id}`, label: item.label, detail: item.detail, choose: () => enterCategory(item.id) })),
    ...(showTasks ? [] : visible.map(entry => ({ id: entry.id,
      label: entry.type === "配置面板" ? CHARACTER_PANEL_LABELS[entry.id] || entry.title : `${entry.type === "词条" ? "选项" : entry.type === "Prompt 案例" ? "Prompt 模板" : entry.type} · ${entry.title}`,
      detail: browsing && entry.type === "配置面板" ? "选择款式并调整细节" : entry.type === "词条"
        ? `${entry.categories.map(dictionaryCategoryPath).filter(Boolean).join("、") || entry.domain} · ${entry.text}`
        : `${entry.domain} · ${entry.source}`, choose: () => {
          setSelected(entry);
          const saved = entry.type === "配置面板" ? configurations?.find(item => item.preset_id === entry.id)?.selections : undefined;
          const inherited = (configurations || []).map(item => ({ configuration: item, selections: currentConfigurationSelections(item, currentFields) }));
          const candidates = saved || Object.assign({}, ...inherited.map(item => item.selections));
          const valid = entry.preset && entry.type === "配置面板" ? Object.fromEntries(dictionaryPresetFields(entry.preset, candidates)
            .flatMap(field => candidates[field.key] !== undefined && field.options.includes(candidates[field.key])
              ? [[field.key, candidates[field.key]]] : [])) : {};
          setFieldValues(valid);
          setInheritedSources(saved ? [] : Array.from(new Set(Object.keys(valid).flatMap(key => {
            const source = [...inherited].reverse().find(item => item.selections[key] === valid[key])?.configuration;
            return source ? [CHARACTER_PANEL_LABELS[source.preset_id] || source.preset_id] : [];
          }))));
        } }))),
    ...related.map(key => ({ id: `browse-${key}`, label: `浏览 ${dictionaryCategoryPath(key)}`, detail: `${count(key)} 个选项，可比较其他描述`, choose: () => enterCategory(key) })),
  ];
  useEffect(() => {
    setSearchQuery(suggestion.query);
    setActive(0); setSelected(null); setFieldValues({}); setCategory(dictionarySlotCategory(suggestion.slot)); setBrowsing(!externalNeedle);
    setTask(null); setPromptTag(""); setCharacterKind(""); setTopic(""); setStyle("");
    setSection(suggestion.slot ? "词典" : /^(古装|古风|现代|女装|动漫|国风|换装|写真|电商|风格|运镜|九宫格|多视图|推演|ugc)$/i.test(externalNeedle) ? "Prompt 模板" : !externalNeedle || isConfigurationQuery(externalNeedle) ? "基础面板" : "词典");
  }, [externalNeedle, suggestion.slot, suggestion.contextKey]);
  useEffect(() => { setActive(0); setSelected(null); }, [section, category, browsing, task, characterKind, topic, style, needle, promptTag]);
  useEffect(() => { setEditedText(null); }, [selected]);
  const back = () => {
    if (selected) setSelected(null);
    else if (section === "Prompt 模板" && task) { setTask(null); setPromptTag(""); }
    else if (category) { setCategory(group ? null : CHARACTER_DICTIONARY_GROUPS.find((item) => item.children.some(([key]) => key === category))?.id || null); }
    else onClose();
  };
  const apply = () => {
    if (!selected || !selectedText.trim()) return;
    if (!suggestion.slot && selected.preset) onConfiguration?.(dictionaryConfiguration(selected.preset, fieldValues));
    const fields = !suggestion.slot && selected.preset ? dictionaryStructuredFields(selected.preset, fieldValues) : undefined;
    const insertText = !suggestion.slot && (selected.type === "Prompt 模板" || selected.type === "Prompt 案例")
      ? suggestion.appendWithText || suggestion.replaceWithText : suggestion.replaceWithText;
    onApply(insertText(selectedText), { ...selected, text: selectedText,
      remainingText: suggestion.remainingText,
      structuredFields: fields && (Object.keys(fields.identity).length || Object.keys(fields.look).length) ? fields : undefined });
    onClose();
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
  const panel = <div data-prompt-discovery role="dialog" aria-label="基础面板、词典和 Prompt 模板" onMouseDown={(event) => {
    if (!(event.target as HTMLElement).closest("input, select, textarea")) event.preventDefault();
  }}
    className={host ? "absolute inset-0 z-30 overflow-y-auto bg-surface p-3 sm:p-5" : "absolute top-12 left-3 right-3 z-50 mb-2 max-h-[min(60vh,440px)] overflow-y-auto rounded-lg border border-glass-border bg-elevated p-3 shadow-xl"}>
    <div className="flex items-center justify-between gap-1">
      {!suggestion.slot && <div role="tablist" aria-label="检索范围" className="flex min-w-0 gap-1">{DISCOVERY_SECTIONS.map(label => <button key={label} type="button" role="tab" aria-selected={section === label} tabIndex={section === label ? 0 : -1}
        onClick={() => { setSection(label); setSelected(null); setCategory(null); setTask(null); setBrowsing(!needle); }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (DISCOVERY_SECTIONS.indexOf(section) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          const next = DISCOVERY_SECTIONS[index];
          setSection(next); setCategory(null); setTask(null); setBrowsing(!needle);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
        }} className={`${buttonStyle} ${section === label ? "bg-primary/15 text-foreground" : "text-text-muted"}`}>{label}</button>)}</div>}
      {suggestion.slot && <p className="text-xs font-medium text-foreground">填写 [{suggestion.slot}]</p>}
      <button type="button" aria-label="关闭面板" onClick={onClose} className={`${buttonStyle} flex min-w-11 shrink-0 items-center justify-center`}><X size={16} aria-hidden="true" /></button>
    </div>
    {!selected && <div className="relative my-2">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <input type="search" aria-label="搜索面板、词典或模板" placeholder="搜索" value={searchQuery}
        onChange={event => {
          setSearchQuery(event.target.value); setBrowsing(!event.target.value.trim());
          setCategory(dictionarySlotCategory(suggestion.slot)); setTask(null); setPromptTag(""); setTopic(""); setStyle(""); setActive(0);
        }}
        onKeyDown={event => {
          if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && keyHandler.current?.(event.nativeEvent)) {
            event.preventDefault(); event.stopPropagation();
          }
        }}
        className="min-h-11 w-full rounded border border-glass-border bg-surface pl-9 pr-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
    </div>}
    {selected ? <>
      <h4 className="mt-2 text-sm text-foreground">{selected.type === "配置面板" ? CHARACTER_PANEL_LABELS[selected.id] || selected.title : <>{selected.type === "词条" ? "选项" : selected.type === "Prompt 案例" ? "Prompt 模板" : selected.type} · {selected.title}</>}</h4>
      {selected.type !== "配置面板" && <p className="mt-1 break-all text-xs text-text-muted">{selected.categories.map(dictionaryCategoryPath).filter(Boolean).join("、") || selected.domain} · {selected.source}</p>}
      {selected.type === "配置面板" && inheritedSources.length > 0 && <p className="mt-1 text-xs text-text-muted">初始选项来源：{inheritedSources.join("、")}</p>}
      {!suggestion.slot && selectedFields.length > 0 && <div className="mt-2 space-y-3">
        {fieldGroups.map((group) => <fieldset key={group.label} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-medium text-text-secondary">{group.label === "装饰" ? "配饰" : group.label}</legend>
        {group.fields.map((field) => <label key={field.key} className="text-xs text-text-secondary">
          {field.label}{characterDictionaryField(field.key) && <span aria-hidden="true" className="ml-1 text-text-muted">· {characterDictionaryField(field.key)!.part} / {characterDictionaryField(field.key)!.dimension}</span>}<select aria-label={field.label} value={fieldValues[field.key] ?? field.value}
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
      {selected.usageHint && <p className="mt-2 text-xs text-text-secondary">{selected.usageHint}</p>}
      {previewUrl && <img src={previewUrl} alt={`${selected.title} 案例预览`} className="mt-2 max-h-40 w-full rounded object-contain" />}
      <label className="mt-2 block text-xs text-text-secondary" htmlFor={`${id}-preview`}>将插入的完整文字</label>
      <textarea id={`${id}-preview`} readOnly={!selected.editableText} value={selectedText} onChange={event => setEditedText(event.target.value)} placeholder="选择项目后在此预览；不指定的项目不会写入。" rows={5} className="mt-1 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
      {conflictingFields.length > 0 && <p role="status" className="mt-2 text-xs text-amber-300">当前设计中的{conflictingFields.join("、")}与上方选择不同。应用会覆盖这些字段。</p>}
      <p className="mt-1 text-xs text-text-muted">{suggestion.slot ? `仅替换当前 [${suggestion.slot}]，保留模板其他文字与参考图；也可关闭后手动填写。` : selected.editableText ? "可直接修改预览文字，确认后换行追加到提示词末尾；参考图和出图参数由你另行选择。" : selected.type === "配置面板" ? "先在面板选择细节，确认后应用预览文字；也可保留 [变量] 稍后填写。" : selected.type === "Prompt 模板" ? "先选择细节并预览；模板将换行追加到提示词末尾，也可保留 [变量] 稍后填写。" : "替换光标处的 /检索词，保留其他文字与参考图；插入后可编辑。"}</p>
      <button type="button" disabled={!selectedText.trim()} onClick={apply} className={`${buttonStyle} mt-2 bg-primary text-primary-foreground disabled:opacity-50`}>{suggestion.slot ? "填写当前槽位" : selected.type === "配置面板" ? conflictingFields.length ? "覆盖冲突并应用" : "应用配置" : selected.type === "Prompt 模板" ? "使用此模板" : "插入到当前 Prompt"}</button>
      <button type="button" onClick={() => setSelected(null)} className={`${buttonStyle} ml-2`}>返回结果</button>
    </> : <>
      {section === "Prompt 模板" && !suggestion.slot && <div className="mt-2 flex flex-wrap gap-2">
        {task && <button type="button" onClick={() => { setTask(null); setPromptTag(""); }} className={buttonStyle}>返回任务分类</button>}
        {task && <span className="py-3 text-xs text-text-secondary">{PROMPT_TASKS.find(([key]) => key === task)?.[1]}</span>}
        {task === "character" && <label className="text-xs text-text-secondary">模板类型<select aria-label="角色模板类型" value={characterKind} onChange={event => setCharacterKind(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">全部</option><option value="design">完整设计</option><option value="expression">角色表情</option>
        </select></label>}
        {task && ['visual-style', 'camera-motion'].includes(task) && <label className="text-xs text-text-secondary">分类<select aria-label="来源模板分类" value={promptTag} onChange={event => setPromptTag(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">全部</option>{Array.from(new Set(OPEN_AI_CANVAS_PROMPTS.filter(entry => entry.promptTask === task).map(entry => entry.promptTag))).filter(Boolean).map(tag => <option key={tag}>{tag}</option>)}
        </select></label>}
        {!task?.match(/^(visual-style|camera-motion|multi-view)$/) && <>
        <label className="text-xs text-text-secondary">题材<select aria-label="模板题材" value={topic} onChange={event => setTopic(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">不限题材</option>{PROMPT_TOPICS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label className="text-xs text-text-secondary">画风<select aria-label="模板画风" value={style} onChange={event => setStyle(event.target.value)} className="ml-1 min-h-11 rounded border border-glass-border bg-surface px-2">
          <option value="">不限画风</option>{PROMPT_STYLES.map(value => <option key={value}>{value}</option>)}
        </select></label>
        </>}
      </div>}
      {section === "词典" && <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {category ? <><button type="button" onClick={back} className={buttonStyle}>返回上一级</button><span>{dictionaryCategoryPath(category)}</span></>
          : <p className="py-2">{browsing ? "选择分类查找单项描述，也可输入 /关键词直接搜索。" : "搜索结果 · 进入所属分类可比较其他选项"}</p>}
        {browsing && needle && <button type="button" onClick={() => { setCategory(null); setBrowsing(false); }} className={buttonStyle}>返回搜索结果</button>}
      </div>}
      {loading && <p role="status" className="text-xs text-text-muted">正在读取平台词典…</p>}
      {error && <p role="status" className="text-xs text-text-muted">平台词典读取失败，本地词条仍可使用。<button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>重试</button></p>}
      {!loading && options.length === 0 && <p role="status" className="py-2 text-xs text-text-muted">{section === "Prompt 模板" ? "当前分类暂无可用模板，请调整题材、画风或选择其他任务。" : "没有匹配项，请更换关键词或分类。"}</p>}
      <div role="listbox" aria-label="面板和模板结果" className={tileLayout ? "grid grid-cols-3 gap-2" : ""} aria-activedescendant={options.length ? `${id}-${Math.min(active, options.length - 1)}` : undefined}>
        {options.map((option, index) => <Fragment key={option.id}>
          {quickPanels && index === options.findIndex((item) => characterPanelGroup(item.id) === characterPanelGroup(option.id)) && <h5 className="col-span-full pt-2 text-xs font-medium text-text-secondary">{CHARACTER_PANEL_GROUPS.find((group) => group.id === characterPanelGroup(option.id))?.label}</h5>}
          <button id={`${id}-${index}`} type="button" role="option" aria-label={templateTiles ? option.label : option.label.startsWith("选项 · ") ? `${option.label} 词条` : undefined} aria-selected={active === index} onClick={option.choose} className={`${templateTiles ? buttonStyle.replace("text-xs", "text-sm leading-relaxed") : buttonStyle} min-w-0 w-full py-2 ${tileLayout ? "border border-glass-border text-center" : "block text-left"} ${active === index ? "bg-primary/10" : ""}`}>
          <span className="block break-words text-foreground">{templateTiles ? option.label.replace(/^Prompt 模板 · /, "") : option.label}</span>{!tileLayout && <span className="block text-text-muted">{option.detail}</span>}
          </button>
        </Fragment>)}
      </div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className={buttonStyle}>刷新目录</button>
    </>}
  </div>;
  return host ? createPortal(panel, host) : panel;
}
