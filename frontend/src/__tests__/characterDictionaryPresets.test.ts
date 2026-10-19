import { expect, it } from "vitest";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, renderDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { CLASSICAL_FOOTWEAR_STYLES } from "@/lib/classicalFootwearDictionary";
import { dictionarySlotCategory, localDictionaryCategories } from "@/lib/characterDictionaryCategories";

it("routes clothing shapes, materials, ornament and condition to distinct fields", () => {
  const category = (label: string) => dictionarySlotCategory(label);
  expect(category("裙装款式")).toBe("bottoms");
  expect(category("裙装颜色")).toBe("palette");
  expect(category("面料")).toBe("material");
  expect(category("花纹")).toBe("pattern");
  expect(category("刺绣工艺")).toBe("craft");
  expect(category("纱巾披帛")).toBe("scarf");
  expect(category("首饰材质")).toBe("jewelry-material");
  expect(category("首饰状态")).toBe("jewelry-condition");
  expect(category("衣物状态")).toBe("garment-condition");
});

it("renders every built-in template/panel with usable field choices and no unresolved defaults", () => {
  for (const preset of CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.type !== "词条")) {
    const fields = dictionaryPresetFields(preset);
    expect(fields.length, preset.id).toBeGreaterThan(0);
    for (const field of fields) expect(field.options, `${preset.id}: ${field.label}`).toContain(field.value);
    expect(renderDictionaryPreset(preset), preset.id).not.toMatch(/\[[^\]]+\]|\{\w+\}/);
    for (const [label, value] of Object.entries(preset.defaults || {})) {
      expect(fields.find((field) => field.label === label)?.value, `${preset.id}: ${label}`).toBe(value);
    }
  }
});

it("keeps multi-gauze layering opt-in and expressions separate from identity", () => {
  const templates = CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.type === "Prompt 模板");
  for (const preset of templates.filter((entry) => !entry.id.endsWith("xianxia"))) {
    expect(renderDictionaryPreset(preset)).not.toMatch(/两层轻纱|多层轻纱/);
  }
  const expressions = CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.motionText);
  expect(expressions).toHaveLength(60);
  expect(new Set(expressions.map((entry) => entry.title)).size).toBe(60);
  for (const entry of expressions) {
    expect(entry.categories.every((category) => category.startsWith("expression-"))).toBe(true);
    expect(entry.slotValue).toBe(entry.text);
  }
});

