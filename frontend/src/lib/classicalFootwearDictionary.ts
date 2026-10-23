import type { CharacterDictionaryPreset, DictionarySection } from "./characterDictionaryPresets";

const source = "用户提供的古代鞋履提示词 · iFrame 分类整理 · 创作参考";
type FootwearStyle = { title: string; shape: string; text: string; search: string; defaults: Record<string, string> };
export const CLASSICAL_FOOTWEAR_STYLES: FootwearStyle[] = [
  { title: "云纹皂靴", shape: "靴", text: "古风黑色皂靴，缎面材质，靴面有传统刺绣祥云纹，鞋底与靴筒连接清楚。", search: "文官 侠客 ancient Chinese black official boots classic soap boots satin texture traditional embroidered cloud patterns", defaults: { "鞋履颜色": "黑色", "鞋履材质": "缎面", "鞋履工艺": "精细刺绣", "鞋履图案": "祥云纹" } },
  { title: "战靴／轻甲靴", shape: "轻甲战靴", text: "古风皮革轻甲战靴，靴面护片与金属铆钉连接清楚，结构便于行动。", search: "将领 刺客 战靴 轻甲靴 ancient Chinese warrior boots leather armored combat boots metallic studs ready for battle", defaults: { "鞋履材质": "真皮", "鞋履装饰": "金属铆钉" } },
  { title: "翘头高筒靴", shape: "高筒靴", text: "古风高筒靴，鞋尖上翘，厚底，鞋面带传统纹样刺绣，靴筒轮廓清楚。", search: "historical Chinese high-top boots upturned toes thick soles embroidered traditional motifs", defaults: { "鞋头形状": "翘头", "鞋底结构": "厚底", "鞋履工艺": "传统纹样刺绣" } },
  { title: "锦缎翘头靴", shape: "靴", text: "古风锦缎翘头靴，织物纹理清楚，金丝装饰反光克制。", search: "贵族 公子 luxurious silk damask boots upturned toe vibrant brocade fabric gold thread embroidery royal fantasy style", defaults: { "鞋履材质": "锦缎", "鞋头形状": "翘头", "鞋履工艺": "金丝编织" } },
  { title: "毛边雪地靴", shape: "冬季靴", text: "古风北方冬季靴，厚实皮革靴面，靴口有白色毛边，内部采用保暖毡衬。", search: "冬装 北方 ancient northern style winter boots thick white fur trim heavy leather warm felt lining", defaults: { "鞋履材质": "厚皮革", "鞋履装饰": "白色毛边", "鞋履内衬": "保暖毡衬" } },
  { title: "翘头履", shape: "履", text: "古风翘头履，鞋头上翘，平底，鞋面采用精细花卉刺绣。", search: "汉唐 汉服 traditional Hanfu shoes upturned toe-cap Qiaotou Lv exquisite floral embroidery flat soles", defaults: { "鞋头形状": "翘头", "鞋底结构": "平底", "鞋履工艺": "精细刺绣", "鞋履图案": "花卉纹" } },
  { title: "绣花鞋", shape: "鞋", text: "古风软布绣花鞋，荷花与喜鹊纹样采用细密丝线刺绣，鞋面柔软，鞋底结构自然。", search: "日常 闺阁 ancient Chinese embroidered cloth shoes delicate silk embroidery of lotus and magpies soft fabric", defaults: { "鞋履材质": "软布", "鞋履工艺": "精细刺绣", "鞋履图案": "荷花喜鹊纹" } },
  { title: "流苏珍珠婚礼鞋", shape: "婚礼鞋", text: "古风大红丝绸婚礼鞋，珍珠与短流苏连接清楚，鞋面带金凤刺绣。", search: "千金 新娘 流苏 珍珠 ancient Chinese bridal shoes bright red silk decorated with pearl beads hanging tassels gold phoenix embroidery", defaults: { "鞋履颜色": "大红色", "鞋履材质": "丝绸", "鞋履装饰": "珍珠与短流苏", "鞋履工艺": "金线刺绣", "鞋履图案": "凤凰纹" } },
  { title: "古代厚底履", shape: "高台履", text: "古风高台履，多层白色厚底与织物鞋面连接清楚，厚底比例自然。", search: "高台履 ancient platform shoes traditional multi-layered white soles woven fabric upper", defaults: { "鞋履材质": "织物", "鞋底结构": "多层白色厚底" } },
  { title: "草鞋", shape: "编织凉鞋", text: "古风编织草鞋，编织结构清楚，材质质朴，固定脚部的系带关系自然。", search: "隐士 平民 historical Chinese straw sandals rustic texture minimalist ancient style", defaults: { "鞋履材质": "编织草料", "鞋履颜色": "草麻本色" } },
  { title: "布履", shape: "履", text: "古风素面布履，麻布鞋面质朴，鞋底手工纳制，结构简洁。", search: "隐士 平民 woven hemp shoes cloth shoes rustic texture minimalist ancient style", defaults: { "鞋履材质": "麻布", "鞋履工艺": "手工纳底" } },
];

