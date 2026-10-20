import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CharacterWorkbench, { WorkbenchPanel } from "./CharacterWorkbench";
import {
    buildCharacterImagePrompt,
    buildCharacterMotionPrompt,
    buildCharacterVideoPrompt,
    DEFAULT_CHARACTER_NEGATIVE_PROMPT,
} from "@/lib/characterPrompts";

const apiMocks = vi.hoisted(() => ({
    getAssetReferenceIndex: vi.fn(),
    getPlatformReferenceLibrary: vi.fn().mockResolvedValue({ scope: "platform_shared", schema_version: 1, catalog_revision: "test", resources: [] }),
    getCharacterAssetPack: vi.fn().mockResolvedValue({
        character_id: "character", source_scope: "project", asset_revision: 1, pack: null,
    }),
    confirmCharacterAnchor: vi.fn(),
    previewAssetImageSubmission: vi.fn((_id: string, request: any) => Promise.resolve({
        positive_prompt: request.prompt, negative_prompt: request.negative_prompt,
        selected_model_id: "test-model", aspect_ratio: "9:16",
        generation_type: request.generation_type, image_generation_mode: request.image_generation_mode,
        batch_size: request.batch_size, reference_inputs: request.reference ? [request.reference] : request.references || [],
        design_revision_at_submission: null, fingerprint: "reviewed",
    })),
    agentRequest: vi.fn((path: string, _method?: string, body?: any): Promise<any> => path === "/models"
        ? Promise.resolve({ models: [{ api_model_id: "qwen", display_name: "Qwen" }] })
        : path === "/character-design/draft/preview"
            ? Promise.resolve({ messages: { system: "返回 identity 与 look", user: JSON.stringify(body) },
                media: [], review_token: "reviewed", format_note: "JSON" })
            : Promise.resolve({ identity: { visual_notes: "深棕眼" }, look: { visual_notes: "黑色劲装" }, skill_revision: "skill-hash" })),
}));

const projectStoreMocks = vi.hoisted(() => ({
    currentProject: { id: "project-1" } as { id: string; revision?: number; characters?: any[]; scenes?: any[]; props?: any[] },
    updateProject: vi.fn(),
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock("next/dynamic", () => ({
    default: () => function DynamicComponent() { return null; },
}));
vi.mock("../common/VariantSelector", () => ({
    VariantSelector: ({ onGenerate, filmstripTitle, previewLocator }: { onGenerate?: (batchSize: number) => void; filmstripTitle?: string; previewLocator?: unknown }) => (
        <div>
            <span>{filmstripTitle}</span>
            <span data-testid="preview-locator">{JSON.stringify(previewLocator)}</span>
            <button type="button" data-testid="variant-generate" onClick={() => onGenerate?.(1)}>Generate</button>
        </div>
    ),
}));
vi.mock("../common/VideoVariantSelector", () => ({
    VideoVariantSelector: () => null,
}));
vi.mock("@/components/shared/AssetIndexPreview", () => ({ AssetIndexPreview: () => <span data-testid="asset-preview" /> }));
vi.mock("@/lib/api", () => ({ API_URL: "", api: apiMocks, agentRequest: apiMocks.agentRequest }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector(projectStoreMocks),
}));
vi.mock("@/store/toastStore", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const baseProps = {
    title: "Full body",
    isActive: true,
    onClick: vi.fn(),
    asset: { variants: [], selected_id: null },
    currentImageUrl: "/files/character.png",
    prompt: "",
    setPrompt: vi.fn(),
    onGenerate: vi.fn(),
    isGenerating: false,
    description: "Character reference",
};

it("opens dictionary content directly from slash in the Prompt and keeps preview separate from insertion", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    const editor = (document.querySelector("[contenteditable]") as any).editor;
    act(() => editor.chain().selectAll().insertContent({ type: "text", text: "前文 /长发高束" }).run());
    fireEvent.click(await screen.findByRole("option", { name: /长发高束/ }));
    expect(editor.getText()).toBe("前文 /长发高束");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    expect(editor.getText()).toBe("前文 长发高束，发际线和鬓角保留自然碎发");
    expect(screen.queryByRole("dialog", { name: "基础面板、词典和 Prompt 模板" })).not.toBeInTheDocument();
});

it("explains an unpublished Prompt catalog within the slash dictionary", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    apiMocks.getPlatformReferenceLibrary.mockResolvedValueOnce({ resources: [] });
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "面板与模板" }));
    fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
    fireEvent.click(screen.getByRole("option", { name: /^UGC/ }));
    expect(await screen.findByText(/当前分类暂无可用模板/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "@ 平台 Prompt" })).not.toBeInTheDocument();
});

