import type { CharacterDictionaryPreset, DictionarySection } from "./characterDictionaryPresets";
import { sectionedDictionaryPreset } from "./classicalCharacterPanels";

const source = "iFrame 现代男装创作词典";
const terms = (category: string, names: string[]): CharacterDictionaryPreset[] => names.map((name, index) => ({
  id: `dictionary.${category}.${index}`, title: name, text: `现代男装采用${name}，穿着关系清楚，保留自然褶皱。`,
  slotValue: name, categories: [category], domain: "造型", source, type: "词条", search: `现代 男装 男子 ${name}`,
}));

export const MODERN_MALE_TERMS = [
  ...terms("modern-male-garment", ["休闲衬衫与直筒长裤", "T恤与休闲长裤", "商务西装套装"]),
  ...terms("modern-male-upper", ["圆领T恤", "Polo衫", "牛津纺衬衫", "商务衬衫", "针织衫", "连帽卫衣"]),
  ...terms("modern-male-outer", ["单排扣西装外套", "休闲夹克", "牛仔夹克", "风衣", "羊毛大衣", "羽绒服"]),
  ...terms("modern-male-bottoms", ["直筒西裤", "休闲长裤", "直筒牛仔裤", "工装长裤", "运动长裤", "休闲短裤"]),
  ...terms("modern-male-shoes", ["简洁运动鞋", "德比皮鞋", "乐福鞋", "帆布鞋", "切尔西短靴"]),
];

const clothing: DictionarySection = { label: "服装", parts: [
  "上身穿[上衣颜色][男装上衣款式]。", "外穿[外套颜色][男装外套款式]。", "下穿[裤装颜色][男装裤装款式]。",
  "上衣面料为[上衣面料]。", "裤装面料为[裤装面料]。",
  "整体版型为[版型]。", "搭配要求为[搭配单品]。", "衣物状态为[衣物状态]。",
] };
const footwear: DictionarySection = { label: "鞋履", parts: ["脚穿[男装鞋履]。"] };
const optionalFields = ["男装外套款式", "上衣面料", "裤装面料", "版型", "搭配单品", "衣物状态", "男装鞋履"];
const defaults = { "男装上衣款式": "牛津纺衬衫", "上衣颜色": "米白色", "男装裤装款式": "休闲长裤", "裤装颜色": "深灰色", "外套颜色": "深灰色" };

export const MODERN_MALE_PANEL = sectionedDictionaryPreset({
  id: "dictionary.panel.modern-male-clothing", title: "现代男装搭配", type: "配置面板", domain: "局部配置", source,
  categories: ["clothing-panel", "modern-male-garment"], search: "现代 男装 男子 服装 上衣 外套 裤装 鞋履",
  defaults, optionalFields, sections: [clothing, footwear],
});

export const MODERN_MALE_TEMPLATE = sectionedDictionaryPreset({
  id: "dictionary.template.modern-male-fashion", title: "写实现代男装展示", type: "Prompt 模板", domain: "完整 Prompt", source,
  categories: ["modern-template"], search: "现代 男装 男子 电商 模特 写实 真人 完整 prompt 模板",
  defaults, optionalFields, sections: [
    { label: "角色身份", parts: ["成年男装模特。"] }, clothing, footwear,
    { label: "构图与背景", parts: ["浅色棚拍背景，人物自然站立，主体居中，全身服装完整可见，手和道具不遮挡服装。"] },
    { label: "表现风格", parts: ["真实摄影质感，柔和光线，人体比例自然，皮肤保留自然纹理。服装接缝、袖口、腰线、裤线和面料纹理清楚，无随机品牌标识、水印或乱码文字。"] },
  ],
});
