import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CharacterPromptDictionary from "./CharacterPromptDictionary";
import { CHARACTER_DICTIONARY_PRESETS, dictionaryConfiguration, type DictionaryConfiguration } from "@/lib/characterDictionaryPresets";

const { getPlatformReferenceLibrary } = vi.hoisted(() => ({ getPlatformReferenceLibrary: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getPlatformReferenceLibrary } }));

function setup(query: string, slot?: string, configurations?: DictionaryConfiguration[]) {
  const replaceWithText = vi.fn((text: string) => `前文 ${text} 后文`);
  const onApply = vi.fn();
  const onClose = vi.fn();
  const onConfiguration = vi.fn();
  const keyHandler = { current: null as ((event: KeyboardEvent) => boolean) | null };
  render(<CharacterPromptDictionary suggestion={{ query, slot, replaceWithText }} configurations={configurations} onApply={onApply}
    onClose={onClose} onConfiguration={onConfiguration} keyHandler={keyHandler} />);
  return { replaceWithText, onApply, onClose, onConfiguration, keyHandler };
}

it("restores valid saved choices and ignores options retired from the current panel", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const configuration = dictionaryConfiguration(CHARACTER_DICTIONARY_PRESETS.find(item => item.id === "dictionary.panel.face")!, { 肤色: "暖小麦肤色" });
  configuration.selections.肤质 = "已停用肤质";
  setup("面容", undefined, [configuration]);
  fireEvent.click(screen.getByRole("option", { name: /^面容$/ }));
  expect(screen.getByRole("combobox", { name: "肤色" })).toHaveValue("暖小麦肤色");
  expect(screen.getByRole("combobox", { name: "肤质" })).toHaveValue("");
  expect(configuration.selections.肤质).toBe("已停用肤质");
});

it.each([
  ["dictionary.panel.classical-robe", "古装鞋履"],
  ["dictionary.panel.classical-footwear", "古装外套"],
] as const)("inherits shared footwear selections from %s when opening a different panel", (sourceId, targetLabel) => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const source = CHARACTER_DICTIONARY_PRESETS.find(item => item.id === sourceId)!;
  setup("", undefined, [dictionaryConfiguration(source, { 古装鞋履: "翘头履" })]);
  fireEvent.click(screen.getByRole("option", { name: targetLabel }));
  expect(screen.getByRole("combobox", { name: "古装鞋履" })).toHaveValue("翘头履");
  expect(screen.getByText(/初始选项来源：/)).toBeInTheDocument();
});

it('keeps face shape, forehead, cheekbones and jaw independent through apply', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { onApply, onConfiguration } = setup('面容');
  fireEvent.click(screen.getByRole('option', { name: /^面容$/ }));
  const choose = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
  choose('脸型', '圆脸');
  choose('额头', '额头饱满');
  choose('颧骨', '颧骨略宽');
  choose('下颌', '下颌轮廓分明');
  choose('下巴', '下巴圆润');
  choose('颧骨', '颧骨平缓');
  expect(screen.getByRole('combobox', { name: '脸型' })).toHaveValue('圆脸');
  expect(screen.getByRole('combobox', { name: '额头' })).toHaveValue('额头饱满');
  expect(screen.getByRole('textbox', { name: '将插入的完整文字' })).toHaveValue('脸型：圆脸\n额头：额头饱满\n颧骨：颧骨平缓\n下颌：下颌轮廓分明\n下巴：下巴圆润');
  fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
  expect(onApply.mock.calls[0][1].structuredFields.identity).toEqual({
    face_shape: '圆脸', forehead: '额头饱满', cheekbones: '颧骨平缓', jaw: '下颌轮廓分明', chin: '下巴圆润',
  });
  expect(onConfiguration.mock.calls[0][0].selections).toMatchObject({ '脸型': '圆脸', '额头': '额头饱满', '颧骨': '颧骨平缓' });
});