it("previews an active platform Prompt before inserting editable text without selecting an image", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    apiMocks.previewAssetImageSubmission.mockClear();
    apiMocks.getPlatformReferenceLibrary.mockResolvedValueOnce({ scope: "platform_shared", schema_version: 1, catalog_revision: "test", resources: [
        { platform_resource_id: "platform-prompt-1", revision: 2, kind: "prompt_preset", category_path: "character/reference",
            title: "古典行旅设定", summary: "古典角色", tags: ["古装"], status: "active",
            payload: { prompt_used: "古典行旅人物，正面全身，浅灰背景", structured_prompt: { content: "古典行旅人物，正面全身，灰蓝长袍" } },
            provenance: { license: "MIT", content_sha256: "abc" } },
        { platform_resource_id: "dictionary-term", revision: 1, kind: "prompt_preset", category_path: "character/identity/face",
            title: "窄长脸词条", status: "active", dictionary: { semantic_domain: "character.identity", entry_type: "term" },
            payload: { prompt_used: "不应作为完整 Prompt", structured_prompt: { content: "窄长脸" } },
            provenance: { license: "MIT", content_sha256: "term" } },
        { platform_resource_id: "candidate-1", revision: 1, kind: "prompt_preset", category_path: "character/reference",
            title: "未审核提示词", status: "candidate", payload: { prompt_used: "不应可用" },
            provenance: { license: "MIT", content_sha256: "def" } },
    ] });
    const onGenerate = vi.fn();
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={onGenerate} generatingTypes={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "面板与模板" }));
    fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
    fireEvent.click(screen.getByRole("option", { name: /^角色设计/ }));
    expect(await screen.findByRole("option", { name: /古典行旅设定/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /未审核提示词/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /窄长脸词条/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /古典行旅设定/ }));
    expect(screen.getByRole("textbox", { name: "将插入的完整文字" })).toHaveValue("古典行旅人物，正面全身，灰蓝长袍");
    const editor = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    expect(editor.editor.getText()).not.toContain("古典行旅人物");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    await waitFor(() => expect(editor.editor.getText()).toContain("古典行旅人物，正面全身，灰蓝长袍"));
    expect(screen.getByLabelText("平台 Prompt 来源")).toHaveTextContent("古典行旅设定 · r2");
    expect(onGenerate).not.toHaveBeenCalled();
    expect(apiMocks.previewAssetImageSubmission).not.toHaveBeenCalled();
});

it("resolves slash platform Prompt as editable text without an image reference", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValue({ assets: [] } as any);
    apiMocks.getPlatformReferenceLibrary.mockResolvedValueOnce({ scope: "platform_shared", schema_version: 1, catalog_revision: "test", resources: [
        { platform_resource_id: "platform-prompt-2", revision: 3, kind: "prompt_preset", category_path: "character/reference",
            title: "古典行旅设定", status: "active", payload: { prompt_used: "正面全身，灰蓝行旅衣" },
            provenance: { license: "MIT", content_sha256: "xyz" } },
    ] });
    const onGenerate = vi.fn();
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={onGenerate} generatingTypes={[]} />);
    const editor = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => editor.editor.commands.insertContent("/古典"));
    fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
    fireEvent.click(await screen.findByRole("option", { name: /古典行旅设定/ }));
    expect(screen.getByRole("dialog", { name: "基础面板、词典和 Prompt 模板" })).toHaveTextContent("正面全身，灰蓝行旅衣");
    expect(editor.editor.getText()).toContain("/古典");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    expect(editor.editor.getText()).toContain("正面全身，灰蓝行旅衣");
    expect(editor.editor.getText()).not.toContain("/古典");
    expect(screen.getByLabelText("平台 Prompt 来源")).toHaveTextContent("古典行旅设定 · r3");
    expect(onGenerate).not.toHaveBeenCalled();
});

it("keeps image editing out of the character workbench", () => {
    render(<WorkbenchPanel {...baseProps} />);

    expect(screen.queryByText("title")).not.toBeInTheDocument();
});

it("shows one task at a time and unlocks derived prompts when the reference sheet is available", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const { container } = render(
        <CharacterWorkbench
            asset={{
                id: "character",
                name: "Test",
                description: "A character",
                reference_sheet: {
                    selected_image_id: "master",
                    image_variants: [{ id: "master", url: "/files/master.png" }],
                },
            }}
            onClose={vi.fn()}
            onUpdateDescription={vi.fn()}
            onGenerate={vi.fn()}
            generatingTypes={[]}
        />,
    );

    expect(container.querySelectorAll("[contenteditable]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    expect(container.querySelectorAll("[contenteditable]")).toHaveLength(1);
    expect(container.querySelector("[contenteditable]")).toHaveAttribute("contenteditable", "true");
    fireEvent.click(screen.getByRole("tab", { name: "avatar" }));
    expect(container.querySelector("[contenteditable]")).toHaveAttribute("contenteditable", "true");
    expect(screen.queryByText("Generate Master Asset first")).not.toBeInTheDocument();
});

it("confirms a selected project master as an explicit versioned anchor", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValue({ assets: [] } as any);
    apiMocks.getCharacterAssetPack.mockResolvedValue({
        character_id: "hero", source_scope: "project", asset_revision: 3, pack: null,
    });
    apiMocks.confirmCharacterAnchor.mockResolvedValue({
        character_id: "hero", source_scope: "project", asset_revision: 4,
        pack: { pack_id: "character-pack-hero", current_revision: 1,
            revisions: [{ revision: 1, variant_id: "front" }] },
    });
    const review = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CharacterWorkbench asset={{
        id: "hero", name: "Hero", description: "Hero",
        character_design: { design_revisions: [{ revision: 1, design: {} }] },
        reference_sheet: { selected_image_id: "front", image_variants: [{ id: "front", url: "front.webp" }] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "将选中图确认为正面全身锚点" }));
    await waitFor(() => expect(apiMocks.confirmCharacterAnchor).toHaveBeenCalledWith(
        "project-1", "hero", "front", 3, 0,
    ));
    expect(await screen.findByText("项目角色锚点：r1 · front")).toBeInTheDocument();
    review.mockRestore();
});

it("keeps the character anchor unchanged when review is cancelled", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValue({ assets: [] } as any);
    apiMocks.getCharacterAssetPack.mockResolvedValue({
        character_id: "hero", source_scope: "project", asset_revision: 3, pack: null,
    });
    apiMocks.confirmCharacterAnchor.mockClear();
    const review = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CharacterWorkbench asset={{
        id: "hero", name: "Hero", description: "Hero",
        character_design: { design_revisions: [{ revision: 1, design: {} }] },
        reference_sheet: { selected_image_id: "front", image_variants: [{ id: "front", url: "front.webp" }] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "将选中图确认为正面全身锚点" }));
    expect(apiMocks.confirmCharacterAnchor).not.toHaveBeenCalled();
    review.mockRestore();
});

