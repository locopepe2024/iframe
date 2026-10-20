import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import ReferencePromptEditor, { referencePromptDocument, type PromptSlashSuggestion } from "./ReferencePromptEditor";

describe("reference prompt restoration", () => {
  it("restores only explicitly saved references when candidates arrive after mounting", async () => {
    const reference = { asset_type: "scene", asset_id: "street", variant_id: "v1" } as const;
    const onReferencesChange = vi.fn();
    const props = { value: "@长街旁有@屋顶", placeholder: "Prompt", onChange: vi.fn(),
      onReferencesChange, allowImplicitMentions: false, pruneUnlistedReferences: true,
      restoreSelectedReferences: [reference] };
    const view = render(<ReferencePromptEditor {...props} candidates={[]} />);
    view.rerender(<ReferencePromptEditor {...props} candidates={[
      { label: "长街", reference },
      { label: "屋顶", reference: { ...reference, asset_id: "roof" } },
    ]} />);
    await waitFor(() => expect(onReferencesChange).toHaveBeenLastCalledWith([reference]));
    const editor = (view.getByRole("textbox") as any).editor;
    const tokens: any[] = [];
    editor.state.doc.descendants((node: any) => { if (node.type.name === "referenceToken" && node.attrs.asset_id) tokens.push(node.attrs); });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject(reference);
    expect(editor.getText()).toBe(props.value);
  });
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

it('opens the toolbar chooser without changing the draft and applies only on confirmation', () => {
  const onChange = vi.fn();
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const props = { value: '原有角色细节', placeholder: 'Prompt', candidates: [], onChange,
    onSlashChange: (next: PromptSlashSuggestion | null) => { suggestion.current = next; } };
  const view = render(<ReferencePromptEditor {...props} />);
  const editor = (view.getByRole('textbox') as any).editor;
  act(() => editor.commands.setTextSelection('原有'.length + 1));
  onChange.mockClear();
  view.rerender(<ReferencePromptEditor {...props} openSlashRequest={1} />);
  expect(editor.getText()).toBe('原有角色细节');
  expect(onChange).not.toHaveBeenCalled();
  expect(suggestion.current?.query).toBe('');
  act(() => { suggestion.current!.replaceWithText('新增细节'); });
  expect(editor.getText()).toBe('原有新增细节角色细节');
  expect(onChange).toHaveBeenCalledOnce();
});

it.each(['原有角色细节', '原有角色细节。', '原有角色细节！'])('appends toolbar templates after the whole draft with sentence separation: %s', (value) => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const props = { value, placeholder: 'Prompt', onChange: vi.fn(),
    onSlashChange: (next: PromptSlashSuggestion | null) => { suggestion.current = next; } };
  const view = render(<ReferencePromptEditor {...props} />);
  const editor = (view.getByRole('textbox') as any).editor;
  act(() => editor.commands.setTextSelection({ from: 1, to: 3 }));
  view.rerender(<ReferencePromptEditor {...props} openSlashRequest={1} />);
  act(() => suggestion.current!.appendWithText!('<b>古偶风格</b>'));
  expect(editor.getText({ blockSeparator: '\n' })).toBe(`${value}${/[。！]$/.test(value) ? '' : '。'}\n<b>古偶风格</b>`);
  expect(editor.getHTML()).toContain('&lt;b&gt;古偶风格&lt;/b&gt;');
  act(() => editor.commands.undo());
  expect(editor.getText()).toBe(value);
});

it('removes only the slash trigger and appends the template after suffix text while retaining reference nodes', () => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const reference = { asset_type: 'prop', asset_id: 'watch', variant_id: 'front' } as const;
  const onReferencesChange = vi.fn();
  const view = render(<ReferencePromptEditor value="" placeholder="Prompt" candidates={[{ label: '怀表', reference }]}
    onChange={vi.fn()} onReferencesChange={onReferencesChange} onSlashChange={next => { suggestion.current = next; }} />);
  const editor = (view.getByRole('textbox') as any).editor;
  act(() => {
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'referenceToken', attrs: { label: '怀表', ...reference } },
      { type: 'text', text: ' 前文 /风格 后文' },
    ] }] });
    editor.commands.setTextSelection(9);
  });
  const original = editor.getText();
  const current = suggestion.current!;
  act(() => current.appendWithText!('古偶唯美柔光风格'));
  expect(editor.getText({ blockSeparator: '\n' })).toBe('@怀表 前文  后文。\n古偶唯美柔光风格');
  expect(onReferencesChange).toHaveBeenLastCalledWith([reference]);
  act(() => editor.commands.undo());
  expect(editor.getText()).toBe(original);
  act(() => editor.commands.clearContent());
  act(() => current.appendWithText!('过期模板'));
  expect(editor.getText()).toBe('');
});

it('inserts a template into an empty prompt without leading punctuation or newline', () => {
  const suggestion: { current: PromptSlashSuggestion | null } = { current: null };
  const props = { value: '', placeholder: 'Prompt', onChange: vi.fn(),
    onSlashChange: (next: PromptSlashSuggestion | null) => { suggestion.current = next; } };
  const view = render(<ReferencePromptEditor {...props} />);
  const editor = (view.getByRole('textbox') as any).editor;
  view.rerender(<ReferencePromptEditor {...props} openSlashRequest={1} />);
  act(() => suggestion.current!.appendWithText!('古偶风格'));
  expect(editor.getText()).toBe('古偶风格');
});