it("starts with categories and lets creators compare face shapes without changing the Prompt", async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("");
  expect(screen.queryByRole("option", { name: /选项 · 圆脸/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "词典" }));
  fireEvent.click(screen.getByRole("option", { name: /^面部\s/ }));
  fireEvent.click(screen.getByRole("option", { name: /^脸型/ }));
  expect(screen.getByRole("option", { name: /选项 · 圆脸/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /选项 · 方脸/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /杏眼/ })).not.toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
});

it("keeps same-name material terms distinct by usage part and description", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('丝绸');
  const matches = screen.getAllByRole('option', { name: /选项 · 丝绸/ });
  expect(matches).toHaveLength(2);
  expect(matches.some(option => option.textContent?.includes('服装') && option.textContent?.includes('面料'))).toBe(true);
  expect(matches.some(option => option.textContent?.includes('鞋履') && option.textContent?.includes('材质'))).toBe(true);
});

it("separates rendering style from genre and inserts a complete style without assigning identity or clothing", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("");
  fireEvent.click(screen.getByRole("tab", { name: "词典" }));
  fireEvent.click(screen.getByRole("option", { name: /^表现风格/ }));
  fireEvent.click(screen.getByRole("option", { name: /^写实与绘画风格/ }));
  expect(screen.queryByRole("option", { name: /古装 \/ 武侠/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 二次元国漫 / }));
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("二维手绘线条清晰");
  expect(text).not.toMatch(/侠客|里衣|少女|裙子/);
  fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("uses one template entry with the existing outfit selection panel and a complete character Prompt", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("古装");
  expect(screen.queryByRole("button", { name: "服装方案" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /Prompt 模板 · 素雅长衫便服/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "外衣颜色" }), { target: { value: "月白色" } });
  fireEvent.change(screen.getByRole("combobox", { name: "鞋靴" }), { target: { value: "深棕色素面皮靴" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("写实真人");
  expect(text).toContain("一位成年");
  expect(text).toContain("月白色哑光棉麻素面交领长衫");
  expect(text).toContain("脚穿深棕色素面皮靴");
  expect(text).not.toMatch(/靛蓝色|黑色素面布靴|\{\w+\}/);
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用此模板" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("fills a Skill color slot with just the color rather than a full sentence", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "颜色");
  expect(screen.getByText("填写 [颜色]")).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /连衣裙/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 靛蓝色 / }));
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("靛蓝色");
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("靛蓝色");
});

it("configures a full classical template in the panel and optionally keeps slots for later", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("古装 ");
  expect(screen.getByRole("tab", { name: "Prompt 模板" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: /Prompt 模板 · 明风长袄马面裙/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /选项 ·/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /Prompt 模板 · 写实真人古装/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "外衣颜色" }), { target: { value: "[外衣颜色]" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("[外衣颜色]");
  expect(screen.getByRole("combobox", { name: "外衣面料" })).toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用此模板" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("offers the containing category for an exact search so other options can be compared", async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("圆脸");
  expect(screen.getByRole("option", { name: /选项 · 圆脸/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /浏览 面部 › 脸型/ }));
  expect(screen.getByRole("option", { name: /选项 · 方脸/ })).toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 方脸/ }));
  fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
  expect(replaceWithText).toHaveBeenCalledWith("方脸");
});

it("keeps body build and posture separate and supports going back through categories with Escape", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { keyHandler, replaceWithText, onClose } = setup("");
  fireEvent.click(screen.getByRole("tab", { name: "词典" }));
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "ArrowDown" })); });
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Enter" })); });
  fireEvent.click(screen.getByRole("option", { name: /^体型与比例/ }));
  expect(screen.getByRole("option", { name: /匀称体型/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /站姿略松弛/ })).not.toBeInTheDocument();
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Escape" })); });
  fireEvent.click(screen.getByRole("option", { name: /^体态/ }));
  expect(screen.getByRole("option", { name: /站姿略松弛/ })).toBeInTheDocument();
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Escape" })); });
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(screen.getByRole("option", { name: /^面部\s/ })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(replaceWithText).not.toHaveBeenCalled();
});

