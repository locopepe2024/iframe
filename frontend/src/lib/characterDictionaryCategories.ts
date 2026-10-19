export const CHARACTER_DICTIONARY_GROUPS = [
  { id: "face", label: "面部", children: [
    ["face-shape", "脸型"], ["eyes", "眼型"], ["brows", "眉形"], ["nose", "鼻形"],
    ["lips", "唇形"], ["eye-detail", "眼周细节"], ["marks", "识别标记"], ["face-overview", "面部综合"],
    ["makeup", "妆容"],
  ] },
  { id: "body", label: "身体", children: [["height", "身高"], ["build", "体型与比例"], ["posture", "体态"], ["skin-tone", "肤色"], ["skin", "肤质"]] },
  { id: "templates", label: "Prompt 模板", children: [["classical-template", "古装模板"], ["modern-template", "现代模板"]] },
  { id: "style", label: "表现风格", children: [["render", "写实与绘画风格"], ["texture", "光影与质感"]] },
  { id: "setting", label: "时代与题材", children: [["era", "时代背景"], ["genre", "题材类型"]] },
  { id: "role", label: "角色定位", children: [["civilian-role", "日常身份"], ["jianghu-role", "江湖身份"]] },
  { id: "clothing", label: "服装", children: [["clothing-panel", "穿搭选择面板"], ["classical-garment", "古装衣裙形制"], ["classical-male-outer", "古代男子外衣"], ["classical-female-upper", "古代女子上衣"], ["classical-inner", "古装里衣"], ["classical-skirt", "古装裙装"], ["classical-trousers", "古装裤装"], ["garment", "现代通用服装款式"], ["modern-female-garment", "现代女装款式"], ["modern-male-garment", "现代男装搭配"], ["modern-male-upper", "现代男装上衣"], ["modern-male-outer", "现代男装外套"], ["modern-male-bottoms", "现代男装裤装"], ["modern-male-shoes", "现代男装鞋履"], ["inner", "贴身里衣"], ["outer", "外衣"], ["bottoms", "下装"], ["scarf", "纱巾与披帛"], ["fit", "版型"], ["collar", "领口"], ["sleeve", "袖型"], ["clothing-detail", "廓形与细节"], ["material", "面料材质"], ["palette", "服装颜色"], ["accessory", "搭配单品"], ["layers", "衣层结构"]] },
  { id: "footwear", label: "鞋履", children: [["footwear-panel", "鞋履选择面板"], ["classical-shoes", "古装鞋履"], ["shoes", "通用鞋靴"], ["shoe-color", "鞋履颜色"], ["shoe-material", "鞋履材质"], ["shoe-craft", "鞋履工艺"], ["shoe-pattern", "鞋履图案"], ["shoe-toe", "鞋头形状"], ["shoe-sole", "鞋底结构"], ["shoe-decoration", "鞋履装饰"], ["shoe-lining", "鞋履内衬"]] },
  { id: "look", label: "发型", children: [["hair", "发型描述"]] },
  { id: "expression", label: "表情", children: [["expression-basic", "基础微表情"], ["expression-happy", "开心与松弛"], ["expression-fear", "紧张与恐惧"], ["expression-sad", "悲伤与崩溃"], ["expression-angry", "愤怒与对抗"], ["expression-complex", "复杂情绪与转折"]] },
  { id: "jewelry", label: "首饰", children: [["hair-jewelry", "发簪与头饰"], ["body-jewelry", "通用佩饰"], ["ear-jewelry", "耳饰"], ["neck-jewelry", "颈饰与项链"], ["wrist-jewelry", "腕饰与手镯"], ["waist-jewelry", "腰佩与香囊"], ["jewelry-material", "首饰材质"]] },
  { id: "decoration", label: "装饰", children: [["pattern", "花纹图案"], ["craft", "刺绣与织造工艺"], ["trim", "流苏飘带与腰带"]] },
  { id: "condition", label: "新旧与使用状态", children: [["garment-condition", "衣物状态"], ["jewelry-condition", "首饰状态"]] },
  { id: "scene", label: "场景与构图", children: [["background", "背景场景"], ["composition", "构图"], ["lighting", "光线"], ["constraints", "画面约束"]] },
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
  const aliases: Record<string, string> = { "eye-detail": "眼纹 眼周纹理 眼角纹 鱼尾纹 下眼睑纹 眼袋 细纹", build: "身材 体型 比例", posture: "身材 站姿 姿态", outfit: "服饰 整套 服装", material: "面料 材质", shoes: "靴子 鞋子 布靴 皮靴", render: "画风 真人 二次元 国漫", palette: "配色 颜色", garment: "女装 男装 款式" };
  return `${dictionaryCategoryPath(id)} ${aliases[id] || ""}`;
}

