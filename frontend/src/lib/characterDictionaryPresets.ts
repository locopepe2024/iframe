import { CLASSICAL_FOOTWEAR_STYLES, CLASSICAL_FOOTWEAR_TERMS, CLASSICAL_FOOTWEAR_SECTION, FOOTWEAR_DETAIL_FIELDS } from "./classicalFootwearDictionary";
/** Reusable descriptions, deliberately independent of generation model/style routes. */
import { CHARACTER_DICTIONARY_GROUPS, dictionarySlotCategory, localDictionaryCategories } from "./characterDictionaryCategories";
import { CHARACTER_QUICK_PRESETS } from "./characterQuickActions";
import { CLASSICAL_CHARACTER_TERMS, CLASSICAL_CHARACTER_TEMPLATES } from "./classicalCharacterDictionary";
import { CLASSICAL_CHARACTER_PANELS, sectionedDictionaryPreset } from "./classicalCharacterPanels";
import { MODERN_MALE_PANEL, MODERN_MALE_TEMPLATE, MODERN_MALE_TERMS } from "./modernMaleDictionary";
import { CHARACTER_EXPRESSION_DETAIL_TERMS, CHARACTER_EXPRESSION_PROMPTS } from "./characterExpressionPrompts";
import { CHARACTER_EXPRESSION_TERMS } from "./characterExpressionDictionary";
import type { CharacterConstraints } from "./characterStructuredDesign";
import { characterDictionaryField } from "./characterDictionaryFields";
export type DictionarySection = { label: string; parts: string[] };
export type OutfitField = { key: string; label: string; value: string; options: readonly string[]; output?: Record<string, string>; dependentKeys?: readonly string[] };
export type CharacterDictionaryPreset = {
  id: string;
  title: string;
  text: string;
  categories: string[];
  domain: string;
  source: string;
  search: string;
  type: "词条" | "Prompt 模板" | "配置面板";
  slotValue?: string;
  fields?: OutfitField[];
  defaults?: Record<string, string>;
  motionText?: string;
  sections?: DictionarySection[];
  optionalFields?: string[];
  fieldCategories?: Record<string, string>;
  constraints?: CharacterConstraints;
};

const source = "iFrame 创作词典 · v1 · 非历史考据方案";
const term = (id: string, title: string, text: string, category: string, domain: string): CharacterDictionaryPreset => ({
  id: `dictionary.${id}`, title, text, slotValue: title, categories: [category], domain, source, search: `${title} ${text}`, type: "词条",
});
const colors = ["米白色", "月白色", "浅灰色", "深灰色", "靛蓝色", "深青色", "墨黑色", "朱红色"];
const materials = ["哑光棉麻", "低光泽丝织", "细密素布"];
const shoes = ["黑色素面布靴", "深棕色素面皮靴", "黑色平底布鞋"];
const faceDetailTerms = [
  ['forehead', '额头', ['额头饱满', '额头平缓', '额头偏宽', '额头偏窄']],
  ['cheekbones', '颧骨', ['颧骨平缓', '颧骨清晰', '颧骨略宽', '颧骨略高']],
  ['jaw', '下颌', ['下颌轮廓柔和', '下颌轮廓分明', '下颌偏宽', '下颌偏窄']],
  ['chin', '下巴', ['下巴圆润', '下巴偏尖', '下巴方正', '下巴较短']],
] as const;
const panel = (id: string, title: string, text: string, categories: string[], search: string, defaults?: Record<string, string>): CharacterDictionaryPreset => {
  const labels: Record<string, string> = { "modern-clothing": "服装", gender: "性别", age: "年龄", height: "身高", skin: "皮肤", face: "面容", hair: "发型", posture: "姿态与动作", condition: "新旧", expression: "表情" };
  return sectionedDictionaryPreset({
    id: `dictionary.panel.${id}`, title, categories, defaults, type: "配置面板", domain: "局部配置", source,
    search: `${title} ${search}`,
    sections: [{ label: labels[id] || title, parts: text.split(/[，。]/).filter(Boolean).map((part) => `${part}。`) }],
    optionalFields: id === "modern-clothing" ? [] : Array.from(text.matchAll(/\[([^\[\]\n]+)\]/g), (match) => match[1]),
  });
};

