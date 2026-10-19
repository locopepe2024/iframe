export const CHARACTER_DICTIONARY_GROUPS = [
  { id: "face", label: "面部", children: [
    ["face-shape", "脸型"], ["eyes", "眼型"], ["brows", "眉形"], ["nose", "鼻形"],
    ["lips", "唇形"], ["eye-detail", "眼周细节"], ["marks", "识别标记"], ["face-overview", "面部综合"],
  ] },
  { id: "body", label: "身体", children: [["build", "体型与比例"], ["posture", "体态"], ["skin", "肤色与肤质"]] },
  { id: "style", label: "表现风格", children: [["render", "写实与绘画风格"], ["texture", "光影与质感"]] },
  { id: "setting", label: "时代与题材", children: [["era", "时代背景"], ["genre", "题材类型"]] },
  { id: "role", label: "角色定位", children: [["civilian-role", "日常身份"], ["jianghu-role", "江湖身份"]] },
  { id: "clothing", label: "服装", children: [["outfit", "完整穿搭方案"], ["garment", "现代服装款式"], ["inner", "贴身里衣"], ["outer", "外衣"], ["bottoms", "下装"], ["shoes", "鞋靴"], ["fit", "版型"], ["collar", "领口"], ["sleeve", "袖型"], ["clothing-detail", "廓形与细节"], ["material", "面料材质"], ["palette", "服装颜色"], ["accessory", "搭配单品"]] },
  { id: "look", label: "发型", children: [["hair", "发型描述"]] },
  { id: "performance", label: "表演", children: [["performance", "姿态与动作"]] },
] as const;

export function dictionaryCategoryPath(id: string): string {
  for (const group of CHARACTER_DICTIONARY_GROUPS) {
    if (group.id === id) return group.label;
    const child = group.children.find(([key]) => key === id);
    if (child) return `${group.label} › ${child[1]}`;
  }
  return "";
}

export function dictionaryCategorySearch(id: string): string {
  const aliases: Record<string, string> = { "eye-detail": "眼纹 眼周纹理 细纹", build: "身材 体型 比例", posture: "身材 站姿 姿态", outfit: "服饰 整套 服装", material: "面料 材质", shoes: "靴子 鞋子 布靴 皮靴", render: "画风 真人 二次元 国漫", palette: "配色 颜色", garment: "女装 男装 款式" };
  return `${dictionaryCategoryPath(id)} ${aliases[id] || ""}`;
}

export function localDictionaryCategories(id: string): string[] {
  if (id.startsWith("character.style.")) return [id.endsWith("historical-costume") || id.endsWith("xianxia-fantasy") ? "genre" : "render"];
  if (id.startsWith("character.style-note.")) return [ ["natural-cinema", "soft-natural", "low-saturation", "film-grain"].some((key) => id.endsWith(`.${key}`)) ? "texture" : "render" ];
  if (id === "character.facial_mark.under-eye") return ["eye-detail", "marks"];
  if (id === "character.skin.classical-aged-skin") return ["eye-detail", "skin"];
  if (["rounded-posture", "upright-posture", "classical-traveler-posture", "classical-shopkeeper-posture"].some((key) => id === `character.body.${key}`)) return ["posture"];
  const prefix = id.split(".")[1];
  const category: Record<string, string> = { face: "face-shape", eye_shape: "eyes", brow_shape: "brows", nose_shape: "nose",
    lip_shape: "lips", facial_mark: "marks", skin: "skin", body: "build", base_hair: "hair", clothing_silhouette: "clothing-detail",
    clothing_material: "material", "style-note": "texture" };
  return category[prefix] ? [category[prefix]] : [];
}

export function platformDictionaryCategories(path: string | undefined): string[] {
  const category: Record<string, string> = {
    "character/identity/face": "face-overview", "character/identity/marks": "marks", "character/identity/skin": "skin",
    "character/identity/build": "build", "character/identity/hair": "hair", "character/look/clothing": "clothing-detail",
    "character/look/palette": "palette", "character/style": "render", "character/performance": "performance",
  };
  return path && category[path] ? [category[path]] : [];
}

/** Slot labels describe a destination; they are not text to append to the Prompt. */
export function dictionarySlotCategory(label: string | undefined): string | null {
  if (!label) return null;
  if (/颜色|配色/.test(label)) return "palette";
  if (/面料|材质/.test(label)) return "material";
  if (/版型/.test(label)) return "fit";
  if (/领口|领型/.test(label)) return "collar";
  if (/袖/.test(label)) return "sleeve";
  if (/鞋|靴/.test(label)) return "shoes";
  if (/里衣|内衣/.test(label)) return "inner";
  if (/外衣|外套/.test(label)) return "outer";
  if (/下装/.test(label)) return "bottoms";
  if (/搭配|配饰/.test(label)) return "accessory";
  if (/款式|女装|男装/.test(label)) return "garment";
  if (/风格|画风/.test(label)) return "render";
  return null;
}
