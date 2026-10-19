"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Search, Sparkles, TextCursorInput, X } from "lucide-react";
import { api, type PlatformReferenceResource } from "@/lib/api";
import {
  searchCharacterQuickPresets, platformCharacterTerm, platformCharacterPattern,
  type CharacterQuickPreset, type CharacterPresetCategory, type CharacterSemanticDomain, type CharacterPlatformPattern,
} from "@/lib/characterQuickActions";

const CATEGORY_ORDER: CharacterPresetCategory[] = ["风格", "面容", "皮肤", "身材体态", "服装", "发型"];
type BrowseCategory = "全部" | CharacterPresetCategory;
const BROWSE_CATEGORIES: BrowseCategory[] = ["全部", ...CATEGORY_ORDER];
const DOMAIN_OPTIONS: { label: string; value: CharacterSemanticDomain | null }[] = [
  { label: "全部", value: null },
  { label: "身份", value: "character.identity" },
  { label: "造型", value: "character.look" },
  { label: "风格", value: "world.style" },
];
const DOMAIN_LABELS: Record<CharacterSemanticDomain, string> = {
  "character.identity": "身份",
  "character.look": "造型",
  "world.style": "风格",
};
const COMMANDS = [
  { id: "design", title: "生成角色视觉设计草稿", detail: "双 Skill 流程；先审核模型输入", search: "角色设计 草稿 skill 技能 身份 外观" },
  { id: "terms", title: "插入描述词", detail: "选择词条，写入可编辑草稿", search: "插入 添加 描述词 风格 面容 皮肤 身材 体态 服装 发型" },
] as const;