const configurationPanels: CharacterDictionaryPreset[] = [
  ...CLASSICAL_CHARACTER_PANELS,
  MODERN_MALE_PANEL,
  panel("modern-clothing", "现代服装搭配 · 女装", "穿着[女装款式]，颜色为[颜色]，面料为[面料]，版型为[版型]，搭配要求为[搭配单品]，衣物状态为[衣物状态]。衣片连接清楚，保留自然褶皱。", ["clothing-panel"], "服装 现代 女装"),
  panel("face", "面容选择面板", "脸型为[脸型]，额头为[额头]，颧骨为[颧骨]，下颌为[下颌]，下巴为[下巴]，眼型为[眼型]，眉形为[眉形]，鼻型为[鼻型]，唇形为[唇形]，眼周细节为[眼周纹理]，肤色为[肤色]，肤质为[肤质]，妆容为[妆容]。", ["face-overview"], "面容 面部 五官 额头 颧骨 下颌 下巴 鼻型 唇形 眼角纹 眼袋 肤色 肤质"),
  sectionedDictionaryPreset({
    id: "dictionary.panel.basic", title: "基础特征", type: "配置面板", categories: ["basic-traits", "gender", "age-stage", "height"], domain: "身份", source,
    search: "基础特征 性别 年龄 年纪 身高", optionalFields: ["性别", "年龄阶段", "身高"],
    sections: [
      { label: "性别", parts: ["[性别]。"] },
      { label: "年龄", parts: ["[年龄阶段]。"] },
      { label: "身高", parts: ["[身高]。"] },
    ],
  }),
  panel("skin", "肤色与肤质选择面板", "肤色为[肤色]，肤质为[肤质]。", ["skin-tone", "skin"], "肤色 肤质 皮肤 skin tone complexion"),
  panel("hair", "发型选择面板", "发型为[发型]，发束结构和固定关系自然。", ["hair"], "发型 头发"),
  panel("posture", "体态选择面板", "人物体态：[体态]。", ["posture"], "体态 姿态 站姿"),
  panel("condition", "新旧状态选择面板", "衣物状态为[衣物状态]，首饰状态为[首饰状态]。", ["garment-condition", "jewelry-condition"], "新旧 使用状态 磨损 旧化"),
  panel("expression", "表情选择面板", "[表情]", ["expression-basic", "expression-happy", "expression-fear", "expression-sad", "expression-angry", "expression-complex"], "表情 情绪 微表情"),
];

export function configurationQueryCategory(query: string): string | null {
  const categories: Record<string, string> = { "服装": "clothing", "鞋履": "footwear", "鞋靴": "footwear", "鞋子": "footwear", "靴子": "footwear", "面容": "face", "面部": "face", "发型": "look", "首饰": "jewelry", "饰品": "jewelry", "装饰": "decoration", "男装": "modern-male-garment", "现代男装": "modern-male-garment", "体态": "posture", "基础特征": "basic-traits", "性别": "gender", "年龄": "age-stage", "年纪": "age-stage", "年龄阶段": "age-stage", "身高": "height", "肤色": "skin-tone", "肤质": "skin", "皮肤": "skin-tone", "新旧": "condition", "使用状态": "condition", "表情": "expression", "情绪": "expression" };
  return categories[query.trim()] || null;
}

export function isConfigurationQuery(query: string): boolean {
  return configurationQueryCategory(query) !== null;
}