it("finds dedicated eye-area detail through the eye-wrinkle category alias", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("眼纹");
  expect(screen.getByRole("option", { name: /选项 · 静态眼角细纹/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /眼周与嘴角有自然细纹/ })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /浏览 面部 › 眼周细节/ })).toBeInTheDocument();
});

it("switches between dictionary and Skill using the keyboard without mixing their results", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("");
  const dictionary = screen.getByRole("tab", { name: "词典" });
  fireEvent.click(dictionary);
  fireEvent.keyDown(dictionary, { key: "ArrowRight" });
  const skill = screen.getByRole("tab", { name: "Prompt 模板" });
  expect(skill).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toBe(skill);
  expect(screen.queryByRole("option", { name: /^面部\s/ })).not.toBeInTheDocument();
  fireEvent.keyDown(skill, { key: "ArrowLeft" });
  expect(dictionary).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: /^面部\s/ })).toBeInTheDocument();
});

it("excludes combined patterns from discovery even when all members are available", async () => {
  const term = (id: string, content: string, status = "active") => ({
    platform_resource_id: id, revision: 1, kind: "prompt_preset", title: id, status,
    category_path: "character/performance", dictionary: { semantic_domain: "character.performance", entry_type: "term" },
    payload: { structured_prompt: { content } }, provenance: { license: "MIT" },
  });
  const pattern = (id: string, revision: number) => ({
    platform_resource_id: id, revision: 1, kind: "prompt_preset", title: `咏春${id}`, status: "active",
    category_path: "character/performance", dictionary: { semantic_domain: "character.performance", entry_type: "pattern",
      members: [{ platform_resource_id: "起势", revision, role: "start" }, { platform_resource_id: "收势", revision: 1, role: "end" }] },
    payload: {}, provenance: { license: "MIT" },
  });
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [term("起势", "双拳抬起"), term("收势", "重心回收"),
    term("咏春待审核", "候选文字", "candidate"), pattern("组合", 1), pattern("失效组合", 2)] });
  setup("咏春");
  await waitFor(() => expect(getPlatformReferenceLibrary).toHaveBeenCalled());
  expect(screen.queryByRole("option", { name: /咏春组合|失效组合|待审核/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "组合方案" })).not.toBeInTheDocument();
});

it("keeps local terms available on catalog failure and retries the platform catalog", async () => {
  getPlatformReferenceLibrary.mockRejectedValueOnce(new Error("offline"));
  setup("长发高束");
  expect(await screen.findByText(/平台词典读取失败/)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /长发高束/ })).toBeInTheDocument();
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByText(/平台词典读取失败/)).not.toBeInTheDocument());
});

