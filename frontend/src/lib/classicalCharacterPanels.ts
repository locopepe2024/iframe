import { CLASSICAL_FOOTWEAR_SECTION, FOOTWEAR_DETAIL_FIELDS } from "./classicalFootwearDictionary";
import type { CharacterDictionaryPreset, DictionarySection } from "./characterDictionaryPresets";

const decoration: DictionarySection = { label: "装饰", parts: ["花纹为[花纹]。", "工艺为[刺绣工艺]。", "肩臂搭配为[纱巾披帛]。", "装饰带为[飘带]。"] };
const jewelry: DictionarySection = { label: "首饰", parts: ["头饰为[头饰]。", "耳饰为[耳饰]。", "颈饰为[颈饰]。", "腕饰为[腕饰]。", "腰间佩饰为[腰间佩饰]。"] };
const condition: DictionarySection = { label: "新旧", parts: ["衣物状态为[衣物状态]。", "首饰状态为[首饰状态]。"] };
const optionalFields = [...FOOTWEAR_DETAIL_FIELDS, "花纹", "刺绣工艺", "纱巾披帛", "飘带", "头饰", "耳饰", "颈饰", "腕饰", "腰间佩饰", "衣物状态", "首饰状态"];
const fieldCategories = {
  "古装里衣款式": "classical-inner", "古装裤装款式": "classical-trousers", "古装裙装款式": "classical-skirt", "古装鞋履": "classical-shoes",
  "耳饰": "ear-jewelry", "颈饰": "neck-jewelry", "腕饰": "wrist-jewelry", "腰间佩饰": "waist-jewelry",
};

export function sectionedDictionaryPreset(preset: Omit<CharacterDictionaryPreset, "text"> & { sections: DictionarySection[] }): CharacterDictionaryPreset {
  return { ...preset, text: preset.sections.map((section) => `${section.label}：${section.parts.join("")}`).join("\n") };
}

const base = {
  type: "配置面板" as const, domain: "局部配置", source: "iFrame 古装创作词典 · 创作参考",
  optionalFields, categories: ["clothing-panel"],
};

export const CLASSICAL_CHARACTER_PANELS: CharacterDictionaryPreset[] = [
  sectionedDictionaryPreset({
    ...base, id: "dictionary.panel.classical-footwear", title: "古装鞋履选择面板", search: "鞋履 鞋靴 鞋子 靴子 古装 云纹皂靴 翘头履 绣花鞋 footwear boots shoes",
    categories: ["footwear-panel"], defaults: { "古装鞋履": "云纹皂靴" }, sections: [CLASSICAL_FOOTWEAR_SECTION],
  }),
  sectionedDictionaryPreset({
    ...base, id: "dictionary.panel.classical-robe", title: "古装长袍搭配", search: "服装 古装 男装 男子 长袍 直裰 圆领袍",
    fieldCategories: { ...fieldCategories, "男装外衣款式": "classical-male-outer" },
    defaults: { "古装里衣款式": "素面交领里衣", "男装外衣款式": "交领长袍", "古装裤装款式": "束脚长裤", "面料": "棉布" },
    sections: [
      { label: "服装", parts: ["上身仅有里衣和外衣两件：内穿[里衣颜色][古装里衣款式]一件，外穿[外衣颜色][面料][男装外衣款式]一件。领口仅露出一道里衣领缘，袖口不叠加装饰袖。", "下穿[下装颜色][古装裤装款式]。", "衣物穿着关系清楚，不增加未指定的中衣、披风、护甲或装饰性叠领。"] },
      CLASSICAL_FOOTWEAR_SECTION, decoration, jewelry, condition,
    ],
  }),
  sectionedDictionaryPreset({
    ...base, id: "dictionary.panel.classical-skirt", title: "古装衣裙搭配", search: "服装 古装 女装 女子 衣裙 马面裙 褙子",
    fieldCategories: { ...fieldCategories, "女装上衣款式": "classical-female-upper" },
    defaults: { "古装里衣款式": "素面交领里衣", "女装上衣款式": "立领长袄", "古装裙装款式": "马面裙", "面料": "丝绸" },
    sections: [
      { label: "服装", parts: ["上身仅有里衣和外衣两件：内穿[里衣颜色][古装里衣款式]一件，外穿[外衣颜色][面料][女装上衣款式]一件。领口仅露出一道里衣领缘，袖口不叠加装饰袖。", "下搭[裙装颜色][古装裙装款式]。", "各件衣物边缘清楚，不增加未指定的中衣、披风、护甲或装饰性叠领。"] },
      CLASSICAL_FOOTWEAR_SECTION, decoration, jewelry, condition,
    ],
  }),
  sectionedDictionaryPreset({
    ...base, id: "dictionary.panel.jewelry", title: "首饰选择面板", search: "首饰 饰品 古装 男子 女子 发簪 步摇 耳饰 项链 玉镯 玉佩",
    categories: ["hair-jewelry", "body-jewelry", "ear-jewelry", "neck-jewelry", "wrist-jewelry", "waist-jewelry"], fieldCategories,
    sections: [jewelry, { label: "新旧", parts: ["首饰状态为[首饰状态]。"] }],
  }),
  sectionedDictionaryPreset({
    ...base, id: "dictionary.panel.decoration", title: "装饰选择面板", search: "装饰 古装 花纹 刺绣 流苏 纱巾 披帛 腰封",
    categories: ["pattern", "craft", "scarf", "trim"], sections: [decoration],
  }),
];