it("does not offer direct image upload from the character panel", () => {
    render(<WorkbenchPanel {...baseProps} />);

    expect(screen.queryByLabelText("uploadRef: Full body")).not.toBeInTheDocument();
    expect(screen.queryByTitle("uploadRef")).not.toBeInTheDocument();
    expect(screen.getByText("Full body · 图片变体")).toBeInTheDocument();
});

it("offers inline asset rename in the character workbench", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onRename={onRename} onGenerate={vi.fn()} generatingTypes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "renameAsset" }));
    fireEvent.change(screen.getByRole("textbox", { name: "assetName" }), { target: { value: "雪痕客" } });
    fireEvent.click(screen.getByRole("button", { name: "saveName" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("雪痕客"));
});

it("preserves each task prompt while switching views", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "Hero", description: "A hero" }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    const fullBody = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => { fullBody.editor.commands.setContent("<p>full body detail</p>"); });
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    const threeView = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => { threeView.editor.commands.setContent("<p>three view detail</p>"); });
    fireEvent.click(screen.getByRole("tab", { name: "masterAsset" }));
    expect((document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.getText()).toBe("full body detail");
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    expect((document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.getText()).toBe("three view detail");
});

it("keeps image references separate from generated variants", () => {
    render(<WorkbenchPanel {...baseProps} />);
    expect(screen.queryByLabelText("uploadRef: Full body")).not.toBeInTheDocument();
});

it("shows indexed clips when typing @ and emits the stable selected reference", () => {
    apiMocks.getPlatformReferenceLibrary.mockClear();
    const setPrompt = vi.fn();
    const onReferencesChange = vi.fn();
    const candidate = {
        label: "Pocket watch",
        previewUrl: "/files/watch.png",
        sourceLabel: "global",
        reference: { asset_type: "prop" as const, asset_id: "watch-1", variant_id: "watch-front" },
    };
    render(
        <WorkbenchPanel
            {...baseProps}
            prompt=""
            setPrompt={setPrompt}
            referenceCandidates={[candidate]}
            onReferencesChange={onReferencesChange}
        />,
    );

    const editor = screen.getByRole("textbox") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => {
        editor.editor.commands.focus();
        editor.editor.commands.setContent("<p>@wat</p>");
    });
    expect(editor.editor.getText()).toBe("@wat");

    expect(screen.getByRole("listbox")).toHaveTextContent("Pocket watch");
    expect(screen.getByRole("listbox", { name: "资产检索" })).not.toHaveTextContent("Prompt");
    expect(apiMocks.getPlatformReferenceLibrary).not.toHaveBeenCalled();
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));

    expect(setPrompt).toHaveBeenLastCalledWith("@Pocket watch ");
    expect(onReferencesChange).toHaveBeenLastCalledWith([candidate.reference]);
});

it("provides a searchable reference picker without requiring an @ prefix", () => {
    const onPickerReferencesChange = vi.fn();
    const onImageGenerationModeChange = vi.fn();
    const candidate = {
        label: "Pocket watch · front",
        previewUrl: "/files/watch.png",
        sourceLabel: "global",
        reference: { asset_type: "prop" as const, asset_id: "watch-1", variant_id: "watch-front" },
    };
    render(<WorkbenchPanel {...baseProps}
        referenceCandidates={[candidate]}
        showReferencePicker
        pickerReferences={[]}
        onPickerReferencesChange={onPickerReferencesChange}
        onImageGenerationModeChange={onImageGenerationModeChange}
    />);

    fireEvent.click(screen.getByRole("button", { name: "选择参考素材" }));
    fireEvent.change(screen.getByLabelText("搜索角色参考素材"), { target: { value: "pocket" } });
    const option = screen.getByRole("option", { name: /Pocket watch/ });
    expect(option).toHaveTextContent("front");
    fireEvent.click(option);

    expect(onPickerReferencesChange).toHaveBeenCalledWith([candidate.reference]);
    expect(onImageGenerationModeChange).toHaveBeenCalledWith("reference");
});

it("supports selecting a searched reference with the keyboard", () => {
    const onPickerReferencesChange = vi.fn();
    const candidate = {
        label: "Pocket watch · front",
        sourceLabel: "全局素材",
        variantLabel: "front",
        reference: { asset_type: "prop" as const, asset_id: "watch-1", variant_id: "watch-front" },
    };
    render(<WorkbenchPanel {...baseProps}
        referenceCandidates={[candidate]}
        showReferencePicker
        pickerReferences={[]}
        onPickerReferencesChange={onPickerReferencesChange}
    />);

    fireEvent.click(screen.getByRole("button", { name: "选择参考素材" }));
    const search = screen.getByRole("textbox", { name: "搜索角色参考素材" });
    fireEvent.change(search, { target: { value: "pocket" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: /Pocket watch/ });
    expect(document.activeElement).toBe(option);
    fireEvent.keyDown(option, { key: "Enter" });

    expect(onPickerReferencesChange).toHaveBeenCalledWith([candidate.reference]);
});

it("does not turn a manually typed @name into an implicit reference", () => {
    const setPrompt = vi.fn();
    const onReferencesChange = vi.fn();
    const candidate = {
        label: "Pocket watch",
        reference: { asset_type: "prop" as const, asset_id: "watch-1", variant_id: "watch-front" },
    };
    render(
        <WorkbenchPanel
            {...baseProps}
            prompt=""
            setPrompt={setPrompt}
            referenceCandidates={[candidate]}
            onReferencesChange={onReferencesChange}
        />,
    );
    const editor = screen.getByRole("textbox") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => {
        editor.editor.commands.focus();
        editor.editor.commands.setContent("<p>@Pocket watch</p>");
    });
    fireEvent.blur(editor);

    expect(onReferencesChange).toHaveBeenLastCalledWith([]);
});