it("uses arrow keys, Enter and Escape without applying during preview or composition", async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { keyHandler, replaceWithText, onClose } = setup("长发高束");
  await screen.findByRole("option", { name: /长发高束/ });
  expect(keyHandler.current!(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(false);
  // The editor delegates keyboard events to the open panel's handler.
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "ArrowDown" })); keyHandler.current!(new KeyboardEvent("keydown", { key: "Enter" })); });
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(screen.queryByRole("textbox", { name: "将插入的完整文字" })).not.toBeInTheDocument();
  act(() => { keyHandler.current!(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(onClose).toHaveBeenCalled();
  expect(replaceWithText).not.toHaveBeenCalled();
});

it("configures clothing direction, textile, pattern and scarf before applying", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("服装");
  expect(screen.getByRole("tab", { name: "基础面板" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: /^现代女装$/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /^古装衣裙$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "面料" }), { target: { value: "丝绸" } });
  fireEvent.change(screen.getByRole("combobox", { name: "花纹" }), { target: { value: "祥云暗纹" } });
  fireEvent.change(screen.getByRole("combobox", { name: "纱巾披帛" }), { target: { value: "素色披帛" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("丝绸立领长袄");
  expect(text).toContain("马面裙");
  expect(text).toContain("祥云暗纹");
  expect(text).toContain("素色披帛");
  expect(text).not.toMatch(/\[|写实真人|成年/);
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("groups 60 expressions and keeps the role design interface static", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("表情");
  fireEvent.click(screen.getByRole("option", { name: /^表情$/ }));
  const select = screen.getByRole("combobox", { name: "表情" });
  expect(select.querySelectorAll("optgroup")).toHaveLength(6);
  expect(select.querySelectorAll("optgroup option")).toHaveLength(60);
  fireEvent.change(select, { target: { value: "被背叛的怒" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("目光冰冷");
  expect(text).not.toMatch(/先震惊后|被背叛的怒/);
  expect(screen.queryByText("动态表演参考（不随图片表情插入）")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("browses expression groups independently of facial identity", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("");
  fireEvent.click(screen.getByRole("tab", { name: "词典" }));
  fireEvent.click(screen.getByRole("option", { name: /^表情 / }));
  expect(screen.getByRole("option", { name: /^基础表情/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /^复杂情绪与转折/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /^悲伤与崩溃/ }));
  expect(screen.getByRole("option", { name: /选项 · 无声落泪/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /选项 · 圆脸/ })).not.toBeInTheDocument();
});


it("fills an expression slot with static text and hides configuration panels", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "表情");
  expect(screen.queryByRole("option", { name: /配置面板/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /^基础表情/ }));
  fireEvent.click(screen.getByRole("option", { name: /选项 · 平静克制/ }));
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("眼神稳定，眉头放松，嘴唇自然闭合，脸上没有明显笑意。");
});


it("selects multiple ancient jewelry pieces independently and omits cleared sections", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("首饰");
  fireEvent.click(screen.getByRole("option", { name: /^首饰$/ }));
  const apply = screen.getByRole("button", { name: "应用配置" });
  expect(apply).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "头饰" }), { target: { value: "束发玉冠" } });
  fireEvent.change(screen.getByRole("combobox", { name: "耳饰" }), { target: { value: "珍珠耳饰" } });
  fireEvent.change(screen.getByRole("combobox", { name: "腕饰" }), { target: { value: "玉镯" } });
  const preview = screen.getByRole("textbox", { name: "将插入的完整文字" });
  expect(preview).toHaveValue("首饰：头饰为束发玉冠。耳饰为珍珠耳饰。腕饰为玉镯。");
  fireEvent.change(screen.getByRole("combobox", { name: "头饰" }), { target: { value: "" } });
  expect(preview).toHaveValue("首饰：耳饰为珍珠耳饰。腕饰为玉镯。");
  expect(screen.getByRole("combobox", { name: "头饰" })).toHaveValue("");
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(apply);
  expect(replaceWithText).toHaveBeenCalledWith("首饰：耳饰为珍珠耳饰。腕饰为玉镯。");
});

it("opens footwear schemes and clears the previous scheme's detail overrides when switching", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("鞋履");
  fireEvent.click(screen.getByRole("option", { name: /^古装鞋履$/ }));
  expect(screen.getByRole("combobox", { name: "鞋履材质" })).toHaveValue("缎面");
  fireEvent.change(screen.getByRole("combobox", { name: "古装鞋履" }), { target: { value: "锦缎翘头靴" } });
  expect(screen.getByRole("combobox", { name: "鞋履材质" })).toHaveValue("锦缎");
  fireEvent.change(screen.getByRole("combobox", { name: "鞋履材质" }), { target: { value: "真皮" } });
  fireEvent.change(screen.getByRole("combobox", { name: "鞋头形状" }), { target: { value: "方头" } });
  const preview = screen.getByRole("textbox", { name: "将插入的完整文字" });
  expect((preview as HTMLTextAreaElement).value).toContain("真皮");
  expect((preview as HTMLTextAreaElement).value).not.toMatch(/锦缎|翘头/);
  fireEvent.change(screen.getByRole("combobox", { name: "古装鞋履" }), { target: { value: "毛边雪地靴" } });
  expect(screen.getByRole("combobox", { name: "鞋履材质" })).toHaveValue("厚皮革");
  expect(screen.getByRole("combobox", { name: "鞋头形状" })).toHaveValue("");
  expect((preview as HTMLTextAreaElement).value).toContain("白色毛边");
  expect((preview as HTMLTextAreaElement).value).toContain("保暖毡衬");
  expect((preview as HTMLTextAreaElement).value).not.toMatch(/锦缎|金丝|方头|真皮/);
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith((preview as HTMLTextAreaElement).value);
});

it("keeps footwear material separate from garment material in outfit configuration", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("服装");
  fireEvent.click(screen.getByRole("option", { name: /^古装衣裙$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "古装鞋履" }), { target: { value: "云纹皂靴" } });
  expect(screen.getByRole("combobox", { name: "面料" })).toHaveValue("丝绸");
  expect(screen.getByRole("combobox", { name: "鞋履材质" })).toHaveValue("缎面");
  fireEvent.change(screen.getByRole("combobox", { name: "鞋履材质" }), { target: { value: "真皮" } });
  expect(screen.getByRole("combobox", { name: "面料" })).toHaveValue("丝绸");
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("丝绸立领长袄");
  expect(text).toMatch(/\n鞋履：.*真皮/);
});

it("searches the supplied English footwear terms without matching unrelated material options", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("genuine leather");
  expect(screen.getByRole("option", { name: /选项 · 真皮/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /选项 · 丝绸/ })).not.toBeInTheDocument();
});


it("opens skin configuration from slash and inserts the selected tone without assigning texture", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("肤色");
  fireEvent.click(screen.getByRole("option", { name: /^肤色与肤质$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "肤色" }), { target: { value: "暖小麦肤色" } });
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("肤色：暖小麦肤色");
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith("肤色：暖小麦肤色");
});