export default function CharacterSlashPanel({ open, query, onQueryChange, onOpenChange, onPreset, onPattern, onSkill, canRunSkill, inputRef }: {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onPreset: (preset: CharacterQuickPreset) => void;
  onPattern: (presets: CharacterQuickPreset[]) => void;
  onSkill: () => void;
  canRunSkill: boolean;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<BrowseCategory>("全部");
  const [activeDomain, setActiveDomain] = useState<CharacterSemanticDomain | null>(null);
  const [platformResources, setPlatformResources] = useState<PlatformReferenceResource[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [stage, setStage] = useState<"commands" | "terms">("commands");
  const needle = query.replace(/^\//, "").trim().toLocaleLowerCase();
  const commands = COMMANDS.filter((command) => !needle || `${command.title} ${command.search}`.toLocaleLowerCase().includes(needle));
  const platformPresets = platformResources.map(platformCharacterTerm).filter((item): item is CharacterQuickPreset => item !== null);
  const presets = [...searchCharacterQuickPresets(needle, needle ? undefined : activeDomain || undefined), ...platformPresets]
    .filter((preset) => !preset.id.startsWith("platform.") || !needle || preset.searchText.toLocaleLowerCase().includes(needle))
    .filter((preset) => !!needle || !activeDomain || preset.semanticDomain === activeDomain)
    .filter((preset) => !!needle || activeCategory === "全部" || preset.category === activeCategory);
  const patterns = platformResources.map((resource) => platformCharacterPattern(resource, platformResources))
    .filter((item): item is CharacterPlatformPattern => item !== null)
    .filter((item) => (!needle || item.searchText.toLocaleLowerCase().includes(needle))
      && (!!needle || !activeDomain || item.semanticDomain === activeDomain)
      && (!!needle || activeCategory === "全部" || item.members.some((member) => member.category === activeCategory)));
  const unavailablePatterns = platformResources.filter((resource) => resource.status === "active"
    && resource.dictionary?.entry_type === "pattern"
    && !platformCharacterPattern(resource, platformResources));
  const options: Array<{ kind: "command"; id: "design" | "terms" } | { kind: "preset"; preset: CharacterQuickPreset } | { kind: "pattern"; pattern: CharacterPlatformPattern }> = stage === "commands"
    ? commands.map((command) => ({ kind: "command", id: command.id }))
    : [...patterns.map((pattern) => ({ kind: "pattern" as const, pattern })), ...presets.map((preset) => ({ kind: "preset" as const, preset }))];

  useEffect(() => { setActiveIndex(0); }, [query, stage, activeCategory, activeDomain]);
  useEffect(() => { if (!open) setStage("commands"); }, [open]);
  useEffect(() => {
    if (!open || stage !== "terms") return;
    let active = true;
    setPlatformLoading(true); setPlatformError(false);
    void api.getPlatformReferenceLibrary().then((catalog) => {
      if (active) setPlatformResources(catalog.resources);
    }).catch(() => { if (active) { setPlatformResources([]); setPlatformError(true); } })
      .finally(() => { if (active) setPlatformLoading(false); });
    return () => { active = false; };
  }, [open, stage, refresh]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, onOpenChange]);

  const choose = (option: typeof options[number]) => {
    if (option.kind === "command") {
      if (option.id === "terms") {
        setStage("terms"); setActiveCategory("全部"); setActiveDomain(null); onQueryChange("/"); inputRef.current?.focus();
        return;
      }
      if (!canRunSkill) return;
      onSkill();
    } else if (option.kind === "pattern") onPattern(option.pattern.members);
    else onPreset(option.preset);
    onQueryChange(""); onOpenChange(false);
  };

  return <div ref={rootRef} className="relative mt-3 rounded-md border border-glass-border bg-surface p-3">
    <label htmlFor="character-slash-search" className="block text-xs font-medium text-foreground">/ 角色操作</label>
    <div className="mt-2 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 text-text-muted" />
        <input id="character-slash-search" ref={inputRef} value={query} role="combobox"
          aria-autocomplete="list" aria-expanded={open} aria-controls="character-slash-options"
          aria-activedescendant={open && options.length ? `character-slash-option-${Math.min(activeIndex, options.length - 1)}` : undefined}
          placeholder={stage === "commands" ? "输入 / 搜索操作" : "搜索风格、面容、皮肤…"}
          onChange={(event) => { onQueryChange(event.target.value); if (stage === "terms") setActiveCategory("全部"); onOpenChange(event.target.value.startsWith("/")); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !open) return;
            if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); return; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => options.length ? (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0);
            }
            if (event.key === "Enter" && options.length) { event.preventDefault(); choose(options[Math.min(activeIndex, options.length - 1)]); }
          }}
          className="h-10 w-full rounded-md border border-glass-border bg-surface-inset pl-8 pr-2 text-sm text-foreground placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
      </div>
      <button type="button" aria-label={open ? "关闭快捷面板" : "打开快捷面板"} onClick={() => {
        setStage("commands"); onQueryChange("/"); onOpenChange(!open); inputRef.current?.focus();
      }} className="min-h-10 min-w-10 rounded-md border border-glass-border text-sm text-foreground hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{open ? <X size={16} className="mx-auto" /> : "/"}</button>
    </div>
    {open && <div className={`mt-2 min-h-0 overflow-hidden rounded-md border border-glass-border bg-elevated shadow-xl ${stage === "terms" ? "grid grid-cols-[6.5rem_minmax(0,1fr)]" : "block"}`}>
      {stage === "terms" && <nav aria-label="角色描述词分类" className="max-h-[min(52vh,420px)] overflow-y-auto border-r border-glass-border p-1.5">
        <button type="button" onClick={() => { setStage("commands"); onQueryChange("/"); inputRef.current?.focus(); }} className="mb-1 flex min-h-10 w-full items-center gap-1 rounded px-2 text-left text-xs text-foreground hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeft size={14} />返回操作</button>
        {BROWSE_CATEGORIES.map((category) => <button key={category} type="button"
          aria-pressed={!needle && activeCategory === category}
          onClick={() => { setActiveCategory(category); setActiveIndex(0); onQueryChange("/"); inputRef.current?.focus(); }}
          className={`mb-1 min-h-10 w-full rounded px-2 py-1.5 text-left text-xs leading-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!needle && activeCategory === category ? "bg-primary/15 font-medium text-foreground" : "text-text-secondary hover:bg-hover-bg"}`}>{category}</button>)}
      </nav>}
      <div className="max-h-[min(52vh,420px)] min-w-0 overflow-y-auto p-2">
      {stage === "terms" && <div className="sticky top-0 z-10 bg-elevated pb-2">
        <div role="group" aria-label="描述词语义层" className="flex flex-wrap gap-1">
          {DOMAIN_OPTIONS.map(({ label, value }) => <button key={label} type="button"
            aria-pressed={!needle && activeDomain === value}
            onClick={() => { setActiveDomain(value); setActiveCategory("全部"); setActiveIndex(0); onQueryChange("/"); inputRef.current?.focus(); }}
            className={`min-h-9 rounded px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!needle && activeDomain === value ? "bg-primary/15 text-foreground" : "text-text-secondary hover:bg-hover-bg"}`}>{label}</button>)}
        </div>
        {needle && <p className="px-1 pt-1 text-[11px] text-text-muted">搜索全部语义层</p>}
      </div>}
      <div id="character-slash-options" role="listbox" aria-label={stage === "commands" ? "角色操作" : "角色描述词"}>
      {stage === "terms" && platformLoading && <p className="px-2 py-2 text-xs text-text-muted">正在读取平台词典…</p>}
      {stage === "terms" && platformError && <p className="px-2 py-2 text-xs text-status-failed-fg">平台词典读取失败。<button type="button" onClick={() => setRefresh((value) => value + 1)} className="underline">重试</button></p>}
      {stage === "terms" && unavailablePatterns.length > 0 && <p className="px-2 py-2 text-xs text-text-muted">{unavailablePatterns.length} 个组合方案的成员已失效或当前工位不支持，无法应用；草稿保持原样。</p>}
      {options.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">没有匹配项；原文不会被改动。</p>}
      {stage === "commands" && commands.map((command, index) => <button key={command.id} id={`character-slash-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} disabled={command.id === "design" && !canRunSkill}
        onClick={() => choose({ kind: "command", id: command.id })}
        className={`flex min-h-11 w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${activeIndex === index ? "bg-primary/10" : ""}`}>
        {command.id === "design" ? <Sparkles size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /> : <TextCursorInput size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />}
        <span><span className="block font-medium text-foreground">{command.title}</span><span className="mt-0.5 block leading-4 text-text-muted">{command.detail}</span></span>
      </button>)}
      {stage === "terms" && patterns.map((pattern, index) => <button key={pattern.id} id={`character-slash-option-${index}`} type="button" role="option" aria-selected={activeIndex === index}
        onClick={() => choose({ kind: "pattern", pattern })}
        className={`flex min-h-11 w-full flex-col justify-center rounded px-2 py-1.5 text-left hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeIndex === index ? "bg-primary/10" : ""}`}>
        <span className="text-xs font-medium text-foreground">组合方案 · {pattern.title}</span>
        <span className="mt-0.5 text-[11px] leading-4 text-text-muted">{DOMAIN_LABELS[pattern.semanticDomain]} · {pattern.members.map((member) => member.label).join(" → ")} · r{pattern.revision} · 点击写入可编辑草稿</span>
      </button>)}
      {stage === "terms" && CATEGORY_ORDER.map((category) => {
        const group = presets.filter((preset) => preset.category === category);
        if (!group.length) return null;
        return <div key={category}>
          <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-text-muted">快捷描述词 · {category}</p>
          {group.map((preset) => {
            const index = options.findIndex((option) => option.kind === "preset" && option.preset.id === preset.id);
            return <button key={preset.id} id={`character-slash-option-${index}`} type="button" role="option" aria-selected={activeIndex === index}
              onClick={() => choose({ kind: "preset", preset })}
              className={`flex min-h-11 w-full flex-col justify-center rounded px-2 py-1.5 text-left hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeIndex === index ? "bg-primary/10" : ""}`}>
              <span className="text-xs leading-4 text-foreground">{preset.label}</span>
              <span className="mt-0.5 text-[11px] leading-4 text-text-muted">{DOMAIN_LABELS[preset.semanticDomain]} · 写入{preset.target === "recognition_marks" ? "识别标记" : category} · {preset.source} · v{preset.revision}</span>
            </button>;
          })}
        </div>;
      })}
      </div>
      </div>
    </div>}
  </div>;
}