it("loads the project reference index for the character workbench", async () => {
    // Earlier tests enqueue one-shot responses; their async effects may not
    // consume them before cleanup, so this case needs an isolated index mock.
    apiMocks.getAssetReferenceIndex.mockReset();
    apiMocks.getAssetReferenceIndex.mockResolvedValue({
        schema_version: 1,
        project_id: "project-1",
        assets: [{
            asset_type: "prop",
            asset_id: "watch-1",
            name: "Pocket watch",
            source_scope: "global",
            variants: [{ id: "watch-front", url: "/files/watch.png" }],
        }],
    });
    const onGenerate = vi.fn();
    render(
        <CharacterWorkbench
            asset={{ id: "character-1", name: "Hero", description: "A hero" }}
            onClose={vi.fn()}
            onUpdateDescription={vi.fn()}
            onGenerate={onGenerate}
            generatingTypes={[]}
        />,
    );

    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledWith("project-1"));
    const editors = screen.getAllByRole("textbox") as Array<HTMLElement & { editor?: import("@tiptap/core").Editor }>;
    const promptEditor = editors.find((editor) => editor.editor);
    expect(promptEditor?.editor).toBeDefined();
    act(() => { promptEditor!.editor!.chain().setContent("<p>@wat</p>").focus("end").run(); });
    await waitFor(() => expect(promptEditor).toHaveFocus());
    expect(await screen.findByRole("listbox")).toHaveTextContent("Pocket watch");
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    await waitFor(() => expect(document.querySelector('[data-reference-variant-id="watch-front"]')).toBeInTheDocument(),
        { timeout: 3000 });
    fireEvent.click(screen.getAllByRole("button", { name: "Reference image" })[0]);
    fireEvent.click(screen.getAllByTestId("variant-generate")[0]);
    const confirm = await screen.findByRole("button", { name: "确认并生成" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
        "full_body",
        "@Pocket watch ",
        false,
        expect.any(String),
        1,
        [{ asset_type: "prop", asset_id: "watch-1", variant_id: "watch-front" }],
        "reference",
        "reviewed",
    ));
});

it("removes a deleted shared asset when the reference picker opens again", async () => {
    apiMocks.getAssetReferenceIndex.mockReset();
    const oldIndex = { schema_version: 1, project_id: "project-1", assets: [{
        asset_type: "character", asset_id: "deleted-asset", name: "Deleted actor",
        source_scope: "global", variants: [{ id: "old-view", url: "/files/old.png" }],
    }] };
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce(oldIndex).mockResolvedValueOnce(oldIndex)
        .mockResolvedValue({ ...oldIndex, assets: [] });
    render(<CharacterWorkbench asset={{ id: "character-1", name: "Hero", description: "A hero" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);

    const picker = screen.getAllByRole("button", { name: "选择参考素材" })[0];
    fireEvent.click(picker);
    expect(await screen.findByText("Deleted actor")).toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.click(picker);
    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByText("暂无可用参考素材").length).toBeGreaterThan(0));
    expect(screen.queryByText("Deleted actor")).not.toBeInTheDocument();
});

