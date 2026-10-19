export const CHARACTER_DICTIONARY_GROUPS = [
  { id: "face", label: "面部", children: [
    ["face-shape", "脸型"], ["eyes", "眼型"], ["brows", "眉形"], ["nose", "鼻形"],
    ["lips", "唇形"], ["eye-detail", "眼周细节"], ["marks", "识别标记"], ["face-overview", "面部综合"],
  ] },
  { id: "body", label: "身体", children: [["build", "体型与比例"], ["posture", "体态"], ["skin", "肤色与肤质"]] },
  { id: "look", label: "造型", children: [["hair", "发型"], ["clothing", "服装"], ["material", "服装材质"], ["palette", "配色"]] },
  { id: "style", label: "风格", children: [["genre", "题材与画风"], ["render", "风格质感"]] },
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
  const aliases: Record<string, string> = { "eye-detail": "眼纹 眼周纹理 细纹", build: "身材 体型 比例", posture: "身材 站姿 姿态", clothing: "服饰 服装", material: "面料 材质" };
  return `${dictionaryCategoryPath(id)} ${aliases[id] || ""}`;
}

export function localDictionaryCategories(id: string): string[] {
  if (id === "character.facial_mark.under-eye") return ["eye-detail", "marks"];
  if (id === "character.skin.classical-aged-skin") return ["eye-detail", "skin"];
  if (["rounded-posture", "upright-posture", "classical-traveler-posture", "classical-shopkeeper-posture"].some((key) => id === `character.body.${key}`)) return ["posture"];
  const prefix = id.split(".")[1];
  const category: Record<string, string> = { face: "face-shape", eye_shape: "eyes", brow_shape: "brows", nose_shape: "nose",
    lip_shape: "lips", facial_mark: "marks", skin: "skin", body: "build", base_hair: "hair", clothing_silhouette: "clothing",
    clothing_material: "material", style: "genre", "style-note": "render" };
  return category[prefix] ? [category[prefix]] : [];
}

export function platformDictionaryCategories(path: string | undefined): string[] {
  const category: Record<string, string> = {
    "character/identity/face": "face-overview", "character/identity/marks": "marks", "character/identity/skin": "skin",
    "character/identity/build": "build", "character/identity/hair": "hair", "character/look/clothing": "clothing",
    "character/look/palette": "palette", "character/style": "render", "character/performance": "performance",
  };
  return path && category[path] ? [category[path]] : [];
}
