/** Reusable descriptions, deliberately independent of generation model/style routes. */
import { CHARACTER_DICTIONARY_GROUPS, dictionarySlotCategory, localDictionaryCategories } from "./characterDictionaryCategories";
import { CHARACTER_QUICK_PRESETS } from "./characterQuickActions";
import { CLASSICAL_CHARACTER_TERMS, CLASSICAL_CHARACTER_TEMPLATES } from "./classicalCharacterDictionary";
import { CLASSICAL_CHARACTER_PANELS, sectionedDictionaryPreset } from "./classicalCharacterPanels";
import { CHARACTER_EXPRESSION_TERMS } from "./characterExpressionDictionary";
export type DictionarySection = { label: string; parts: string[] };
export type OutfitField = { key: string; label: string; value: string; options: readonly string[]; output?: Record<string, string> };
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
};

const source = "iFrame 创作词典 · v1 · 非历史考据方案";
const term = (id: string, title: string, text: string, category: string, domain: string): CharacterDictionaryPreset => ({
  id: `dictionary.${id}`, title, text, slotValue: title, categories: [category], domain, source, search: `${title} ${text}`, type: "词条",
});
const colors = ["米白色", "月白色", "浅灰色", "深灰色", "靛蓝色", "深青色", "墨黑色", "朱红色"];
const materials = ["哑光棉麻", "低光泽丝织", "细密素布"];
const shoes = ["黑色素面布靴", "深棕色素面皮靴", "黑色平底布鞋"];
const panel = (id: string, title: string, text: string, categories: string[], search: string, defaults?: Record<string, string>): CharacterDictionaryPreset => {
  const labels: Record<string, string> = { "modern-clothing": "服装", face: "面容", hair: "发型", posture: "姿态与动作", condition: "新旧", expression: "表情" };
  return sectionedDictionaryPreset({
    id: `dictionary.panel.${id}`, title, categories, defaults, type: "配置面板", domain: "局部配置", source,
    search: `${title} ${search}`,
    sections: [{ label: labels[id] || title, parts: text.split(/[，。]/).filter(Boolean).map((part) => `${part}。`) }],
    optionalFields: id === "modern-clothing" ? [] : Array.from(text.matchAll(/\[([^\[\]\n]+)\]/g), (match) => match[1]),
  });
};

const configurationPanels: CharacterDictionaryPreset[] = [
  ...CLASSICAL_CHARACTER_PANELS,
  panel("modern-clothing", "现代服装搭配", "穿着[女装款式]，颜色为[颜色]，面料为[面料]，版型为[版型]，搭配要求为[搭配单品]，衣物状态为[衣物状态]。衣片连接清楚，保留自然褶皱。", ["clothing-panel"], "服装 现代 女装"),
  panel("face", "面容选择面板", "脸型为[脸型]，眼型为[眼型]，眉形为[眉形]，妆容为[妆容]。", ["face-overview"], "面容 面部 五官"),
  panel("hair", "发型选择面板", "发型为[发型]，发束结构和固定关系自然。", ["hair"], "发型 头发"),
  panel("posture", "体态选择面板", "人物体态：[体态]。", ["posture"], "体态 姿态 站姿"),
  panel("condition", "新旧状态选择面板", "衣物状态为[衣物状态]，首饰状态为[首饰状态]。", ["garment-condition", "jewelry-condition"], "新旧 使用状态 磨损 旧化"),
  panel("expression", "表情选择面板", "[表情]", ["expression-basic", "expression-happy", "expression-fear", "expression-sad", "expression-angry", "expression-complex"], "表情 情绪 微表情"),
];

export function configurationQueryCategory(query: string): string | null {
  const categories: Record<string, string> = { "服装": "clothing", "面容": "face", "面部": "face", "发型": "look", "首饰": "jewelry", "饰品": "jewelry", "装饰": "decoration", "体态": "posture", "新旧": "condition", "使用状态": "condition", "表情": "expression", "情绪": "expression" };
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
  const fields = dictionaryPresetFields(preset);
  const fieldValue = (field: OutfitField) => values[field.key] !== undefined && field.options.includes(values[field.key]) ? values[field.key] : field.value;
  const substitute = (text: string) => text.replace(/\{(\w+)\}|\[([^\[\]\n]+)\]/g, (placeholder, key: string, label: string) => {
    const field = fields.find((item) => item.key === (key || label));
    if (!field) return placeholder;
    const value = fieldValue(field);
    return field.output?.[value] ?? value;
  });
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
export function dictionaryPresetFields(preset: CharacterDictionaryPreset): OutfitField[] {
  if (preset.fields) return preset.fields;
  if (preset.type !== "Prompt 模板" && preset.type !== "配置面板") return [];
  const defaults: Record<string, string> = { "角色定位": "行旅侠客", "外衣颜色": "靛蓝色", "下装颜色": "浅灰色", "外衣面料": "棉布", "表情": "平静克制", ...preset.defaults };
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
      const defaultValue = optional ? preset.defaults?.[label] : defaults[label];
      return { key: label, label, value: defaultValue !== undefined && options.includes(defaultValue) ? defaultValue : optional ? "" : options[0] || `[${label}]`, options: [...(optional ? [""] : []), ...options, `[${label}]`], output };
    });
}