it("does not expose generic facet suggestions as character design values", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const onUpdateAttributes = vi.fn();
    render(
        <CharacterWorkbench
            asset={{ id: "character-1", name: "Hero", description: "A hero" }}
            onClose={vi.fn()}
            onUpdateDescription={vi.fn()}
            onUpdateAttributes={onUpdateAttributes}
            onGenerate={vi.fn()}
            generatingTypes={[]}
        />,
    );

    fireEvent.click(screen.getByText("advancedSettings"));
    expect(screen.queryByRole("button", { name: /眼神/ })).not.toBeInTheDocument();
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("does not ask creators to fill old missing-detail checklists", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(<CharacterWorkbench asset={{
        id: "character-1", name: "苏砚", description: "少年剑客",
        character_design: { design_draft: {
            identity: { visual_notes: "清瘦面容，黑发束起" },
            look: { visual_notes: "素黑劲装" },
            unresolved: [
                "画面风格尚未指定",
                "脸型和五官缺少依据",
                "素黑劲装的领型、袖型和面料需确认",
            ],
            confirmed: false,
        }, design_revisions: [] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);

    expect(screen.queryByText(/待核对 ·/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("补充你的决定；如果暂时无法决定可留空")).not.toBeInTheDocument();
});

it("uses the latest confirmed design instead of an older saved image prompt", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(<CharacterWorkbench asset={{
        id: "character-1", name: "Hero", description: "Old personality text", full_body_prompt: "Old image prompt",
        character_design: { design_revisions: [{ revision: 2, design: { identity: { visual_notes: "深棕眼" }, look: { visual_notes: "黑色劲装" } } }] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    const editor = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    expect(editor.editor.getText()).toContain("深棕眼");
    expect(editor.editor.getText()).toContain("黑色劲装");
    expect(editor.editor.getText()).not.toContain("Old image prompt");
});

it("shows linked shooting-plan scenes without adding scene context to character prompts", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(
        <CharacterWorkbench
            asset={{ id: "character-plan", name: "Hero", description: "A hero" }}
            onClose={vi.fn()}
            onUpdateDescription={vi.fn()}
            onGenerate={vi.fn()}
            generatingTypes={[]}
            planEntries={[{ key: "scene-1", sceneLabel: "电影院", details: ["2018年秋天", "室外"], prompt: "拍摄计划场景：电影院" }]}
        />,
    );

    const toggle = screen.getByRole("button", { name: /拍摄计划 · 1 条/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("2018年秋天")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("拍摄计划关联场景（仅供核对）")).toBeInTheDocument();
    expect(screen.getByText("2018年秋天 · 室外")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入提示词" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" })).not.toHaveTextContent("电影院");
});

it("refreshes the reference index when a generated project snapshot arrives", async () => {
    apiMocks.getAssetReferenceIndex.mockReset();
    projectStoreMocks.currentProject = {
        id: "project-1",
        characters: [{ id: "character-1", full_body_asset: { selected_id: "deleted-view", variants: [{ id: "deleted-view", url: "/files/deleted-view.png" }] } }],
    };
    const indexWithDeletedView = {
        schema_version: 1,
        project_id: "project-1",
        assets: [{
            asset_type: "character" as const,
            asset_id: "character-1",
            name: "Hero",
            source_scope: "series" as const,
            variants: [{ id: "deleted-view", url: "/files/deleted-view.png" }],
        }],
    };
    const indexWithNewView = {
        ...indexWithDeletedView,
        assets: [{ ...indexWithDeletedView.assets[0], variants: [{ id: "new-view", url: "/files/new-view.png" }] }],
    };
    apiMocks.getAssetReferenceIndex
        .mockResolvedValueOnce(indexWithDeletedView)
        .mockResolvedValue(indexWithNewView);
    const onGenerate = vi.fn();
    const workbench = (onClose: () => void) => (
        <CharacterWorkbench
            asset={{ id: "character-1", name: "Hero", description: "A hero" }}
            onClose={onClose}
            onUpdateDescription={vi.fn()}
            onGenerate={onGenerate}
            generatingTypes={[]}
        />
    );
    const { rerender } = render(workbench(vi.fn()));

    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(1));
    projectStoreMocks.currentProject = {
        id: "project-1",
        revision: 2,
        characters: [{ id: "character-1", full_body_asset: { selected_id: "new-view", variants: [{ id: "new-view", url: "/files/new-view.png" }] } }],
    };
    rerender(workbench(vi.fn()));
    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(2));

    const editor = (screen.getAllByRole("textbox") as Array<HTMLElement & { editor?: import("@tiptap/core").Editor }>).find((item) => item.editor);
    expect(editor?.editor).toBeDefined();
    act(() => { editor!.editor!.chain().setContent("<p>@Hero</p>").focus("end").run(); });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    await waitFor(() => expect(document.querySelector('[data-reference-variant-id="new-view"]')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Reference image" })[0]);
    fireEvent.click(screen.getAllByTestId("variant-generate")[0]);
    const confirm = await screen.findByRole("button", { name: "确认并生成" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
        "full_body",
        "@Hero ",
        false,
        expect.any(String),
        1,
        [{ asset_type: "character", asset_id: "character-1", variant_id: "new-view" }],
        "reference",
        "reviewed",
    ));
});

it("builds Chinese character defaults without duplicate punctuation", () => {
    const prompt = buildCharacterImagePrompt(
        "full_body",
        "周涵（大学时期）",
        "黑色短发，五官端正，身材高挑匀称，外形阳光帅气，具有年轻大学生的清爽气质。",
    );

    expect(prompt).toContain("全身角色设计：周涵（大学时期）");
    expect(prompt).not.toMatch(/^false。/);
    expect(prompt).not.toMatch(/Full body|concept art|Standing pose|Clean white background/);
    expect(prompt).not.toMatch(/。\./);
});

it("keeps motion, video, and negative defaults in Chinese", () => {
    expect(buildCharacterMotionPrompt("full_body", "黑色短发", false)).toContain("全身角色参考视频");
    expect(buildCharacterMotionPrompt("headshot", "黑色短发", true)).toContain("口型与音频同步");
    expect(buildCharacterVideoPrompt("周涵（大学时期）", "黑色短发")).toContain("电影感镜头");
    expect(DEFAULT_CHARACTER_NEGATIVE_PROMPT).toContain("低质量");
    expect(DEFAULT_CHARACTER_NEGATIVE_PROMPT).not.toContain("low quality");
});


it("locates character previews by the owning character rather than its image container", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    render(<CharacterWorkbench asset={{ id: "character-owner", name: "Hero", description: "Hero",
        reference_sheet: { selected_image_id: "front", image_variants: [{ id: "front", url: "front.webp" }] },
        three_view_asset: { selected_id: "views", variants: [{ id: "views", url: "views.webp" }] },
        headshot_asset: { selected_id: "head", variants: [{ id: "head", url: "head.webp" }] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    for (const tab of ["masterAsset", "threeViews", "avatar"]) {
        fireEvent.click(screen.getByRole("tab", { name: tab }));
        expect(JSON.parse(screen.getByTestId("preview-locator").textContent!)).toEqual({ scope: "project", containerId: "project-1", assetType: "character", assetId: "character-owner" });
    }
});


it("retains a series character's owner scope when requesting its previews", () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const project = projectStoreMocks.currentProject;
    projectStoreMocks.currentProject = { ...project, series_id: "series-owner" } as typeof project;
    try {
        render(<CharacterWorkbench asset={{ id: "series-character", source: "series", name: "Hero", description: "Hero",
            full_body_asset: { selected_id: "front", variants: [{ id: "front", url: "front.webp" }] },
        }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
        expect(JSON.parse(screen.getByTestId("preview-locator").textContent!)).toEqual({ scope: "series", containerId: "series-owner", assetType: "character", assetId: "series-character" });
    } finally {
        projectStoreMocks.currentProject = project;
    }
});


it("keeps presentation controls with asset tabs and omits the embedded panel description", () => {
    render(<CharacterWorkbench asset={{ id: "compact-character", name: "Hero", description: "A hero" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    const toolbar = screen.getByTestId("character-asset-toolbar");
    expect(toolbar).toContainElement(screen.getByRole("tablist"));
    expect(toolbar).toContainElement(screen.getByRole("group", { name: "资产呈现方式" }));
    expect(screen.queryByText("The primary reference for character consistency.")).not.toBeInTheDocument();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "motionMode" }));
    expect(alert).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "staticMode" })).toHaveAttribute("aria-pressed", "true");
    alert.mockRestore();
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    expect(screen.queryByRole("group", { name: "资产呈现方式" })).not.toBeInTheDocument();
});

it("preserves independent full-body and headshot presentation modes in the shared toolbar", () => {
    render(<CharacterWorkbench asset={{ id: "mode-character", name: "Hero", description: "A hero",
        full_body_image_url: "front.webp", headshot_image_url: "head.webp" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "motionMode" }));
    expect(screen.getByRole("button", { name: "motionMode" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("tab", { name: "avatar" }));
    expect(screen.getByRole("button", { name: "staticMode" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("tab", { name: "masterAsset" }));
    expect(screen.getByRole("button", { name: "motionMode" })).toHaveAttribute("aria-pressed", "true");
});

function designDetailsEditor() {
    return (screen.getByRole("textbox", { name: "角色细节，/ 选择词典，[] 调整细节" }) as any).editor;
}
function mountSimpleDesign(extra: Record<string, unknown> = {}) {
    apiMocks.agentRequest.mockClear();
    const onUpdateAttributes = vi.fn().mockResolvedValue(undefined);
    const onUpdateDescription = vi.fn();
    const onGenerate = vi.fn();
    render(<CharacterWorkbench asset={{ id: "simple-role", name: "苏砚", description: "少年，身姿挺拔，素黑劲装；性格沉静寡言。", full_body_prompt: "脸部：眉目清冽。\n服装：素黑劲装，布靴。", ...extra }}
        onClose={vi.fn()} onUpdateDescription={onUpdateDescription} onUpdateAttributes={onUpdateAttributes}
        onGenerate={onGenerate} generatingTypes={[]} />);
    return { onUpdateAttributes, onUpdateDescription, onGenerate };
}
async function submitSimpleDesign() {
    const submit = screen.getByRole("button", { name: "提交 AI 完善" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    return screen.findByRole("textbox", { name: "角色提示词 · 检查后保存或确认" });
}

it("opens design in the existing Prompt column with source and model, without a sidebar or field modes", async () => {
    const { onUpdateDescription } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    const design = screen.getByRole("region", { name: "角色设计" });
    expect(design.closest("aside")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByText("少年，身姿挺拔，素黑劲装；性格沉静寡言。")).toBeInTheDocument();
    expect(screen.getByText("供设计核对，不随 AI 完善改写。")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "身份视觉值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "逐项编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整体描述" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "角色细节，/ 选择词典，[] 调整细节" })).toHaveTextContent("素黑劲装，布靴");
    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
    expect(onUpdateDescription).not.toHaveBeenCalled();
});

it("keeps AI design out of discovery and available from the workbench", async () => {
    mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "面板与模板" }));
    const discovery = screen.getByRole("dialog", { name: "基础面板、词典和 Prompt 模板" });
    expect(within(discovery).queryByRole("button", { name: "AI 完善角色设计" })).not.toBeInTheDocument();
    fireEvent.click(within(discovery).getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    expect(await screen.findByRole("region", { name: "角色设计" })).toBeInTheDocument();
    expect(designDetailsEditor().getText().replace(/\s+/g, " ").trim()).toBe("/脸部：眉目清冽。 服装：素黑劲装，布靴。");
    expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认输入并完善角色设计" })).not.toBeInTheDocument();
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("submits the current edited Prompt and read-only description in one action and only returns a draft", async () => {
    const { onUpdateAttributes, onUpdateDescription, onGenerate } = mountSimpleDesign();
    const originalEditor = (screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" }) as any).editor;
    act(() => originalEditor.commands.setContent("<p>身高约178厘米，素黑外衣一件，脚穿布靴。</p>"));
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    await submitSimpleDesign();
    expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft/preview", "POST", expect.objectContaining({
        profile: "少年，身姿挺拔，素黑劲装；性格沉静寡言。",
        current_draft: "身高约178厘米，素黑外衣一件，脚穿布靴。", route: "", reference_assets: [],
    }));
    expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.objectContaining({
        review_token: "reviewed", reviewed_messages: expect.objectContaining({ system: "返回 identity 与 look" }),
    }));
    expect(screen.getByRole("textbox", { name: "角色提示词 · 检查后保存或确认" })).toHaveValue("身份：深棕眼\n造型：黑色劲装");
    expect(originalEditor.getText()).toBe("身高约178厘米，素黑外衣一件，脚穿布靴。");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    expect(onUpdateDescription).not.toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
});

it("keeps dictionary previews separate and inserts editable selected details in the unified form", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    const editor = designDetailsEditor();
    act(() => editor.chain().selectAll().insertContent({ type: "text", text: "前文 /长发高束" }).run());
    fireEvent.click(await screen.findByRole("option", { name: /长发高束/ }));
    expect(editor.getText()).toBe("前文 /长发高束");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    expect(editor.getText()).toBe("前文 长发高束，发际线和鬓角保留自然碎发");
    act(() => editor.commands.setContent("<p>长发高束，窄红发带。</p>"));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: false, user_visual_requirements: { identity: "长发高束，窄红发带。", look: "" },
        identity: expect.objectContaining({ visual_notes: "长发高束，窄红发带。" }),
    }) }));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("saves and confirms the edited returned sections rather than stale generated features", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "身份：身高约178厘米，浅麦肤色，清冽眉目。\n造型：里衣一件、黑色外衣一件，布靴，无披风。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: false,
        identity: expect.objectContaining({ visual_notes: "身高约178厘米，浅麦肤色，清冽眉目。", features: {}, editor_mode: "notes" }),
        look: expect.objectContaining({ visual_notes: "里衣一件、黑色外衣一件，布靴，无披风。", features: {}, editor_mode: "notes" }),
    }) }));
    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenLastCalledWith({ character_design: expect.objectContaining({ confirmed: true }) }));
    expect(screen.getByRole("status")).toHaveTextContent("已确认 r1");
    fireEvent.click(screen.getByRole("button", { name: "返回图片 Prompt" }));
    expect(screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" })).toHaveTextContent("无披风");
    expect(screen.queryByRole("button", { name: "应用到图片提示词" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    expect(screen.getByRole("textbox", { name: "角色提示词 · 检查后保存或确认" })).toHaveValue("身份：身高约178厘米，浅麦肤色，清冽眉目。\n造型：里衣一件、黑色外衣一件，布靴，无披风。");
    expect(screen.getByRole("status")).toHaveTextContent("已确认 r1");
});

it("preserves structured saved identity, height and look until the unified result is explicitly edited", async () => {
    const { onUpdateAttributes } = mountSimpleDesign({ character_design: { design_draft: {
        identity: { features: { face: "窄长脸", height: "身高约182厘米" }, editor_mode: "fields" },
        look: { features: { clothing: "素黑劲装", accessories: "哑银发扣" }, editor_mode: "fields" },
        user_visual_requirements: { identity: "保存的角色细节", look: "" },
    } } });
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    expect(designDetailsEditor().getText()).toBe("保存的角色细节");
    expect((screen.getByRole("textbox", { name: "角色提示词 · 检查后保存或确认" }) as HTMLTextAreaElement).value).toContain("身高约182厘米");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        identity: expect.objectContaining({ features: { face: "窄长脸", height: "身高约182厘米" } }),
        look: expect.objectContaining({ features: { clothing: "素黑劲装", accessories: "哑银发扣" } }),
    }) }));
});

