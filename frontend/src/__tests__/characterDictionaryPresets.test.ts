import { expect, it } from "vitest";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, renderDictionaryPreset } from "@/lib/characterDictionaryPresets";
import { CLASSICAL_FOOTWEAR_STYLES } from "@/lib/classicalFootwearDictionary";
import { dictionarySlotCategory, localDictionaryCategories } from "@/lib/characterDictionaryCategories";
import { CHARACTER_DICTIONARY_FIELDS, characterDictionaryField } from "@/lib/characterDictionaryFields";
import { characterStructuredText, normalizeCharacterFeatures, LOOK_FIELDS } from "@/lib/characterStructuredDesign";

it("uses distinct stable destinations for face shape, skin and expression fields", async () => {
  expect(new Set(CHARACTER_DICTIONARY_FIELDS.map(field => field.id)).size).toBe(CHARACTER_DICTIONARY_FIELDS.length);
  expect(new Set(CHARACTER_DICTIONARY_FIELDS.map(field => field.label)).size).toBe(CHARACTER_DICTIONARY_FIELDS.length);
  for (const field of CHARACTER_DICTIONARY_FIELDS) expect(dictionarySlotCategory(field.label)).toBe(field.category);
  expect(characterDictionaryField('下颌')?.domain).toBe('character.identity');
  expect(characterDictionaryField('下颌状态')?.domain).toBe('character.performance');
  expect(characterDictionaryField('唇形')?.dimension).toBe('稳定形状');
  expect(characterDictionaryField('唇形')?.structured).toEqual({ section: 'identity', key: 'lips' });
  expect(characterDictionaryField('嘴部表现')?.dimension).toBe('当前状态');
  const { dictionaryStructuredFields, dictionaryConfiguration } = await import('@/lib/characterDictionaryPresets');
  const face = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.face')!;
  const skin = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.skin')!;
  const values = { 肤色: '暖小麦肤色', 肤质: '轻微干燥肤质' };
  expect(dictionaryStructuredFields(face, values).identity).toMatchObject(dictionaryStructuredFields(skin, values).identity);
  expect(dictionaryConfiguration(face, values).selections.肤色).toBe(values.肤色);
  expect(dictionaryConfiguration(skin, values).resolved_fields.肤质).toBe('面颊皮肤略显干燥，保留细微干燥纹理');
  expect(dictionaryStructuredFields(face, { 唇形: '上唇略薄、下唇自然饱满' }).identity.lips).toBe('上唇略薄、下唇自然饱满');
});

it("registers every basic panel field without changing panel IDs", () => {
  const panels = CHARACTER_DICTIONARY_PRESETS.filter(entry => entry.type === '配置面板');
  expect(panels).toHaveLength(14);
  const missing = panels.flatMap(panel => dictionaryPresetFields(panel)
    .filter(field => !characterDictionaryField(field.key)).map(field => `${panel.id}:${field.key}`));
  expect(missing).toEqual([]);
});

it("keeps optional face texture precise and reuses skin choices", () => {
  const face = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.face")!;
  const skin = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.skin")!;
  const fields = dictionaryPresetFields(face);
  const options = (key: string) => fields.find((field) => field.key === key)!.options;
  expect(renderDictionaryPreset(face)).toBe("");
  expect(fields.every((field) => field.value === "")).toBe(true);
  for (const key of ["肤色", "肤质"]) expect(options(key)).toEqual(dictionaryPresetFields(skin).find((field) => field.key === key)!.options);
  expect(options("肤质")).toContain("鼻颊少量雀斑");
  expect(options("肤质")).toContain("面颊和鼻翼保留细微毛孔纹理");
  expect(options("眼周纹理")).toContain("仅微笑时出现眼角纹");
  expect(options("眼周纹理")).not.toContain("眼周与嘴角有自然细纹，肤色分布不完全均匀");
  expect(renderDictionaryPreset(face, { "肤色": "暖小麦肤色" })).toBe("肤色：暖小麦肤色");
  expect(renderDictionaryPreset(face, { "眼周纹理": "仅微笑时出现眼角纹", "肤质": "轻微干燥肤质" }))
    .toBe("眼周细节：眼角细纹仅在微笑时出现，表情放松时不明显\n肤质：面颊皮肤略显干燥，保留细微干燥纹理");
  expect(renderDictionaryPreset(face, { "眼周纹理": "静态鱼尾纹" })).toContain("表情放松时，外眼角仍可见放射状鱼尾纹");
  expect(renderDictionaryPreset(face, { "眼周纹理": "[眼周纹理]" })).toBe("眼周细节：[眼周纹理]");
  for (const label of ["眼周纹理", "眼角纹", "鱼尾纹", "下眼睑纹", "眼袋"]) expect(dictionarySlotCategory(label)).toBe("eye-detail");
  expect(localDictionaryCategories("character.facial_mark.classical-crows-feet")).toContain("eye-detail");
});

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
  expect(renderDictionaryPreset(panel, { "肤色": "暖小麦肤色" })).toBe("肤色：暖小麦肤色");
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


