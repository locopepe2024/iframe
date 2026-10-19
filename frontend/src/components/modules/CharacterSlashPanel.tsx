"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Search, Sparkles, X } from "lucide-react";
import {
  searchCharacterQuickPresets, type CharacterQuickPreset, type CharacterPresetCategory,
} from "@/lib/characterQuickActions";

const CATEGORY_ORDER: CharacterPresetCategory[] = ["风格", "面容", "皮肤", "身材体态", "服装", "发型"];
type BrowseCategory = "全部" | "Skill" | CharacterPresetCategory;
const BROWSE_CATEGORIES: BrowseCategory[] = ["Skill", ...CATEGORY_ORDER];
const SKILL_SEARCH = "角色设计 skill 技能 身份 外观 题材 画风";

export default function CharacterSlashPanel({ open, query, onQueryChange, onOpenChange, onPreset, onSkill, canRunSkill, inputRef }: {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onPreset: (preset: CharacterQuickPreset) => void;
  onSkill: () => void;
  canRunSkill: boolean;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<BrowseCategory>("面容");
  const needle = query.replace(/^\//, "").trim();
  const browsingAll = !!needle || activeCategory === "全部";
  const showSkill = (browsingAll || activeCategory === "Skill") && (!needle || SKILL_SEARCH.includes(needle.toLocaleLowerCase()));
  const presets = searchCharacterQuickPresets(needle).filter((preset) => browsingAll || preset.category === activeCategory);
  const options: Array<{ kind: "skill" } | { kind: "preset"; preset: CharacterQuickPreset }> = [
    ...(showSkill ? [{ kind: "skill" as const }] : []),
    ...presets.map((preset) => ({ kind: "preset" as const, preset })),
  ];

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, onOpenChange]);

  const choose = (option: typeof options[number]) => {
    if (option.kind === "skill") {
      if (!canRunSkill) return;
      onSkill();
    } else onPreset(option.preset);
    onQueryChange("");
    onOpenChange(false);
  };

  return <div ref={rootRef} className="relative mt-3 rounded-md border border-glass-border bg-surface p-3">
    <label htmlFor="character-slash-search" className="block text-xs font-medium text-foreground">/ Skill 与快捷描述词</label>
    <div className="mt-2 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 text-text-muted" />
        <input id="character-slash-search" ref={inputRef} value={query} role="combobox"
          aria-autocomplete="list" aria-expanded={open} aria-controls="character-slash-options"
          aria-activedescendant={open && options.length ? `character-slash-option-${Math.min(activeIndex, options.length - 1)}` : undefined}
          placeholder="输入 / 搜索风格、面容、皮肤…"
          onChange={(event) => { onQueryChange(event.target.value); setActiveCategory("全部"); onOpenChange(event.target.value.startsWith("/")); }}
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
        onQueryChange("/"); onOpenChange(!open); inputRef.current?.focus();
      }} className="min-h-10 min-w-10 rounded-md border border-glass-border text-sm text-foreground hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{open ? <X size={16} className="mx-auto" /> : "/"}</button>
    </div>
    {open && <div className="mt-2 grid min-h-0 grid-cols-[6.5rem_minmax(0,1fr)] overflow-hidden rounded-md border border-glass-border bg-elevated shadow-xl">
      <nav aria-label="角色快捷分类" className="max-h-[min(52vh,420px)] overflow-y-auto border-r border-glass-border p-1.5">
        {BROWSE_CATEGORIES.map((category) => <button key={category} type="button"
          aria-pressed={!needle && activeCategory === category}
          onClick={() => { setActiveCategory(category); setActiveIndex(0); onQueryChange("/"); inputRef.current?.focus(); }}
          className={`mb-1 min-h-10 w-full rounded px-2 py-1.5 text-left text-xs leading-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!needle && activeCategory === category ? "bg-primary/15 font-medium text-foreground" : "text-text-secondary hover:bg-hover-bg"}`}>{category}</button>)}
      </nav>
      <div id="character-slash-options" role="listbox" aria-label="角色 Skill 与快捷描述词" className="max-h-[min(52vh,420px)] min-w-0 overflow-y-auto p-2">
      {options.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">没有匹配项；原文不会被改动。</p>}
      {showSkill && <>
        <p className="px-2 py-1 text-[11px] font-medium text-text-muted">Skill · 当前可执行</p>
        <button id="character-slash-option-0" type="button" role="option" aria-selected={activeIndex === 0} disabled={!canRunSkill}
          onClick={() => choose({ kind: "skill" })}
          className={`flex min-h-11 w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${activeIndex === 0 ? "bg-primary/10" : ""}`}>
          <Sparkles size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span><span className="block font-medium text-foreground">生成角色视觉设计草稿</span><span className="mt-0.5 block leading-4 text-text-muted">现有双 Skill：character-identity-design + character-style-routes；先审核模型输入</span></span>
        </button>
      </>}
      {CATEGORY_ORDER.map((category) => {
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
              <span className="mt-0.5 text-[11px] leading-4 text-text-muted">写入{preset.target === "recognition_marks" ? "识别标记" : category} · {preset.source} · v{preset.revision}</span>
            </button>;
          })}
        </div>;
      })}
      </div>
    </div>}
  </div>;
}