function outfit(id: string, title: string, outer: string, lower: string, color: string): CharacterDictionaryPreset {
  return {
    id: `dictionary.outfit.${id}`, title, type: "Prompt 模板", categories: ["classical-template"], domain: "完整 Prompt", source,
    search: `${title} 古装 穿搭 里衣 外衣 下装 鞋靴 靴子 完整服装 两层`,
    text: `表现风格：{style}。\n角色身份：一位成年{role}，古风创作设定。\n服装：上身穿两件衣物：{innerColor}贴身里衣一件，外穿{outerColor}{material}${outer}一件。领口仅露出一道里衣领缘，袖口不叠加装饰袖。下穿{lowerColor}${lower}，脚穿{shoes}，腰束窄布带。衣物{wear}，穿着关系清楚，无额外中衣、披风、护甲或装饰性叠领。\n构图与背景：人物自然站立，简洁浅色背景，全身服装完整可见，人体比例自然。`,
    fields: [
      { key: "style", label: "表现风格", value: "写实真人影像风格，材质和光影自然可信", options: ["写实真人影像风格，材质和光影自然可信", "二次元国漫风格，二维线条清晰，赛璐璐明暗分区明确"] },
      { key: "role", label: "角色定位", value: id === "travel" ? "行旅侠客" : "书生", options: ["行旅侠客", "书生", "掌柜"] },
      { key: "innerColor", label: "里衣颜色", value: "米白色", options: colors },
      { key: "outerColor", label: "外衣颜色", value: color, options: colors },
      { key: "material", label: "外衣材质", value: "哑光棉麻", options: materials },
      { key: "lowerColor", label: "下装颜色", value: "深灰色", options: colors },
      { key: "shoes", label: "鞋靴", value: "黑色素面布靴", options: shoes },
      { key: "wear", label: "使用状态", value: "略有日常使用痕迹，版型完整", options: ["略有日常使用痕迹，版型完整", "整洁完好，布面自然平整", "边缘轻微磨损，主体完整"] },
    ],
  };
}

export function renderDictionaryPreset(preset: CharacterDictionaryPreset, values: Record<string, string> = {}): string {
  const fields = dictionaryPresetFields(preset, values);
  const fieldValue = (field: OutfitField) => values[field.key] !== undefined && field.options.includes(values[field.key]) ? values[field.key] : field.value;
  const substitute = (text: string) => text.replace(/\{(\w+)\}|\[([^\[\]\n]+)\]/g, (placeholder, key: string, label: string) => {
    const field = fields.find((item) => item.key === (key || label));
    if (!field) return placeholder;
    const value = fieldValue(field);
    return field.output?.[value] ?? value;
  });
  if (["dictionary.panel.face", "dictionary.panel.skin"].includes(preset.id)) {
    const labels: Record<string, string> = { "眼周纹理": "眼周细节" };
    return fields.flatMap(field => {
      const value = fieldValue(field);
      return value ? [`${labels[field.key] || field.label}：${field.output?.[value] ?? value}`] : [];
    }).join("\n");
  }
  if (preset.id === "dictionary.panel.expression") {
    const choice = values["表情"] || "";
    const combination = CHARACTER_EXPRESSION_PROMPTS.find(item => item.title === choice);
    if (combination) return renderDictionaryPreset(combination, values);
    const term = CHARACTER_EXPRESSION_TERMS.find(item => item.title === choice);
    if (term) return `表情：${term.slotValue || term.text}`;
  }
  if (!preset.sections) return substitute(preset.text);
  return preset.sections.flatMap((section) => {
    const sectionFields = fields.filter((field) => section.parts.some((part) => part.includes(`[${field.key}]`)));
    if (sectionFields.length && sectionFields.every((field) => fieldValue(field) === "")) return [];
    const parts = section.parts.filter((part) => {
      const labels = Array.from(part.matchAll(/\[([^\[\]\n]+)\]/g), (match) => match[1]);
      return labels.every((label) => {
        const field = fields.find((item) => item.key === label);
        return !field || fieldValue(field) !== "";
      });
    }).map(substitute);
    return parts.length ? [`${section.label}：${parts.join("")}`] : [];
  }).join("\n");
}