it("routes height independently from build, posture and skin with no forced default", () => {
  expect(dictionarySlotCategory("身高")).toBe("height");
  const panel = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.basic")!;
  expect(renderDictionaryPreset(panel)).toBe("");
  expect(renderDictionaryPreset(panel, { "身高": "身高约180厘米" })).toBe("身高：身高约180厘米。");
  expect(dictionaryPresetFields(panel).find(field => field.key === "身高")!.options).not.toContain("自然站立");
});

it("keeps garment wear and folds out of material slots", () => {
  expect(localDictionaryCategories("character.clothing_material.subtle-wear")).toEqual(["garment-condition"]);
  expect(localDictionaryCategories("character.clothing_material.natural-folds")).toEqual(["clothing-detail"]);
  const panel = CHARACTER_DICTIONARY_PRESETS.find((entry) => entry.id === "dictionary.panel.classical-robe")!;
  const fields = dictionaryPresetFields(panel);
  const wear = "衣物有轻微使用痕迹，不改变原有版型";
  expect(fields.find((field) => field.key === "面料")!.options).not.toContain(wear);
  expect(fields.find((field) => field.key === "衣物状态")!.options).toContain(wear);
  const text = renderDictionaryPreset(panel, { "面料": "棉布", "衣物状态": wear });
  expect(text).toContain("外穿靛蓝色棉布交领长袍一件");
  expect(text).toContain(`新旧：衣物状态为${wear}`);
});

it('keeps facial panel selections as independent fields rather than parsing prose', async () => {
  const { dictionaryStructuredFields } = await import('@/lib/characterDictionaryPresets');
  const face = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.face')!;
  const result = dictionaryStructuredFields(face, { '眼周纹理': '仅微笑时出现眼角纹', '肤色': '暖小麦肤色', '肤质': '轻微干燥肤质' });
  expect(result.identity).toEqual({
    eye_detail: '眼角细纹仅在微笑时出现，表情放松时不明显',
    skin_tone: '暖小麦肤色',
    skin_texture: '面颊皮肤略显干燥，保留细微干燥纹理',
  });
  expect(result.look).toEqual({});
});


it('captures complete clothing configuration independently of flattened prose', async () => {
  const { dictionaryConfiguration } = await import('@/lib/characterDictionaryPresets');
  const preset = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.fields?.some(field => field.key === 'innerColor'))!;
  const config = dictionaryConfiguration(preset, { innerColor: '米白色', outerColor: '靛蓝色' });
  expect(config.selections.innerColor).toBe('米白色');
  expect(config.resolved_fields.outerColor).toBe('靛蓝色');
  expect(config.preset_text).toBe(preset.text);
  expect(config.rendered_text).toBe(renderDictionaryPreset(preset, config.selections));
});

it('projects clothing panels into authored sections and explicit layer constraints', async () => {
  const { dictionaryStructuredFields } = await import('@/lib/characterDictionaryPresets');
  const preset = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.classical-robe')!;
  const result = dictionaryStructuredFields(preset, {});
  expect(result.look.clothing).toContain('上身仅有里衣和外衣两件');
  expect(result.look.clothing).not.toContain('鞋履：');
  expect(result.constraints?.must_keep).toContain('上身仅有里衣和外衣两件');
  expect(result.constraints?.negative_prompt).toContain('未指定的中衣、披风、护甲或装饰性叠领');
  const modern = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.modern-male-clothing')!;
  expect(dictionaryStructuredFields(modern, {}).constraints).toBeUndefined();
});

