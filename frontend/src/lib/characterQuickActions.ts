import { AVATAR_FEATURE_LIBRARY } from "@/lib/avatarFeatureLibrary";
import type { PlatformReferenceResource } from "@/lib/api";

export type CharacterPresetTarget = "route" | "style_notes" | "face" | "skin" | "build" | "clothing" | "hair" | "recognition_marks";
export type CharacterPresetCategory = "风格" | "面容" | "皮肤" | "身材体态" | "服装" | "发型";
export type CharacterSemanticDomain = "character.identity" | "character.look" | "world.style";
export type CharacterDictionaryEntryType = "term" | "pattern";

export type CharacterQuickPreset = {
  id: string;
  revision: string;
  category: CharacterPresetCategory;
  semanticDomain: CharacterSemanticDomain;
  entryType: CharacterDictionaryEntryType;
  target: CharacterPresetTarget;
  label: string;
  value: string;
  searchText: string;
  source: string;
};

const styleRoutes = [
  ["realistic-modern", "真人现代"],
  ["historical-costume", "古装 / 武侠"],
  ["xianxia-fantasy", "修仙 / 仙侠"],
  ["anime-stylized", "动漫 / 国漫"],
] as const;

const styleTerms = [
  ["natural-cinema", "克制的电影写实，保留真实材质"],
  ["soft-natural", "柔和自然光写实，色彩不过度艳丽"],
  ["low-saturation", "低饱和色彩，环境色保持稳定"],
  ["film-grain", "轻微胶片颗粒，肤色保持自然"],
  ["ink-wash", "水墨晕染层次，保留人物清晰轮廓"],
  ["cel-shading", "二维赛璐璐上色，阴影分区明确"],
  ["storybook", "绘本质感，笔触与色块统一"],
  ["graphic-noir", "黑白图形感，高对比但保留面部层次"],
  ["anime-production", "动漫设定稿风格，线条干净，配色可复用"],
  ["manga-halftone", "黑白漫画线稿与克制网点阴影"],
  ["marker-sketch", "马克笔草图质感，轮廓与色块清晰"],
  ["light-novel", "轻小说插画质感，人物与环境光影统一"],
  ["cyberpunk-anime", "赛博朋克动漫质感，霓虹仅作局部光源"],
  ["watercolor-anime", "水彩动漫插画，透明色层与纸面纹理可见"],
  ["retro-animation", "复古二维动画质感，线条与色块保持稳定"],
  ["pastel-anime", "柔和粉彩动漫配色，肤色与服装色区分清楚"],
  ["ink-outline", "清晰墨线轮廓，局部笔触保留手绘变化"],
  ["flat-graphic", "平面图形插画，简化明暗但保留面部识别特征"],
  ["painterly-fantasy", "幻想题材厚涂质感，笔触层次统一"],
  ["limited-palette", "有限色板插画，角色各视角沿用同一组主色"],
  ["soft-cel", "柔和赛璐璐阴影，受光与背光分区清楚"],
  ["comic-ink", "漫画墨线与克制的阴影排线，面部结构清晰"],
  ["concept-sheet", "角色概念设定页质感，轮廓和材质标注易辨"],
] as const;

const MOTUART_INSPIRED_STYLE_IDS = new Set([
  "anime-production", "manga-halftone", "marker-sketch", "light-novel", "cyberpunk-anime",
  "watercolor-anime", "retro-animation", "pastel-anime", "ink-outline", "flat-graphic",
  "painterly-fantasy", "limited-palette", "soft-cel", "comic-ink", "concept-sheet",
]);

function libraryPresets(category: CharacterPresetCategory, target: CharacterPresetTarget, keys: string[]): CharacterQuickPreset[] {
  const semanticDomain: CharacterSemanticDomain = category === "服装" ? "character.look" : "character.identity";
  return keys.flatMap((key) => (AVATAR_FEATURE_LIBRARY[key] || []).map((option) => ({
    id: `character.${key}.${option.id}`,
    revision: "1" as const,
    category,
    semanticDomain,
    entryType: "term" as const,
    target,
    label: option.zh,
    value: option.zh,
    searchText: `${category} ${option.zh} ${option.en} ${key}`,
    source: option.provenance
      ? `${option.provenance.sourceRepo || "平台词条"} · ${option.provenance.license || "许可待核对"} · ${option.provenance.reviewStatus}`
      : "iFrame 平台基础词条",
  })));
}