/** Both reusable templates and Skill [slots] draw their choices from the dictionary. */
export function dictionaryPresetFields(preset: CharacterDictionaryPreset, values: Record<string, string> = {}): OutfitField[] {
  if (preset.id === "dictionary.panel.expression") {
    const terms = CHARACTER_EXPRESSION_TERMS;
    const choice: OutfitField = {
      key: "表情", label: "表情", value: "",
      options: ["", ...terms.map(item => item.title), ...CHARACTER_EXPRESSION_PROMPTS.map(item => item.title), "[表情]"],
      output: Object.fromEntries(terms.map(item => [item.title, item.slotValue || item.text])),
      dependentKeys: CHARACTER_EXPRESSION_PROMPTS[0].fields?.map(field => field.key),
    };
    const combination = CHARACTER_EXPRESSION_PROMPTS.find(item => item.title === values["表情"]);
    return combination ? [choice, ...dictionaryPresetFields(combination, values)] : [choice];
  }
  if (preset.fields) return preset.fields;
  if (preset.type !== "Prompt 模板" && preset.type !== "配置面板") return [];
  const defaults: Record<string, string> = { "角色定位": "行旅侠客", "外衣颜色": "靛蓝色", "下装颜色": "浅灰色", "外衣面料": "棉布", "表情": "平静克制", ...preset.defaults };
  const shoeTitle = values["古装鞋履"] ?? preset.defaults?.["古装鞋履"];
  const footwearStyle = CLASSICAL_FOOTWEAR_STYLES.find((style) => style.title === shoeTitle);
  Object.assign(defaults, footwearStyle?.defaults);
  return Array.from(new Set(Array.from(preset.text.matchAll(/\[([^\[\]\n]+)\]/g), (match) => match[1])))
    .map((label) => {
      const category = preset.fieldCategories?.[label] || dictionarySlotCategory(label);
      const children: readonly string[] = CHARACTER_DICTIONARY_GROUPS.find((group) => group.id === category)?.children.map(([key]) => key) || [];
      const matches = (categories: string[]) => categories.some((key) => key === category || children.includes(key));
      const terms = CHARACTER_DICTIONARY_PRESETS.filter((item) => item.type === "词条" && matches(item.categories));
      const options = Array.from(new Set([
        ...terms.map((item) => item.title),
        ...CHARACTER_QUICK_PRESETS.filter((item) => item.target !== "route" && matches(localDictionaryCategories(item.id))).map((item) => item.value),
      ]));
      const output = Object.fromEntries(terms.map((item) => [item.title, item.slotValue || item.title]));
      const optional = preset.optionalFields?.includes(label);
      const defaultValue = optional ? footwearStyle?.defaults[label] ?? preset.defaults?.[label] : defaults[label];
      if (label === "古装鞋履") for (const style of CLASSICAL_FOOTWEAR_STYLES) output[style.title] = style.shape;
      return { key: label, label, value: defaultValue !== undefined && options.includes(defaultValue) ? defaultValue : optional ? "" : options[0] || `[${label}]`, options: [...(optional ? [""] : []), ...options, `[${label}]`], output, dependentKeys: label === "古装鞋履" ? FOOTWEAR_DETAIL_FIELDS : undefined };
    });
}

function classicalBaseTemplate(id: string, title: string, style: string): CharacterDictionaryPreset {
  return sectionedDictionaryPreset({
    id: `dictionary.template.${id}`, title, type: "Prompt 模板", categories: ["classical-template"], domain: "完整 Prompt", source,
    search: `古装 古风 武侠 完整 prompt 模板 人物 角色 ${title}`,
    optionalFields: [...FOOTWEAR_DETAIL_FIELDS],
    sections: [
      { label: "角色身份", parts: ["一位成年[角色定位]，古风创作设定。"] },
      { label: "表现风格", parts: [style] },
      { label: "面容", parts: ["人物为[脸型]，眉形为[眉形]，眼型为[眼型]。"] },
      { label: "发型", parts: ["[发型]。"] },
      { label: "服装", parts: ["上身穿两件衣物：[里衣颜色]贴身里衣一件，外穿[外衣颜色][外衣面料]窄袖交领长袍一件，领口仅露出一道里衣领缘。下穿[下装颜色]长裤，腰束窄布带。无额外中衣、披风、护甲或装饰性叠领。"] },
      CLASSICAL_FOOTWEAR_SECTION,
      { label: "构图与背景", parts: ["人物自然站立，简洁浅色背景，全身服装与鞋履完整可见，布料具有可信的重量和自然褶皱。"] },
    ],
  });
}