it("previews and applies optional face eye texture and skin details", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("面容");
  fireEvent.click(screen.getByRole("option", { name: /^面容$/ }));
  for (const label of ["眼周纹理", "肤色", "肤质"]) expect(screen.getByRole("combobox", { name: label })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("");
  fireEvent.change(screen.getByRole("combobox", { name: "眼周纹理" }), { target: { value: "仅微笑时出现眼角纹" } });
  fireEvent.change(screen.getByRole("combobox", { name: "肤色" }), { target: { value: "暖小麦肤色" } });
  fireEvent.change(screen.getByRole("combobox", { name: "肤质" }), { target: { value: "细腻自然肤质" } });
  const expected = "眼周细节：眼角细纹仅在微笑时出现，表情放松时不明显\n肤色：暖小麦肤色\n肤质：皮肤纹理细腻自然，保留细微起伏，不过度磨皮";
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue(expected);
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith(expected);
});

it("fills eye texture slots with descriptions preserving smile-only constraints", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "眼周纹理");
  expect(screen.queryByRole("option", { name: /选项 · 暖小麦肤色|配置面板/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 仅微笑时出现眼角纹/ }));
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("眼角细纹仅在微笑时出现，表情放松时不明显");
});

it("fills skin tone slots with tone vocabulary only", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "肤色");
  expect(screen.queryByRole("option", { name: /靛蓝色|配置面板/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 古铜肤色/ }));
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("古铜肤色");
});


