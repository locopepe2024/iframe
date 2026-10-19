import { expect, it } from "vitest";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, renderDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { dictionarySlotCategory } from "@/lib/characterDictionaryCategories";

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
  expect(text.split("\n").map((line) => line.split("：")[0])).toEqual(["服装", "装饰", "首饰"]);
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