export const CHARACTER_DICTIONARY_PRESETS: CharacterDictionaryPreset[] = [
  ...configurationPanels,
  ...["唇线自然平直", "上唇略薄、下唇自然饱满", "上下唇厚度接近", "唇峰清晰、嘴角自然"].map((name, index) =>
    term(`face-detail.lips.${index}`, name, name, "lips", "嘴唇")),
  ...faceDetailTerms.flatMap(([category, label, choices]) => choices.map((name, index) =>
    term(`face-detail.${category}.${index}`, name, name, category, label))),
  ...["身高偏矮", "中等身高", "身高偏高", "身形高挑", "身高约150厘米", "身高约160厘米", "身高约170厘米", "身高约180厘米", "身高约190厘米"].map((name, index) =>
    term(`height.${index}`, name, `人物${name}，人体比例自然。`, "height", "身体")),
  ...["瓷白肤色", "浅白肤色", "浅米色肤色", "自然米色肤色", "暖小麦肤色", "古铜肤色", "深棕肤色", "深褐肤色"].map((name, index) =>
    term(`skin-tone.${index}`, name, `人物肤色为${name.replace("肤色", "")}，面部、颈部及外露肢体肤色一致，保留自然明暗层次。`, "skin-tone", "身体")),
  ...[
    ["fine-static", "静态眼角细纹", "表情放松时，眼角仍可见少量浅细纹"],
    ["crows-feet-static", "静态鱼尾纹", "表情放松时，外眼角仍可见放射状鱼尾纹"],
    ["smile-only", "仅微笑时出现眼角纹", "眼角细纹仅在微笑时出现，表情放松时不明显"],
    ["lower-lid", "下眼睑细纹", "下眼睑有浅细纹，纹理范围局限于下眼睑"],
    ["eye-bags", "轻微眼袋", "下眼睑有轻微自然隆起的眼袋，区别于眼下阴影"],
  ].map(([id, title, text]) => ({ ...term(`eye-detail.${id}`, title, `${text}。`, "eye-detail", "面容"), slotValue: text })),
  ...[
    ["fine", "细腻自然肤质", "皮肤纹理细腻自然，保留细微起伏，不过度磨皮"],
    ["dry", "轻微干燥肤质", "面颊皮肤略显干燥，保留细微干燥纹理"],
    ["oily", "局部轻微油光", "额头与鼻翼有轻微自然油光，面颊不过度反光"],
    ["acne-marks", "少量浅痘印", "面颊有少量浅痘印，分布自然且不过度夸张"],
  ].map(([id, title, text]) => ({ ...term(`skin-texture.${id}`, title, `${text}。`, "skin", "面容"), slotValue: text })),
  ...MODERN_MALE_TERMS,
  MODERN_MALE_TEMPLATE,
  ...CLASSICAL_CHARACTER_TERMS,
  ...CLASSICAL_FOOTWEAR_TERMS,
  ...CLASSICAL_CHARACTER_TEMPLATES,
  ...["男性", "女性"].map((title, index) => ({
    ...term(`gender.${index}`, title, `人物性别为${title}。`, "gender", "身份"), slotValue: `人物性别为${title}`,
  })),
  ...["婴儿", "幼儿", "儿童", "少年", "青年", "成年", "中年", "老年"].map((title, index) => ({
    ...term(`age-stage.${index}`, title, `人物年龄阶段为${title}。`, "age-stage", "身份"), slotValue: `人物年龄阶段为${title}`,
  })),
  ...CHARACTER_EXPRESSION_TERMS,
  ...CHARACTER_EXPRESSION_DETAIL_TERMS,
  ...CHARACTER_EXPRESSION_PROMPTS,
  classicalBaseTemplate("classical-live-action", "写实真人古装", "写实真人影像风格，人体比例自然，皮肤保留真实纹理，光影自然克制。"),
  classicalBaseTemplate("classical-donghua", "二次元国漫古装", "二次元国漫风格，二维手绘线条清晰，赛璐璐明暗分区明确，色块干净，人物比例与五官造型统一。"),
  {
    id: "dictionary.template.modern-fashion", title: "写实现代女装展示", type: "Prompt 模板", categories: ["modern-template"], domain: "完整 Prompt", source,
    search: "现代 女装 电商 商品 模特 写实 真人 完整 prompt 模板",
    text: "角色身份：成年女装模特。\n服装：穿着[女装款式]，颜色为[颜色]，面料为[面料]，版型为[版型]，搭配要求为[搭配单品]。\n构图与背景：浅色棚拍背景，主体居中，服装完整可见，边缘清楚。重点展示服装的领口、袖型、腰线、下摆、面料纹理、自然褶皱和上身比例，服装主体不被手、头发或道具遮挡。\n表现风格：真实摄影质感，光线柔和，人物姿态自然，身体比例可信，皮肤保留自然纹理。画面无随机品牌标识、水印或乱码文字。",
  },
  term("render.live-action", "写实真人", "写实真人影像风格，人体比例自然，皮肤保留真实纹理，衣料与饰物具有可信的材质和重量，光影符合现场照明，色彩自然克制。", "render", "风格"),
  term("render.donghua", "二次元国漫", "二次元国漫风格，二维手绘线条清晰，人物比例与五官造型统一，赛璐璐明暗分区明确，色块干净，服装结构清楚，各视角保持设计一致。", "render", "风格"),
  term("era.classical", "古风创作", "古风创作设定，采用中国传统服饰与器物的视觉元素。", "era", "时代／题材"),
  term("era.song-inspired", "宋代背景（创作参考）", "时代背景参考宋代，服装与器物需采用同一时代语境，具体身份及服饰形制另行明确。", "era", "时代／题材"),
  term("genre.wuxia", "武侠", "武侠题材，人物与物件具有可信的重量和使用痕迹，动作符合身体结构。", "genre", "时代／题材"),
  term("genre.xianxia", "仙侠", "仙侠题材，超自然元素与世界设定一致，人物轮廓与服装穿着关系保持清楚。", "genre", "时代／题材"),
  term("role.scholar", "书生", "角色身份为读书人，举止文雅，随身物品围绕读书与书写活动。", "civilian-role", "角色定位"),
  term("role.shopkeeper", "掌柜", "角色身份为市井商铺掌柜，举止熟练，造型与日常经营活动相符。", "civilian-role", "角色定位"),
  term("role.traveler", "行旅侠客", "角色身份为行走江湖的侠客，装备便于步行与活动，随身物品具有实用用途。", "jianghu-role", "角色定位"),
  outfit("travel", "简洁江湖行装", "窄袖交领长袍", "长裤", "深青色"),
  outfit("daily", "素雅长衫便服", "素面交领长衫", "长裤", "靛蓝色"),
  outfit("skirt", "素雅衣裙", "及腰交领上衣", "素面长裙", "浅灰色"),
  term("inner.plain", "素面里衣", "贴身里衣采用素面薄布，领缘平整，适合穿在外衣之内。", "inner", "造型"),
  term("outer.cross-collar", "窄袖交领外衣", "外衣为窄袖交领款式，左右衣襟交叠关系清楚，裁剪便于活动。", "outer", "造型"),
  term("bottom.trousers", "宽松长裤", "下装为宽松长裤，裤脚收束，便于步行。", "bottoms", "造型"),
  term("bottom.skirt", "素面长裙", "下装为素面长裙，裙腰与裙摆结构清楚，布料自然下垂。", "bottoms", "造型"),
  term("shoes.cloth-boots", "素面布靴", "脚穿黑色素面平底布靴，靴筒结构简洁，鞋底适合步行。", "shoes", "造型"),
  term("shoes.leather-boots", "素面皮靴", "脚穿深棕色素面平底皮靴，皮面柔韧，靴口与鞋底连接自然。", "shoes", "造型"),
  term("shoes.cloth-shoes", "平底布鞋", "脚穿黑色平底布鞋，鞋面素净，鞋底厚度适中。", "shoes", "造型"),
  ...["米白色", "月白色", "靛蓝色", "深青色", "朱红色", "黑色", "浅灰色", "浅杏色", "深灰色"].map((color, index) => term(`palette.${index}`, color, `服装主色为${color}，辅色保持克制。`, "palette", "造型")),
  ...["衬衫", "连衣裙", "针织开衫", "西装外套", "半身裙", "直筒长裤"].map((name, index) => term(`garment.${index}`, name, `现代${name}，衣片连接与穿着关系清楚，保留自然褶皱。`, "garment", "造型")).map((entry) => ({ ...entry, categories: [...entry.categories, "modern-female-garment"] })),
  ...["合身版型", "宽松版型", "直筒版型", "收腰版型", "A字版型"].map((name, index) => term(`fit.${index}`, name, `服装采用${name}，轮廓与人体比例协调。`, "fit", "造型")),
  ...["圆领", "V领", "方领", "翻领", "立领"].map((name, index) => term(`collar.${index}`, name, `服装领口为${name}，领缘结构清楚。`, "collar", "造型")),
  ...["短袖", "长袖", "无袖", "泡泡袖", "直筒袖"].map((name, index) => term(`sleeve.${index}`, name, `服装采用${name}设计，袖型与肩部连接自然。`, "sleeve", "造型")),
  ...["棉布", "亚麻", "丝绸", "针织面料", "牛仔布", "雪纺"].map((name, index) => term(`material.${index}`, name, `服装采用${name}，纹理、光泽与垂坠符合材质特征。`, "material", "造型")).filter((item) => item.title !== "丝绸"),
  ...["平底鞋", "短靴", "简洁手提包", "细腰带", "不额外搭配单品"].map((name, index) => term(`accessory.${index}`, name, name === "不额外搭配单品" ? name : `搭配${name}，不遮挡服装主体。`, "accessory", "造型")),
];