it("configures modern menswear from slash with independent upper, trousers and footwear", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("男装");
  fireEvent.click(screen.getByRole("option", { name: /^现代男装$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "男装上衣款式" }), { target: { value: "商务衬衫" } });
  fireEvent.change(screen.getByRole("combobox", { name: "男装裤装款式" }), { target: { value: "直筒西裤" } });
  fireEvent.change(screen.getByRole("combobox", { name: "男装鞋履" }), { target: { value: "德比皮鞋" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("米白色商务衬衫");
  expect(text).toContain("深灰色直筒西裤");
  expect(text).not.toMatch(/连衣裙|外穿/);
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("previews and applies a complete modern male template", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("现代");
  fireEvent.click(screen.getByRole("option", { name: /Prompt 模板 · 写实现代男装展示/ }));
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("成年男装模特");
  expect(text).toContain("真实摄影质感");
  expect(text).not.toMatch(/连衣裙|\[/);
  fireEvent.click(screen.getByRole("button", { name: "使用此模板" }));
  expect(replaceWithText).toHaveBeenCalledWith(text);
});

it("fills a male garment slot with a menswear combination", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "男装款式");
  expect(screen.queryByRole("option", { name: /连衣裙/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 商务西装套装/ }));
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("商务西装套装");
});


it("opens height configuration and defers a height slot without body-build vocabulary", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("身高");
  fireEvent.click(screen.getByRole("option", { name: /^基础特征$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "身高" }), { target: { value: "身高约180厘米" } });
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("身高：身高约180厘米。");
  fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
  expect(replaceWithText).toHaveBeenCalledWith("身高：身高约180厘米。");
});

it("fills a height slot with just the selected height", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("", "身高");
  expect(screen.queryByRole("option", { name: /自然站立|圆脸|配置面板/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /选项 · 身高偏高/ }));
  fireEvent.click(screen.getByRole("button", { name: "填写当前槽位" }));
  expect(replaceWithText).toHaveBeenCalledWith("身高偏高");
});

it('separates quick panels, vocabulary and complete templates', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['基础面板', '词典', 'Prompt 模板']);
  for (const name of ['全部', '配置面板', '词条', '组合方案', 'Prompt 案例', 'Skill']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Prompt 模板' }));
  for (const name of ['角色设计', '风格写真', '换装写真', '电商主图', 'UGC']) {
    expect(screen.getByRole('option', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
  }
});

it('combines task, topic and rendering filters without exposing term results', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  fireEvent.click(screen.getByRole('tab', { name: 'Prompt 模板' }));
  fireEvent.click(screen.getByRole('option', { name: /^角色设计/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '模板题材' }), { target: { value: '古装' } });
  fireEvent.change(screen.getByRole('combobox', { name: '模板画风' }), { target: { value: '动漫' } });
  expect(screen.getByRole('option', { name: /Prompt 模板 · 二次元国漫古装/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Prompt 模板 · 写实真人古装/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /选项 ·/ })).not.toBeInTheDocument();
});

it('explains empty task categories and allows returning to task selection', async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  fireEvent.click(screen.getByRole('tab', { name: 'Prompt 模板' }));
  fireEvent.click(screen.getByRole('option', { name: /^UGC/ }));
  expect(await screen.findByText(/当前分类暂无可用模板/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回任务分类' }));
  expect(screen.getByRole('option', { name: /^电商主图/ })).toBeInTheDocument();
});


it('opens footwear directly from quick panels and keeps details inside its form', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  expect(screen.getByRole('tab', { name: '基础面板' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('option', { name: /^Prompt 模板/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /^身体 / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /^古装鞋履$/ }));
  expect(screen.getByRole('combobox', { name: '鞋履图案' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '鞋履装饰' })).toBeInTheDocument();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回结果' }));
  expect(screen.getByRole('option', { name: /^基础特征$/ })).toBeInTheDocument();
});

it('keeps dictionary levels free of panels and templates with short summaries', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  fireEvent.click(screen.getByRole('tab', { name: '词典' }));
  expect(screen.queryByRole('option', { name: /^Prompt 模板/ })).not.toBeInTheDocument();
  for (const option of screen.getAllByRole('option')) expect(option.textContent!.length).toBeLessThan(55);
  fireEvent.click(screen.getByRole('option', { name: /^身体 / }));
  expect(screen.getByRole('option', { name: /^身高 / })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /选择面板|配置面板|Prompt 模板/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /^身高 / }));
  expect(screen.getByRole('option', { name: /选项 · 身高偏高/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /选择面板|配置面板|Prompt 模板/ })).not.toBeInTheDocument();
});