it("keeps manual confirmation available without AI and preserves empty output as empty", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    act(() => designDetailsEditor().commands.setContent("<p>少年，黑发，素黑劲装。</p>"));
    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({ confirmed: true,
        identity: expect.objectContaining({ visual_notes: "少年，黑发，素黑劲装。" }),
    }) }));
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "确认设计" })).toBeDisabled();
});

it("preserves task Prompts and design edits across closing and reopening the same design form", async () => {
    mountSimpleDesign();
    const original = screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" });
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    act(() => designDetailsEditor().commands.setContent("<p>窄袖黑衣，不叠加披风。</p>"));
    fireEvent.click(screen.getByRole("button", { name: "返回图片 Prompt" }));
    await waitFor(() => expect(original).toBeVisible());
    expect(original).toHaveTextContent("素黑劲装，布靴。");
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    expect(designDetailsEditor().getText()).toBe("窄袖黑衣，不叠加披风。");
});

it("does not submit a stale compiled request after the creator edits role details", async () => {
    mountSimpleDesign();
    let resolvePreview!: (value: unknown) => void;
    apiMocks.agentRequest.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    act(() => designDetailsEditor().commands.setContent("<p>新的角色约束。</p>"));
    await act(async () => resolvePreview({ messages: { system: "identity look", user: "旧约束" }, review_token: "old" }));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path === "/character-design/draft")).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "角色提示词 · 检查后保存或确认" })).not.toBeInTheDocument();
});