it('keeps garment and jewelry condition independent across outfit and local panels', async () => {
  const { dictionaryStructuredFields } = await import('@/lib/characterDictionaryPresets');
  const outfit = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.classical-robe')!;
  const condition = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === 'dictionary.panel.condition')!;
  const first = dictionaryStructuredFields(outfit, { 衣物状态: '整洁完好', 首饰状态: '首饰轻微旧化' });
  const second = dictionaryStructuredFields(condition, { 首饰状态: '首饰光洁' });
  const merged = { ...first.look, ...second.look };
  expect(merged.garment_condition).toBeTruthy();
  expect(merged.jewelry_condition).toBeTruthy();
  expect(merged.garment_condition).not.toBe(merged.jewelry_condition);
  expect(merged.condition).toBeUndefined();
  for (const id of ['classical-robe', 'classical-skirt', 'modern-male-clothing', 'modern-clothing']) {
    const panel = CHARACTER_DICTIONARY_PRESETS.find(entry => entry.id === `dictionary.panel.${id}`)!;
    const projected = dictionaryStructuredFields(panel, { 衣物状态: '整洁完好' });
    expect(projected.look.garment_condition, id).toBeTruthy();
    expect(projected.look.clothing, id).not.toContain('衣物状态');
  }
  const text = characterStructuredText({}, merged);
  expect(text.match(/衣物状态：/g)).toHaveLength(1);
  expect(text.match(/首饰状态：/g)).toHaveLength(1);
  const legacy = normalizeCharacterFeatures({ condition: '衣物与首饰均有使用痕迹' }, LOOK_FIELDS.map(([key]) => key));
  expect(characterStructuredText({}, legacy)).toContain('综合新旧状态（旧版）：衣物与首饰均有使用痕迹');
});

it('offers human age stages without implicit age, skin or wardrobe defaults', async () => {
  const { dictionaryStructuredFields, dictionaryConfiguration } = await import('@/lib/characterDictionaryPresets');
  const preset = CHARACTER_DICTIONARY_PRESETS.find(p => p.id === 'dictionary.panel.basic')!;
  expect(renderDictionaryPreset(preset)).toBe('');
  expect(dictionaryPresetFields(preset).find(f => f.key === '年龄阶段')!.options).toEqual(['', '婴儿', '幼儿', '儿童', '少年', '青年', '成年', '中年', '老年', '[年龄阶段]']);
  for (const stage of ['婴儿', '儿童', '中年', '老年']) {
    const values = { 年龄阶段: stage };
    expect(dictionaryStructuredFields(preset, values)).toEqual({ identity: { age: `人物年龄阶段为${stage}` }, look: {} });
    expect(renderDictionaryPreset(preset, values)).toBe(`年龄：人物年龄阶段为${stage}。`);
    expect(dictionaryConfiguration(preset, values).selections).toEqual(values);
  }
  for (const label of ['年龄', '年龄阶段', '年纪']) expect(dictionarySlotCategory(label)).toBe('age-stage');
});

it('keeps gender independent of age, appearance and wardrobe', async () => {
  const { dictionaryStructuredFields } = await import('@/lib/characterDictionaryPresets');
  const preset = CHARACTER_DICTIONARY_PRESETS.find(p => p.id === 'dictionary.panel.basic')!;
  expect(renderDictionaryPreset(preset)).toBe('');
  expect(dictionaryPresetFields(preset).find(f => f.key === '性别')!.options).toEqual(['', '男性', '女性', '[性别]']);
  expect(dictionaryStructuredFields(preset, { 性别: '女性' })).toEqual({ identity: { gender: '人物性别为女性' }, look: {} });
  expect(renderDictionaryPreset(preset, { 性别: '男性' })).toBe('性别：人物性别为男性。');
  expect(dictionarySlotCategory('性别')).toBe('gender');
});