it('shows compact module buttons and keeps close beside the tabs', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { onClose } = setup('');
  const options = screen.getAllByRole('option');
  expect(options.slice(0, 6).map(option => option.textContent)).toEqual([
    '基础特征', '面容', '肤色与肤质', '发型', '体态', '古装外套',
  ]);
  for (const group of ['基础身份', '面容与身体', '服装搭配', '服饰细节', '表演']) {
    expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
  }
  expect(options.every(option => option.children.length === 1)).toBe(true);
  expect(screen.queryByText('选择配置面板，调整后预览并应用。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'AI 完善角色设计' })).not.toBeInTheDocument();
  const close = screen.getByRole('button', { name: '关闭面板' });
  expect(close.parentElement).toBe(screen.getByRole('tablist').parentElement);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledOnce();
});

it('searches modules locally and only inserts the preview after confirmation', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText, onApply } = setup('');
  const search = screen.getByRole('searchbox', { name: '搜索面板、词典或模板' });
  fireEvent.change(search, { target: { value: '配饰' } });
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['配饰']);
  expect(replaceWithText).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getAllByRole('option').length).toBeGreaterThan(6);
  fireEvent.change(search, { target: { value: '古装鞋履' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  const preview = screen.getByRole('textbox', { name: '将插入的完整文字' });
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
  expect(replaceWithText).toHaveBeenCalledWith((preview as HTMLTextAreaElement).value);
  expect(onApply).toHaveBeenCalledWith(expect.stringContaining('前文 '), expect.objectContaining({ type: '配置面板' }));
});


it("filters expression templates and applies editable performance with a structured configuration", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const onApply = vi.fn();
  const onConfiguration = vi.fn();
  render(<CharacterPromptDictionary suggestion={{ query: "", replaceWithText: text => text }} onApply={onApply}
    onClose={vi.fn()} onConfiguration={onConfiguration} keyHandler={{ current: null }} />);
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
  fireEvent.click(screen.getByRole("option", { name: /^角色设计/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "角色模板类型" }), { target: { value: "expression" } });
  fireEvent.change(screen.getByRole("combobox", { name: "模板题材" }), { target: { value: "现代" } });
  fireEvent.change(screen.getByRole("combobox", { name: "模板画风" }), { target: { value: "真人写实" } });
  expect(screen.queryByRole("option", { name: /Prompt 模板 · 写实真人古装/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /Prompt 模板 · 角色表情 · 含泪强忍/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "嘴部表现" }), { target: { value: "嘴唇微张" } });
  fireEvent.change(screen.getByRole("combobox", { name: "面部气色" }), { target: { value: "" } });
  const text = (screen.getByRole("textbox", { name: "将插入的完整文字" }) as HTMLTextAreaElement).value;
  expect(text).toContain("嘴部表现：嘴唇微微张开。");
  expect(text).not.toMatch(/面部气色|秒|随后|背景|肤质/);
  fireEvent.click(screen.getByRole("button", { name: "使用此模板" }));
  expect(onApply).toHaveBeenCalledWith(text, expect.objectContaining({ structuredFields: undefined }));
  expect(onConfiguration).toHaveBeenCalledWith(expect.objectContaining({
    preset_id: "dictionary.template.expression.held-tears",
    resolved_fields: expect.objectContaining({ 嘴部表现: "嘴唇微微张开" }), rendered_text: text,
  }));
});
it("keeps full role templates available independently", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("");
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
  fireEvent.click(screen.getByRole("option", { name: /^角色设计/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "角色模板类型" }), { target: { value: "design" } });
  expect(screen.getByRole("option", { name: /Prompt 模板 · 写实真人古装/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Prompt 模板 · 角色表情/ })).not.toBeInTheDocument();
});