export function localDictionaryCategories(id: string): string[] {
  if (id.startsWith("character.style.")) return [id.endsWith("historical-costume") || id.endsWith("xianxia-fantasy") ? "genre" : "render"];
  if (id.startsWith("character.style-note.")) return [ ["natural-cinema", "soft-natural", "low-saturation", "film-grain"].some((key) => id.endsWith(`.${key}`)) ? "texture" : "render" ];
  if (id === "character.facial_mark.freckles") return ["marks", "skin"];
  if (id === "character.facial_mark.under-eye" || id === "character.facial_mark.classical-crows-feet") return ["eye-detail", "marks"];
  if (["warm-light", "neutral-medium", "warm-deep", "cool-light", "warm-medium", "cool-deep"].some((key) => id === `character.skin.${key}`)) return ["skin-tone"];
  if (id === "character.skin.classical-aged-skin") return ["skin"];
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
  const modernFields: Record<string, string> = { "男装款式": "modern-male-garment", "女装款式": "modern-female-garment", "男装上衣款式": "modern-male-upper", "男装外套款式": "modern-male-outer", "男装裤装款式": "modern-male-bottoms", "男装鞋履": "modern-male-shoes" };
  if (modernFields[label]) return modernFields[label];
  if (/男装外衣款式/.test(label)) return "classical-male-outer";
  if (/女装上衣款式/.test(label)) return "classical-female-upper";
  if (/古装里衣款式/.test(label)) return "classical-inner";
  if (/古装裤装款式/.test(label)) return "classical-trousers";
  if (/古装裙装款式/.test(label)) return "classical-skirt";
  const footwearFields: Record<string, string> = { "鞋履颜色": "shoe-color", "鞋履材质": "shoe-material", "鞋履工艺": "shoe-craft", "鞋履图案": "shoe-pattern", "鞋头形状": "shoe-toe", "鞋底结构": "shoe-sole", "鞋履装饰": "shoe-decoration", "鞋履内衬": "shoe-lining" };
  if (footwearFields[label]) return footwearFields[label];
  if (/古装鞋履/.test(label)) return "classical-shoes";
  if (/角色定位|身份/.test(label)) return "role";
  if (/身高/.test(label)) return "height";
  if (/肤色/.test(label)) return "skin-tone";
  if (/肤质|皮肤纹理/.test(label)) return "skin";
  if (/眼周|眼角纹|鱼尾纹|下眼睑纹|眼袋/.test(label)) return "eye-detail";
  if (/脸型/.test(label)) return "face-shape";
  if (/眉形/.test(label)) return "brows";
  if (/眼型/.test(label)) return "eyes";
  if (/发型/.test(label)) return "hair";
  if (/表情|情绪/.test(label)) return "expression";
  if (/体态|姿态/.test(label)) return "posture";
  if (/首饰材质/.test(label)) return "jewelry-material";
  if (/首饰状态/.test(label)) return "jewelry-condition";
  if (/新旧|衣物状态|使用状态/.test(label)) return "garment-condition";
  if (/头饰|发簪|发钗/.test(label)) return "hair-jewelry";
  if (/耳饰/.test(label)) return "ear-jewelry";
  if (/颈饰|项链/.test(label)) return "neck-jewelry";
  if (/腕饰|手镯/.test(label)) return "wrist-jewelry";
  if (/腰间佩饰|腰佩|香囊/.test(label)) return "waist-jewelry";
  if (/首饰|佩饰/.test(label)) return "body-jewelry";
  if (/纹样|花纹|图案/.test(label)) return "pattern";
  if (/刺绣|工艺/.test(label)) return "craft";
  if (/披帛|纱巾|面纱/.test(label)) return "scarf";
  if (/腰带|飘带|流苏/.test(label)) return "trim";
  if (/衣层/.test(label)) return "layers";
  if (/妆容/.test(label)) return "makeup";
  if (/背景|场景/.test(label)) return "background";
  if (/构图/.test(label)) return "composition";
  if (/光线|照明/.test(label)) return "lighting";
  if (/朝代|时代/.test(label)) return "era";
  if (/古装款式|衣裙款式/.test(label)) return "classical-garment";
  if (/颜色|配色/.test(label)) return "palette";
  if (/面料|材质/.test(label)) return "material";
  if (/版型/.test(label)) return "fit";
  if (/领口|领型/.test(label)) return "collar";
  if (/袖/.test(label)) return "sleeve";
  if (/鞋|靴/.test(label)) return "shoes";
  if (/里衣|内衣/.test(label)) return "inner";
  if (/外衣|外套/.test(label)) return "outer";
  if (/下装|裙装款式/.test(label)) return "bottoms";
  if (/搭配|配饰/.test(label)) return "accessory";
  if (/款式|女装|男装/.test(label)) return "garment";
  if (/风格|画风/.test(label)) return "render";
  return null;
}
