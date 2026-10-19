import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CharacterPromptDictionary from "./CharacterPromptDictionary";

const { getPlatformReferenceLibrary } = vi.hoisted(() => ({ getPlatformReferenceLibrary: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getPlatformReferenceLibrary } }));

function setup(query: string) {
  const replaceWithText = vi.fn((text: string) => `前文 ${text} 后文`);
  const onApply = vi.fn();
  const onClose = vi.fn();
  const keyHandler = { current: null as ((event: KeyboardEvent) => boolean) | null };
  render(<CharacterPromptDictionary suggestion={{ query, replaceWithText }} onApply={onApply}
    onClose={onClose} canRunSkill={false} keyHandler={keyHandler} />);
  return { replaceWithText, onApply, onClose, keyHandler };
}

it("starts with categories and lets creators compare face shapes without changing the Prompt", async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("");
  expect(screen.queryByRole("option", { name: /词条 · 圆脸/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /^面部/ }));
  fireEvent.click(screen.getByRole("option", { name: /^脸型/ }));
  expect(screen.getByRole("option", { name: /词条 · 圆脸/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /词条 · 方脸/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /杏眼/ })).not.toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
});

it("offers the containing category for an exact search so other options can be compared", async () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { replaceWithText } = setup("圆脸");
  expect(screen.getByRole("option", { name: /词条 · 圆脸/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /浏览 面部 › 脸型/ }));
  expect(screen.getByRole("option", { name: /词条 · 方脸/ })).toBeInTheDocument();
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: /词条 · 方脸/ }));
  fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
  expect(replaceWithText).toHaveBeenCalledWith("方脸");
});

it("keeps body build and posture separate and supports going back through categories with Escape", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  const { keyHandler, replaceWithText, onClose } = setup("");
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
  expect(screen.getByRole("option", { name: /^面部/ })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(replaceWithText).not.toHaveBeenCalled();
});

it("finds existing eye-area detail through the eye-wrinkle category alias", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("眼纹");
  expect(screen.getByRole("option", { name: /眼周与嘴角有自然细纹/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /浏览 面部 › 眼周细节/ })).toBeInTheDocument();
});

it("switches between dictionary and Skill using the keyboard without mixing their results", () => {
  getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
  setup("");
  const dictionary = screen.getByRole("tab", { name: "词典" });
  fireEvent.keyDown(dictionary, { key: "ArrowRight" });
  const skill = screen.getByRole("tab", { name: "Skill" });
  expect(skill).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toBe(skill);
  expect(screen.queryByRole("option", { name: /^面部/ })).not.toBeInTheDocument();
  fireEvent.keyDown(skill, { key: "ArrowLeft" });
  expect(dictionary).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: /^面部/ })).toBeInTheDocument();
});

it("previews fixed-version performance patterns and excludes unavailable members and unpublished terms", async () => {
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
  const { replaceWithText, onApply } = setup("咏春");
  fireEvent.click(await screen.findByRole("option", { name: /咏春组合/ }));
  expect(screen.queryByRole("option", { name: /失效组合|待审核/ })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("双拳抬起；重心回收");
  expect(replaceWithText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
  expect(replaceWithText).toHaveBeenCalledWith("双拳抬起；重心回收");
  expect(onApply).toHaveBeenCalledWith("前文 双拳抬起；重心回收 后文", expect.objectContaining({ type: "组合方案" }));
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
