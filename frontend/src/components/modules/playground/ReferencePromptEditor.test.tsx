import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import ReferencePromptEditor, { referencePromptDocument, type PromptSlashSuggestion } from "./ReferencePromptEditor";

describe("reference prompt restoration", () => {
  it("rebinds a selected scene reference after plain-text prompt replacement", () => {
    const reference = { asset_type: "scene", asset_id: "long-street", variant_id: "v1" } as const;
    const document = referencePromptDocument(
      "长街中段的粮铺。光影和远景和@青溪镇青石板长街保持一致",
      [{
        label: "青溪镇青石板长街 · 未命名素材 1",
        reference,
      }, {
        label: "青溪镇青石板长街",
        reference,
      }],
      true,
      true,
    );
    const token = document.content?.[0]?.content?.find((item: any) => item.type === "referenceToken") as any;
    expect(token?.attrs).toMatchObject(reference);
  });
});

it("replaces only the slash range with literal text and preserves reference tokens, suffix and undo", () => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const reference = { asset_type: "prop", asset_id: "watch", variant_id: "front" } as const;
  const onReferencesChange = vi.fn();
  const view = render(<ReferencePromptEditor value="" placeholder="Prompt" candidates={[{ label: "怀表", reference }]}
    onChange={vi.fn()} onReferencesChange={onReferencesChange} onSlashChange={(next) => { suggestion.current = next; }} />);
  const editor = (view.getByRole("textbox") as any).editor;
  act(() => {
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "referenceToken", attrs: { label: "怀表", ...reference } },
      { type: "text", text: " 前文 /发型 后文" },
    ] }] });
    editor.commands.setTextSelection(9);
  });
  expect(suggestion.current?.query).toBe("发型");
  act(() => suggestion.current!.replaceWithText("<b>高束发</b>\n自然碎发"));
  expect(editor.getText({ blockSeparator: "\n" })).toContain("@怀表 前文 <b>高束发</b>\n自然碎发 后文");
  expect(editor.getHTML()).toContain("&lt;b&gt;高束发&lt;/b&gt;");
  expect(onReferencesChange).toHaveBeenLastCalledWith([reference]);
  act(() => editor.commands.undo());
  expect(editor.getText()).toContain("/发型 后文");
});

it("does not open slash discovery for a URL", () => {
  const onSlashChange = vi.fn();
  const view = render(<ReferencePromptEditor value="" placeholder="Prompt" onChange={vi.fn()} onSlashChange={onSlashChange} />);
  const editor = (view.getByRole("textbox") as any).editor;
  act(() => editor.commands.insertContent("https://example.com/path"));
  expect(onSlashChange).toHaveBeenLastCalledWith(null);
});

it("replaces only the selected Skill placeholder occurrence, preserving references, other slots and undo", () => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const reference = { asset_type: "character", asset_id: "model", variant_id: "front" } as const;
  const onReferencesChange = vi.fn();
  const view = render(<ReferencePromptEditor value="" placeholder="Prompt" onChange={vi.fn()}
    onReferencesChange={onReferencesChange} onSlashChange={(next) => { suggestion.current = next; }} />);
  const editor = (view.getByRole("textbox") as any).editor;
  act(() => {
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "referenceToken", attrs: { label: "模特", ...reference } },
      { type: "text", text: " 外衣[颜色]，下装[颜色]，面料[面料]。" },
    ] }] });
    editor.commands.setTextSelection(13);
  });
  expect(suggestion.current?.slot).toBe("颜色");
  act(() => suggestion.current!.replaceWithText("靛蓝色"));
  expect(editor.getText()).toBe("@模特 外衣[颜色]，下装靛蓝色，面料[面料]。");
  expect(onReferencesChange).toHaveBeenLastCalledWith([reference]);
  act(() => editor.commands.undo());
  expect(editor.getText()).toBe("@模特 外衣[颜色]，下装[颜色]，面料[面料]。");
});

it("does not replace a stale placeholder after the template has been removed", () => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const view = render(<ReferencePromptEditor value="" placeholder="Prompt" onChange={vi.fn()}
    onSlashChange={(next) => { suggestion.current = next; }} />);
  const editor = (view.getByRole("textbox") as any).editor;
  act(() => { editor.commands.insertContent("颜色[颜色]"); editor.commands.setTextSelection(5); });
  const stale = suggestion.current!;
  act(() => editor.commands.clearContent());
  act(() => stale.replaceWithText("黑色"));
  expect(editor.getText()).toBe("");
});