it("drops an in-flight generated result after role details change", async () => {
    mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    let resolveDraft!: (value: unknown) => void;
    apiMocks.agentRequest.mockImplementationOnce((_path, _method, body) => Promise.resolve({ messages: { system: "identity look", user: JSON.stringify(body) }, review_token: "reviewed" }));
    apiMocks.agentRequest.mockImplementationOnce(() => new Promise(resolve => { resolveDraft = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    await waitFor(() => expect(resolveDraft).toBeDefined());
    act(() => designDetailsEditor().commands.setContent("<p>新的素白衣约束。</p>"));
    await act(async () => resolveDraft({ identity: { visual_notes: "过期脸型" }, look: { visual_notes: "旧衣服" } }));
    expect(screen.queryByRole("textbox", { name: "角色提示词 · 检查后保存或确认" })).not.toBeInTheDocument();
    expect(designDetailsEditor().getText()).toBe("新的素白衣约束。");
});

it("shows model errors without overwriting role details or saving a design", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    apiMocks.agentRequest.mockRejectedValueOnce(new Error("模型服务暂不可用"));
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型服务暂不可用");
    expect(designDetailsEditor().getText()).toContain("素黑劲装，布靴");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("applies the edited reviewed text to all image tasks only on explicit application", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "身份：清冽眉目，身高约178厘米。\n造型：黑色外衣一件，布靴。" } });
    fireEvent.click(screen.getByRole("button", { name: "返回图片 Prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    for (const name of ["masterAsset", "threeViews", "avatar"]) {
        fireEvent.click(screen.getByRole("tab", { name }));
        const prompt = screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" });
        expect(prompt).toHaveTextContent("清冽眉目，身高约178厘米。");
        expect(prompt).toHaveTextContent("黑色外衣一件，布靴。");
    }
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("keeps the editable result and draft status when saving fails", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    onUpdateAttributes.mockRejectedValueOnce(new Error("保存失败，请重试"));
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    const result = await submitSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(result).toHaveValue("身份：深棕眼\n造型：黑色劲装");
    expect(screen.getByRole("status")).toHaveTextContent("草稿");
});

it("does not carry retired hidden style controls into a new completion or its saved projection", async () => {
    const { onUpdateAttributes } = mountSimpleDesign({ character_design: { design_draft: {
        route: "realistic-modern", age_stage: "adult", style_notes: "旧现代风格",
        identity: { visual_notes: "旧外观" }, look: { visual_notes: "旧服装" },
    } } });
    const editor = (screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" }) as any).editor;
    act(() => editor.commands.setContent("<p>少年侠客，古装素黑劲装。</p>"));
    fireEvent.click(screen.getByRole("button", { name: "AI 完善角色设计" }));
    await submitSimpleDesign();
    const request = apiMocks.agentRequest.mock.calls.find(([path]) => path === "/character-design/draft/preview")![2];
    expect(request).toMatchObject({ current_draft: "少年侠客，古装素黑劲装。", route: "" });
    expect(request).not.toHaveProperty("style");
    expect(request).not.toHaveProperty("age_stage");
    expect(request).not.toHaveProperty("confirmed_design");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        route: "", age_stage: undefined, style_notes: undefined,
    }) }));
});