/** Preserve exact panel values alongside prose instead of parsing the rendered sentence. */
export function dictionaryStructuredFields(preset: CharacterDictionaryPreset, values: Record<string, string>) {
  const result: { identity: Record<string, string>; look: Record<string, string>; constraints?: CharacterConstraints } = { identity: {}, look: {} };
  if (preset.type !== "配置面板") return result;
  if (["basic", "face", "skin", "hair", "height", "posture"].some(id => preset.id === `dictionary.panel.${id}`)) {
    for (const field of dictionaryPresetFields(preset, values)) {
      const target = characterDictionaryField(field.key)?.structured;
      const selected = values[field.key] !== undefined && field.options.includes(values[field.key]) ? values[field.key] : field.value;
      if (target && selected && !selected.includes('[')) result[target.section][target.key] = field.output?.[selected] ?? selected;
    }
  } else {
    // These are authored section labels, not a reverse parse of user prose.
    const sectionKeys: Record<string, string> = { '服装': 'clothing', '鞋履': 'footwear', '首饰': 'jewelry', '装饰': 'decoration' };
    for (const section of preset.sections || []) {
      const key = sectionKeys[section.label];
      if (!key) continue;
      const projectedSection = key === 'clothing'
        ? { ...section, parts: section.parts.filter(part => !part.includes('[衣物状态]')) } : section;
      const rendered = renderDictionaryPreset({ ...preset, sections: [projectedSection] }, values);
      if (rendered) result.look[key] = rendered.slice(section.label.length + 1);
    }
    for (const field of dictionaryPresetFields(preset, values)) {
      const target = characterDictionaryField(field.key)?.structured;
      if (!target || target.section !== 'look') continue;
      const selected = values[field.key] !== undefined && field.options.includes(values[field.key]) ? values[field.key] : field.value;
      if (selected && !selected.includes('[')) result.look[target.key] = field.output?.[selected] ?? selected;
    }
  }
  if (preset.constraints) result.constraints = preset.constraints;
  return result;
}

export type DictionaryConfiguration = {
  preset_id: string; schema_version: 'iframe.dictionary-config.v1';
  source: string; preset_text: string;
  selections: Record<string, string>; resolved_fields: Record<string, string>; rendered_text: string;
};

export function dictionaryConfiguration(preset: CharacterDictionaryPreset, values: Record<string, string>): DictionaryConfiguration {
  const selections: Record<string, string> = {};
  const resolved_fields: Record<string, string> = {};
  for (const field of dictionaryPresetFields(preset, values)) {
    const selected = values[field.key] !== undefined && field.options.includes(values[field.key]) ? values[field.key] : field.value;
    if (!selected) continue;
    selections[field.key] = selected;
    resolved_fields[field.key] = field.output?.[selected] ?? selected;
  }
  return { source: preset.source, preset_text: preset.text, preset_id: preset.id, schema_version: 'iframe.dictionary-config.v1', selections, resolved_fields, rendered_text: renderDictionaryPreset(preset, values) };
}