export const FOOTWEAR_DETAIL_FIELDS = ["鞋履颜色", "鞋履材质", "鞋履工艺", "鞋履图案", "鞋头形状", "鞋底结构", "鞋履装饰", "鞋履内衬"];
export const CLASSICAL_FOOTWEAR_SECTION: DictionarySection = { label: "鞋履", parts: [
  "脚穿[古装鞋履]。", "鞋履颜色为[鞋履颜色]。", "鞋面材质为[鞋履材质]。", "鞋履工艺为[鞋履工艺]。", "鞋面图案为[鞋履图案]。", "鞋头为[鞋头形状]。", "鞋底为[鞋底结构]。", "鞋履装饰为[鞋履装饰]。", "鞋内衬为[鞋履内衬]。",
] };

const englishNames: Record<string, string> = {
  "黑色": "black", "深红色": "dark red", "大红色": "bright red", "米白色": "ivory", "深棕色": "dark brown", "草麻本色": "natural straw hemp color",
  "丝绸": "silk", "锦缎": "brocade silk damask", "真皮": "genuine leather", "软布": "soft cloth", "缎面": "satin", "厚皮革": "heavy leather", "织物": "woven fabric", "麻布": "hemp cloth", "编织草料": "woven straw",
  "精细刺绣": "delicate embroidery", "复杂刺绣": "intricate embroidery", "传统纹样刺绣": "embroidered traditional motifs", "金丝编织": "gold thread weaving", "金线刺绣": "gold thread embroidery", "手工纳底": "hand-stitched soles", "无额外刺绣": "no additional embroidery",
  "龙凤纹": "dragon and phoenix motifs", "祥云纹": "auspicious clouds", "仙鹤纹": "crane patterns", "荷花纹": "lotus flowers", "荷花喜鹊纹": "lotus and magpies", "凤凰纹": "phoenix motifs", "花卉纹": "floral motifs", "素面无纹": "plain unpatterned",
  "翘头": "翘头鞋尖 upturned toe", "圆头": "round toe", "方头": "square toe", "平底": "flat soles", "厚底": "thick soles", "多层白色厚底": "multi-layered white platform soles",
  "金属铆钉": "金属柳钉 metallic studs", "白色毛边": "white fur trim", "珍珠与短流苏": "pearl beads hanging tassels", "无额外装饰": "no additional ornaments", "保暖毡衬": "warm felt lining", "柔软布衬": "soft cloth lining",
};
const details = (category: string, label: string, values: string[]): CharacterDictionaryPreset[] => values.map((title, index) => ({
  id: `dictionary.footwear.${category}.${index}`, title, text: `鞋履${label}：${title}。`, slotValue: title,
  type: "词条", categories: [category], domain: "鞋履", source, search: `鞋履 鞋靴 ${title} ${englishNames[title] || ""}`,
}));

export const CLASSICAL_FOOTWEAR_TERMS: CharacterDictionaryPreset[] = [
  ...CLASSICAL_FOOTWEAR_STYLES.map((style, index): CharacterDictionaryPreset => ({
    id: `dictionary.footwear.style.${index}`, title: style.title, text: style.text, slotValue: style.title,
    type: "词条", categories: ["classical-shoes"], domain: "鞋履", source, search: `鞋履 鞋靴 ${style.title} ${style.text} ${style.search}`,
  })),
  ...details("shoe-color", "颜色", ["黑色", "深红色", "大红色", "米白色", "深棕色", "草麻本色"]),
  ...details("shoe-material", "材质", ["丝绸", "锦缎", "真皮", "软布", "缎面", "厚皮革", "织物", "麻布", "编织草料"]),
  ...details("shoe-craft", "工艺", ["精细刺绣", "复杂刺绣", "传统纹样刺绣", "金丝编织", "金线刺绣", "手工纳底", "无额外刺绣"]),
  ...details("shoe-pattern", "图案", ["龙凤纹", "祥云纹", "仙鹤纹", "荷花纹", "荷花喜鹊纹", "凤凰纹", "花卉纹", "素面无纹"]),
  ...details("shoe-toe", "鞋头", ["翘头", "圆头", "方头"]),
  ...details("shoe-sole", "鞋底", ["平底", "厚底", "多层白色厚底"]),
  ...details("shoe-decoration", "装饰", ["金属铆钉", "白色毛边", "珍珠与短流苏", "无额外装饰"]),
  ...details("shoe-lining", "内衬", ["保暖毡衬", "柔软布衬"]),
];