it("offers distinct classical men's and women's garments with optional decoration and jewelry lines", () => {
  const male = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-robe")!;
  const female = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-skirt")!;
  const maleFields = dictionaryPresetFields(male);
  const femaleFields = dictionaryPresetFields(female);
  expect(maleFields.find((field) => field.label === "男装外衣款式")?.options).toContain("圆领袍");
  expect(maleFields.find((field) => field.label === "男装外衣款式")?.options).not.toContain("立领长袄");
  expect(femaleFields.find((field) => field.label === "古装裙装款式")?.options).toContain("马面裙");
  expect(femaleFields.find((field) => field.label === "古装裙装款式")?.options).not.toContain("束脚长裤");
  const text = renderDictionaryPreset(female, { "花纹": "牡丹纹", "刺绣工艺": "金线刺绣", "头饰": "流苏步摇", "耳饰": "珍珠耳饰", "腕饰": "玉镯", "腰间佩饰": "玉佩" });
  expect(text.split("\n").map((line) => line.split("：")[0])).toEqual(["服装", "鞋履", "装饰", "首饰"]);
  expect(text).toContain("上身仅有里衣和外衣两件");
  expect(text).toContain("牡丹纹");
  expect(text).toContain("流苏步摇");
  expect(text).toContain("珍珠耳饰");
  expect(text).toContain("玉镯");
  expect(text).toContain("玉佩");
  const plain = renderDictionaryPreset(female, { "花纹": "", "头饰": "", "耳饰": "" });
  expect(plain).toMatch(/^服装：/);
  expect(plain).not.toMatch(/装饰：|首饰：|新旧：|不指定|\[|undefined/);
});


it("preserves garment direction when a field is deferred to a bracket slot", () => {
  expect(dictionarySlotCategory("男装外衣款式")).toBe("classical-male-outer");
  expect(dictionarySlotCategory("女装上衣款式")).toBe("classical-female-upper");
  expect(dictionarySlotCategory("古装裙装款式")).toBe("classical-skirt");
  expect(dictionarySlotCategory("古装鞋履")).toBe("classical-shoes");
  const male = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-robe")!;
  const text = renderDictionaryPreset(male, { "男装外衣款式": "[男装外衣款式]" });
  expect(text).toContain("[男装外衣款式]");
  expect(text).toContain("上身仅有里衣和外衣两件");
});

it("configures footwear independently of garments and replaces scheme defaults without stale material", () => {
  const preset = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-footwear")!;
  expect(preset).toBeDefined();
  const silk = renderDictionaryPreset(preset, { "古装鞋履": "锦缎翘头靴" });
  expect(silk).toContain("鞋履：");
  expect(silk).toContain("锦缎");
  expect(silk).toContain("金丝编织");
  const leather = renderDictionaryPreset(preset, { "古装鞋履": "锦缎翘头靴", "鞋履材质": "真皮", "鞋履工艺": "" });
  expect(leather).toContain("真皮");
  expect(leather).not.toMatch(/锦缎|金丝编织/);
  expect(dictionarySlotCategory("鞋履材质")).toBe("shoe-material");
  expect(dictionarySlotCategory("鞋履图案")).toBe("shoe-pattern");
  expect(dictionarySlotCategory("鞋头形状")).toBe("shoe-toe");
});


it("retains all supplied footwear directions and valid defaults in the shared selectors", () => {
  const panel = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-footwear")!;
  expect(CLASSICAL_FOOTWEAR_STYLES).toHaveLength(11);
  for (const style of CLASSICAL_FOOTWEAR_STYLES) {
    const values = { "古装鞋履": style.title };
    const fields = dictionaryPresetFields(panel, values);
    for (const [key, value] of Object.entries(style.defaults)) {
      expect(fields.find((field) => field.key === key)?.value, `${style.title}: ${key}`).toBe(value);
    }
    expect(renderDictionaryPreset(panel, values)).not.toMatch(/\[|undefined|不指定/);
  }
  const template = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.template.classical-live-action")!;
  const text = renderDictionaryPreset(template, { "古装鞋履": "翘头履" });
  expect(text).toMatch(/\n鞋履：.*翘头/);
  expect(text).toContain("平底");
});


it("keeps skin tone slots separate from garment colors and skin texture", () => {
  expect(dictionarySlotCategory("肤色")).toBe("skin-tone");
  expect(localDictionaryCategories("character.skin.warm-light")).toEqual(["skin-tone"]);
  expect(localDictionaryCategories("character.skin.pores")).toEqual(["skin"]);
  expect(dictionarySlotCategory("肤质")).toBe("skin");
  const panel = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.skin")!;
  const fields = dictionaryPresetFields(panel);
  expect(fields.find((field) => field.key === "肤色")?.options).toContain("暖小麦肤色");
  expect(fields.find((field) => field.key === "肤色")?.options).not.toContain("靛蓝色");
  expect(fields.find((field) => field.key === "肤质")?.options).not.toContain("暖小麦肤色");
  expect(fields.find((field) => field.key === "肤质")?.options).not.toContain("暖调浅肤色，自然肤质");
  expect(renderDictionaryPreset(panel)).toBe("");
  expect(renderDictionaryPreset(panel, { "肤色": "暖小麦肤色" })).toBe("皮肤：肤色为暖小麦肤色。");
  expect(renderDictionaryPreset(panel, { "肤色": "[肤色]" })).toContain("[肤色]");
});


it("separates modern men's garment slots and renders optional outerwear without orphaned clauses", () => {
  const male = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.modern-male-clothing")!;
  const fields = dictionaryPresetFields(male);
  expect(dictionarySlotCategory("男装款式")).toBe("modern-male-garment");
  expect(dictionarySlotCategory("女装款式")).toBe("modern-female-garment");
  expect(fields.find((field) => field.key === "男装上衣款式")?.options).toContain("商务衬衫");
  expect(fields.find((field) => field.key === "男装裤装款式")?.options).toContain("直筒西裤");
  expect(fields.find((field) => field.key === "男装裤装款式")?.options).not.toContain("连衣裙");
  expect(renderDictionaryPreset(male)).not.toMatch(/外穿|外套|鞋履|\[/);
  const text = renderDictionaryPreset(male, { "男装外套款式": "单排扣西装外套", "外套颜色": "靛蓝色", "男装裤装款式": "直筒西裤", "男装鞋履": "德比皮鞋" });
  expect(text).toContain("外穿靛蓝色单排扣西装外套");
  expect(text).toContain("下穿深灰色直筒西裤");
  expect(text).toContain("鞋履：脚穿德比皮鞋");
  const female = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.modern-clothing")!;
  expect(dictionaryPresetFields(female).find((field) => field.key === "女装款式")?.options).toContain("连衣裙");
  expect(dictionaryPresetFields(female).find((field) => field.key === "女装款式")?.options).not.toContain("商务西装套装");
});
