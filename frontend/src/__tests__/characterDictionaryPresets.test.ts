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