it("edits, confirms and reloads independent facial fields without an AI call", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    for (const [label, value] of [["眉形", "柳叶眉"], ["眼周细节", "表情放松时仍可见浅细纹"], ["肤色", "中等中性肤色"], ["肤质", "面颊略干，保留细微干燥纹理"]]) {
        fireEvent.change(screen.getByRole("textbox", { name: `设计字段 · ${label}` }), { target: { value } });
    }
    expect((screen.getByRole("textbox", { name: "角色提示词 · 检查后保存或确认" }) as HTMLTextAreaElement).value).toContain("眉形：柳叶眉\n眼周细节：表情放松时仍可见浅细纹\n肤色：中等中性肤色\n肤质：面颊略干，保留细微干燥纹理");
    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.identity.features).toMatchObject({ eyebrows: "柳叶眉", eye_detail: "表情放松时仍可见浅细纹", skin_tone: "中等中性肤色", skin_texture: "面颊略干，保留细微干燥纹理" });
    fireEvent.click(screen.getByRole("button", { name: "返回图片 Prompt" }));
    expect(screen.getByRole("textbox", { name: "输入 Prompt，/ 打开面板与模板，@ 检索资产" })).toHaveTextContent("眉形：柳叶眉");
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: design } });
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    expect(screen.getByRole("textbox", { name: "设计字段 · 肤质" })).toHaveValue("面颊略干，保留细微干燥纹理");
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("saves dictionary face choices as fields and keeps the remaining clothing text", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "展开角色设计" }));
    act(() => designDetailsEditor().chain().selectAll().insertContent({ type: "text", text: "靛蓝外衣，素面布靴。 /面容" }).run());
    fireEvent.click(await screen.findByRole("option", { name: /^面容$/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "肤质" }), { target: { value: "轻微干燥肤质" } });
    fireEvent.change(screen.getByRole("combobox", { name: "肤色" }), { target: { value: "暖小麦肤色" } });
    fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
    expect(screen.getByRole("textbox", { name: "设计字段 · 肤质" })).toHaveValue("面颊皮肤略显干燥，保留细微干燥纹理");
    expect(screen.getByRole("textbox", { name: "其他已输入细节" })).toHaveValue("靛蓝外衣，素面布靴。");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        schema_version: "iframe.character-fields.v1", supplemental_prompt: "靛蓝外衣，素面布靴。",
        dictionary_configurations: [expect.objectContaining({ preset_id: "dictionary.panel.face", selections: { "肤色": "暖小麦肤色", "肤质": "轻微干燥肤质" } })],
        identity: expect.objectContaining({ editor_mode: "fields", features: { skin_tone: "暖小麦肤色", skin_texture: "面颊皮肤略显干燥，保留细微干燥纹理" } }),
    }) }));
});

it('preserves authored negative prompt arrays through AI, confirmation and reload', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '展开角色设计' }));
    fireEvent.change(screen.getByRole('textbox', { name: '设计约束 · 必须保留' }), { target: { value: '自然皮肤纹理' } });
    fireEvent.change(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' }), { target: { value: '额外披风\ncartoon' } });
    await submitSimpleDesign();
    const request = apiMocks.agentRequest.mock.calls.find(([path]) => path === '/character-design/draft')![2];
    expect(request.constraints).toEqual({ must_keep: ['自然皮肤纹理'], negative_prompt: ['额外披风', 'cartoon'] });
    fireEvent.click(screen.getByRole('button', { name: '确认设计' }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.constraints).toEqual(request.constraints);
    fireEvent.click(screen.getByRole('button', { name: '返回图片 Prompt' }));
    expect(screen.getByRole('textbox', { name: '输入 Prompt，/ 打开面板与模板，@ 检索资产' })).toHaveTextContent('负面提示词：');
    expect((screen.getByPlaceholderText('Enter your negative prompt (avoid unwanted elements)...') as HTMLTextAreaElement).value).toContain('cartoon');
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: design } });
    fireEvent.click(screen.getByRole('button', { name: '展开角色设计' }));
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('额外披风\ncartoon');
    const result = screen.getByRole('textbox', { name: '角色提示词 · 检查后保存或确认' }) as HTMLTextAreaElement;
    expect(result.value.split('负面提示词：')).toHaveLength(2);
    fireEvent.change(result, { target: { value: '圆脸，素色布衣。' } });
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('');
});

it('saves clothing panel sections and negative arrays without an AI call', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '展开角色设计' }));
    act(() => designDetailsEditor().chain().selectAll().insertContent({ type: 'text', text: '/服装' }).run());
    fireEvent.click(await screen.findByRole('option', { name: /^古装外套$/ }));
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    expect((screen.getByRole('textbox', { name: '设计字段 · 服装结构与材质' }) as HTMLTextAreaElement).value).toContain('上身仅有里衣和外衣两件');
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('未指定的中衣、披风、护甲或装饰性叠领');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.look.features.clothing).toContain('靛蓝色');
    expect(design.constraints.negative_prompt).toEqual(['未指定的中衣、披风、护甲或装饰性叠领']);
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith('/character-design/'))).toHaveLength(0);
});