export const CHARACTER_QUICK_PRESETS: CharacterQuickPreset[] = [
  ...styleRoutes.map(([value, label]) => ({
    id: `character.style.${value}`, revision: "1" as const,
    category: "风格" as const, target: "route" as const,
    semanticDomain: "world.style" as const, entryType: "term" as const,
    label, value, searchText: `风格 题材 画风 ${label} ${value}`,
    source: "iFrame 角色设计路由",
  })),
  ...styleTerms.map(([id, value]) => ({
    id: `character.style-note.${id}`, revision: "1" as const,
    category: "风格" as const, target: "style_notes" as const,
    semanticDomain: "world.style" as const, entryType: "term" as const,
    label: value, value, searchText: `风格 画风 ${value}`,
    source: MOTUART_INSPIRED_STYLE_IDS.has(id)
      ? "iFrame 重写测试词条 · MotuArt 动漫分类参考" : "iFrame V1 测试词条",
  })),
  ...libraryPresets("面容", "face", ["face", "eye_shape", "brow_shape", "nose_shape", "lip_shape"]),
  ...libraryPresets("面容", "recognition_marks", ["facial_mark"]),
  ...libraryPresets("皮肤", "skin", ["skin"]),
  ...libraryPresets("身材体态", "build", ["body"]),
  ...libraryPresets("服装", "clothing", ["clothing_silhouette", "clothing_material"]),
  ...libraryPresets("发型", "hair", ["base_hair"]),
];

export function searchCharacterQuickPresets(query: string, domain?: CharacterSemanticDomain): CharacterQuickPreset[] {
  const needle = query.trim().toLocaleLowerCase();
  return CHARACTER_QUICK_PRESETS.filter((item) =>
    (!domain || item.semanticDomain === domain) && (!needle || item.searchText.toLocaleLowerCase().includes(needle))
  );
}

const PLATFORM_TERM_TARGETS: Record<string, { category: CharacterPresetCategory; target: CharacterPresetTarget }> = {
  "character/identity/face": { category: "面容", target: "face" },
  "character/identity/marks": { category: "面容", target: "recognition_marks" },
  "character/identity/skin": { category: "皮肤", target: "skin" },
  "character/identity/build": { category: "身材体态", target: "build" },
  "character/identity/hair": { category: "发型", target: "hair" },
  "character/look/clothing": { category: "服装", target: "clothing" },
  "character/style": { category: "风格", target: "style_notes" },
};

export function platformCharacterTerm(resource: PlatformReferenceResource): CharacterQuickPreset | null {
  const mapping = PLATFORM_TERM_TARGETS[resource.category_path || ""];
  const value = resource.payload?.structured_prompt?.content?.trim();
  if (!mapping || resource.status !== "active" || resource.dictionary?.entry_type !== "term"
    || resource.dictionary.semantic_domain !== (mapping.category === "风格" ? "world.style" : mapping.category === "服装" ? "character.look" : "character.identity")
    || !value || resource.kind !== "prompt_preset") return null;
  return {
    id: `platform.${resource.platform_resource_id}`, revision: String(resource.revision),
    category: mapping.category, semanticDomain: resource.dictionary.semantic_domain as CharacterSemanticDomain,
    entryType: "term", target: mapping.target, label: resource.title, value,
    searchText: [resource.title, value, resource.category_path, ...(resource.tags || [])].join(" "),
    source: `平台词典 · ${resource.platform_resource_id} · ${resource.provenance.license}`,
  };
}

export type CharacterPlatformPattern = {
  id: string;
  revision: number;
  title: string;
  semanticDomain: CharacterSemanticDomain;
  members: CharacterQuickPreset[];
  searchText: string;
};

export function platformCharacterPattern(resource: PlatformReferenceResource, resources: PlatformReferenceResource[]): CharacterPlatformPattern | null {
  const dictionary = resource.dictionary;
  const members = dictionary?.members;
  if (resource.status !== "active" || resource.kind !== "prompt_preset" || dictionary?.entry_type !== "pattern"
    || !members || members.length < 2 || members.length > 12) return null;
  const resolved: CharacterQuickPreset[] = [];
  const used = new Set<string>();
  for (const member of members) {
    const key = `${member.platform_resource_id}@${member.revision}`;
    if (used.has(key)) return null;
    used.add(key);
    const target = resources.find((item) => item.platform_resource_id === member.platform_resource_id && item.revision === member.revision);
    const preset = target && platformCharacterTerm(target);
    if (!preset || preset.semanticDomain !== dictionary.semantic_domain) return null;
    resolved.push({ ...preset, source: `${preset.source} · 组合 ${resource.platform_resource_id} r${resource.revision}` });
  }
  return {
    id: resource.platform_resource_id, revision: resource.revision, title: resource.title,
    semanticDomain: dictionary.semantic_domain as CharacterSemanticDomain, members: resolved,
    searchText: [resource.title, resource.summary || "", ...resolved.map((item) => item.searchText)].join(" "),
  };
}