it('configures gender, age and height together while omitting cleared fields', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup('性别');
  fireEvent.click(screen.getByRole('option', { name: /^基础特征$/ }));
  expect(screen.getByRole('textbox', { name: '将插入的完整文字' })).toHaveValue('');
  fireEvent.change(screen.getByRole('combobox', { name: '性别' }), { target: { value: '女性' } });
  fireEvent.change(screen.getByRole('combobox', { name: '年龄阶段' }), { target: { value: '婴儿' } });
  expect(screen.getByRole('textbox', { name: '将插入的完整文字' })).toHaveValue('性别：人物性别为女性。\n年龄：人物年龄阶段为婴儿。');
  fireEvent.change(screen.getByRole('combobox', { name: '性别' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
  expect(replaceWithText).toHaveBeenCalledWith('年龄：人物年龄阶段为婴儿。');
});

it('browses all 45 upstream styles and inserts edited text only after confirmation', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText, onApply } = setup('');
  fireEvent.click(screen.getByRole('tab', { name: 'Prompt 模板' }));
  fireEvent.click(screen.getByRole('option', { name: /^视觉风格/ }));
  expect(screen.getAllByRole('option').filter(node => node.getAttribute('aria-label')?.startsWith('Prompt 模板 ·'))).toHaveLength(45);
  fireEvent.change(screen.getByRole('combobox', { name: '来源模板分类' }), { target: { value: '古装' } });
  expect(screen.getAllByRole('option').filter(node => node.getAttribute('aria-label')?.startsWith('Prompt 模板 ·'))).toHaveLength(3);
  fireEvent.click(screen.getByRole('option', { name: /Prompt 模板 · 武侠江湖/ }));
  const preview = screen.getByRole('textbox', { name: '将插入的完整文字' });
  expect(preview).not.toHaveAttribute('readonly');
  fireEvent.change(preview, { target: { value: '用户修改后的写实风格' } });
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '使用此模板' }));
  expect(replaceWithText).toHaveBeenCalledWith('用户修改后的写实风格');
  expect(onApply.mock.calls[0][1].structuredFields).toBeUndefined();
});

it('keeps motion and contact sheets in separate tasks and resets the upstream tag when returning', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup('');
  fireEvent.click(screen.getByRole('tab', { name: 'Prompt 模板' }));
  fireEvent.click(screen.getByRole('option', { name: /^运镜/ }));
  expect(screen.getAllByRole('option').filter(node => node.getAttribute('aria-label')?.startsWith('Prompt 模板 ·'))).toHaveLength(33);
  fireEvent.change(screen.getByRole('combobox', { name: '来源模板分类' }), { target: { value: '基础控制' } });
  fireEvent.click(screen.getByRole('button', { name: '返回任务分类' }));
  fireEvent.click(screen.getByRole('option', { name: /^多视图与推演/ }));
  expect(screen.getAllByRole('option').filter(node => node.getAttribute('aria-label')?.startsWith('Prompt 模板 ·'))).toHaveLength(9);
  fireEvent.click(screen.getByRole('option', { name: /Prompt 模板 · 角色脸部三视图/ }));
  expect(screen.getByText(/原模板画幅：3:2/)).toHaveTextContent('另行选择来源参考图');
});

it('uses end-of-draft insertion for templates instead of replacing text at the cursor', () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const appendWithText = vi.fn(text => `原有角色设计。\n${text}`);
  const replaceWithText = vi.fn();
  const onApply = vi.fn();
  render(<CharacterPromptDictionary suggestion={{ query: '风格', appendWithText, replaceWithText }}
    onApply={onApply} onClose={vi.fn()} keyHandler={{ current: null }} />);
  fireEvent.click(screen.getByRole('option', { name: /Prompt 模板 · 古装偶像/ }));
  fireEvent.click(screen.getByRole('button', { name: '使用此模板' }));
  expect(appendWithText).toHaveBeenCalledOnce();
  expect(replaceWithText).not.toHaveBeenCalled();
  expect(onApply.mock.calls[0][0]).toMatch(/^原有角色设计。\n古偶唯美柔光风格/);
});