export const CHARACTER_DICTIONARY_PRESETS: CharacterDictionaryPreset[] = [
  ...configurationPanels,
  ...CLASSICAL_CHARACTER_TERMS,
  ...CLASSICAL_CHARACTER_TEMPLATES,
  ...CHARACTER_EXPRESSION_TERMS,
  {
    id: "dictionary.template.classical-live-action", title: "写实真人古装", type: "Prompt 模板", categories: ["classical-template"], domain: "完整 Prompt", source,
    search: "古装 古风 武侠 写实 真人 完整 prompt 模板 人物 角色",
    text: "角色身份：一位成年[角色定位]，古风创作设定。\n表现风格：写实真人影像风格，人体比例自然，皮肤保留真实纹理，光影自然克制。\n面容：人物为[脸型]，眉形为[眉形]，眼型为[眼型]。\n发型：[发型]。\n服装：上身穿两件衣物：[里衣颜色]贴身里衣一件，外穿[外衣颜色][外衣面料]窄袖交领长袍一件，领口仅露出一道里衣领缘。下穿[下装颜色]长裤，脚穿[鞋靴]，腰束窄布带。无额外中衣、披风、护甲或装饰性叠领。\n构图与背景：人物自然站立，简洁浅色背景，全身服装完整可见，布料具有可信的重量和自然褶皱。",
  },
  {
    id: "dictionary.template.classical-donghua", title: "二次元国漫古装", type: "Prompt 模板", categories: ["classical-template"], domain: "完整 Prompt", source,
    search: "古装 古风 武侠 二次元 国漫 动漫 完整 prompt 模板 人物 角色",
    text: "角色身份：一位成年[角色定位]，古风创作设定。\n表现风格：二次元国漫风格，二维手绘线条清晰，赛璐璐明暗分区明确，色块干净，人物比例与五官造型统一。\n面容：人物为[脸型]，眉形为[眉形]，眼型为[眼型]。\n发型：[发型]。\n服装：上身穿两件衣物：[里衣颜色]贴身里衣一件，外穿[外衣颜色][外衣面料]窄袖交领长袍一件，领口仅露出一道里衣领缘。下穿[下装颜色]长裤，脚穿[鞋靴]，腰束窄布带。无额外中衣、披风、护甲或装饰性叠领。\n构图与背景：人物自然站立，简洁浅色背景，全身服装完整可见，衣片连接和穿着关系清楚。",
  },
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
  ...["米白色", "月白色", "靛蓝色", "深青色", "朱红色", "黑色", "浅灰色", "浅杏色"].map((color, index) => term(`palette.${index}`, color, `服装主色为${color}，辅色保持克制。`, "palette", "造型")),
  ...["衬衫", "连衣裙", "针织开衫", "西装外套", "半身裙", "直筒长裤"].map((name, index) => term(`garment.${index}`, name, `现代${name}，衣片连接与穿着关系清楚，保留自然褶皱。`, "garment", "造型")),
  ...["合身版型", "宽松版型", "直筒版型", "收腰版型", "A字版型"].map((name, index) => term(`fit.${index}`, name, `服装采用${name}，轮廓与人体比例协调。`, "fit", "造型")),
  ...["圆领", "V领", "方领", "翻领", "立领"].map((name, index) => term(`collar.${index}`, name, `服装领口为${name}，领缘结构清楚。`, "collar", "造型")),
  ...["短袖", "长袖", "无袖", "泡泡袖", "直筒袖"].map((name, index) => term(`sleeve.${index}`, name, `服装采用${name}设计，袖型与肩部连接自然。`, "sleeve", "造型")),
  ...["棉布", "亚麻", "丝绸", "针织面料", "牛仔布", "雪纺"].map((name, index) => term(`material.${index}`, name, `服装采用${name}，纹理、光泽与垂坠符合材质特征。`, "material", "造型")).filter((item) => item.title !== "丝绸"),
  ...["平底鞋", "短靴", "简洁手提包", "细腰带", "不额外搭配单品"].map((name, index) => term(`accessory.${index}`, name, name === "不额外搭配单品" ? name : `搭配${name}，不遮挡服装主体。`, "accessory", "造型")),
];
