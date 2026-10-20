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
    const editor = designDetailsEditor();
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
    const editor = { editor: designDetailsEditor() };
    expect(editor.editor.getText()).not.toContain("古典行旅人物");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    await waitFor(() => expect(editor.editor.getText()).toContain("古典行旅人物，正面全身，灰蓝长袍"));
    expect(designDetailsEditor().getText()).toContain("古典行旅人物");
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
    const editor = { editor: designDetailsEditor() };
    act(() => editor.editor.commands.insertContent("/古典"));
    fireEvent.click(screen.getByRole("tab", { name: "Prompt 模板" }));
    fireEvent.click(await screen.findByRole("option", { name: /古典行旅设定/ }));
    expect(screen.getByRole("dialog", { name: "基础面板、词典和 Prompt 模板" })).toHaveTextContent("正面全身，灰蓝行旅衣");
    expect(editor.editor.getText()).toContain("/古典");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    expect(editor.editor.getText()).toContain("正面全身，灰蓝行旅衣");
    expect(editor.editor.getText()).not.toContain("/古典");
    expect(designDetailsEditor().getText()).toContain("正面全身，灰蓝行旅衣");
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
    expect(screen.getByRole("textbox", { name: "角色设计，/ 选择词典，[] 调整细节" })).toHaveAttribute("contenteditable", "true");
    fireEvent.click(screen.getByRole("tab", { name: "avatar" }));
    expect(screen.getByRole("textbox", { name: "角色设计，/ 选择词典，[] 调整细节" })).toHaveAttribute("contenteditable", "true");
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
    const fullBody = imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => { fullBody.editor.commands.setContent("<p>full body detail</p>"); });
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    const threeView = imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => { threeView.editor.commands.setContent("<p>three view detail</p>"); });
    fireEvent.click(screen.getByRole("tab", { name: "masterAsset" }));
    expect((imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.getText()).toBe("full body detail");
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    expect((imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.getText()).toBe("three view detail");
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
    openImagePrompt();
    const editors = screen.getAllByRole("textbox") as Array<HTMLElement & { editor?: import("@tiptap/core").Editor }>;
    const promptEditor = imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor };
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

    openImagePrompt();
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

    openImagePrompt();
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
    const editor = imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor };
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
    expect(imagePromptInput()).not.toHaveTextContent("电影院");
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

    const editor = imagePromptInput() as HTMLElement & { editor: import("@tiptap/core").Editor };
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
    expect(toolbar).toContainElement(within(toolbar).getByRole("tablist"));
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

function openImagePrompt() {
    if (!screen.queryByRole('dialog', { name: '核对图片生成请求' })) {
        fireEvent.click(screen.getByTestId('variant-generate'));
    }
}
function imagePromptInput() {
    openImagePrompt();
    return screen.getByRole('textbox', { name: '本次出图提示词，@ 检索资产' });
}

function designDetailsEditor() {
    fireEvent.click(screen.getByRole("tab", { name: "角色设计" }));
    return (screen.getByRole("textbox", { name: "角色设计，/ 选择词典，[] 调整细节" }) as any).editor;
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

it.each(['panel', 'ai'] as const)('generates explicitly from %s while preserving both saved designs', async (source) => {
    const { onGenerate, onUpdateAttributes } = mountSimpleDesign();
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: 'AI方案：红色外衣，长靴。' } });
    if (source === 'panel') fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    const label = source === 'panel' ? '角色设计' : 'AI 优化';
    fireEvent.click(screen.getByRole('button', { name: `保存并使用${source === 'panel' ? '' : ' '}${label}` }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledTimes(1));
    const saved = onUpdateAttributes.mock.calls[0][0].character_design;
    expect(saved.active_design_source).toBe(source);
    expect(saved.design_input.prompt).toContain('素黑劲装');
    expect(saved.design_result.prompt).toBe('AI方案：红色外衣，长靴。');
    openImagePrompt();
    expect(screen.getByText(new RegExp(`提示词来源：${label}`))).toBeInTheDocument();
    const prompt = imagePromptInput().textContent || '';
    expect(prompt).toContain(source === 'panel' ? '素黑劲装' : '红色外衣');
    expect(prompt).not.toContain(source === 'panel' ? '红色外衣' : '素黑劲装');
    const confirm = screen.getByRole('button', { name: '确认并生成' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(onGenerate.mock.calls[0][1]).toContain(source === 'panel' ? '素黑劲装' : '红色外衣');
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: saved, design_revisions: [{ revision: 1, design: saved }] } });
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent(source === 'panel' ? '素黑劲装' : '红色外衣');
});

it('uses the visible tab for an unsaved generation without implicitly saving either design', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    await submitSimpleDesign();
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent('素黑劲装');
    expect(imagePromptInput()).not.toHaveTextContent('深棕眼');
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    fireEvent.click(screen.getByRole('tab', { name: 'AI 优化' }));
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent('深棕眼');
    expect(imagePromptInput()).not.toHaveTextContent('素黑劲装');
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});
function aiResult() {
    fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    return screen.getByRole("textbox", { name: "AI 优化" });
}
async function submitSimpleDesign() {
    fireEvent.click(screen.getByRole("tab", { name: "角色设计" }));
    const submit = screen.getByRole("button", { name: "提交 AI 完善" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    return screen.findByRole("textbox", { name: "AI 优化" });
}

it("opens design in the existing Prompt column with source and model, without a sidebar or field modes", async () => {
    const { onUpdateDescription } = mountSimpleDesign();
    const design = screen.getByRole("region", { name: "角色设计" });
    expect(design.closest("aside")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByText("少年，身姿挺拔，素黑劲装；性格沉静寡言。")).toBeInTheDocument();
    expect(screen.getByText("供设计核对，不随 AI 完善改写。")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "身份视觉值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "逐项编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整体描述" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "角色设计，/ 选择词典，[] 调整细节" })).toHaveTextContent("素黑劲装，布靴");
    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
    expect(onUpdateDescription).not.toHaveBeenCalled();
});

it("keeps AI completion only as the design form submit action", async () => {
    mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "面板与模板" }));
    const discovery = screen.getByRole("dialog", { name: "基础面板、词典和 Prompt 模板" });
    expect(within(discovery).queryByRole("button", { name: "AI 完善角色设计" })).not.toBeInTheDocument();
    fireEvent.click(within(discovery).getByRole("button", { name: "关闭面板" }));
    expect(await screen.findByRole("region", { name: "角色设计" })).toBeInTheDocument();
    expect(designDetailsEditor().getText().replace(/\s+/g, " ").trim()).toBe("脸部：眉目清冽。 服装：素黑劲装，布靴。");
    expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认输入并完善角色设计" })).not.toBeInTheDocument();
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("submits the current edited Prompt and read-only description in one action and only returns a draft", async () => {
    const { onUpdateAttributes, onUpdateDescription, onGenerate } = mountSimpleDesign();
    const originalEditor = designDetailsEditor();
    act(() => originalEditor.commands.setContent("<p>身高约178厘米，素黑外衣一件，脚穿布靴。</p>"));
    await submitSimpleDesign();
    expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft/preview", "POST", expect.objectContaining({
        profile: "少年，身姿挺拔，素黑劲装；性格沉静寡言。",
        current_draft: "身高约178厘米，素黑外衣一件，脚穿布靴。", route: "", reference_assets: [],
    }));
    expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.objectContaining({
        review_token: "reviewed", reviewed_messages: expect.objectContaining({ system: "返回 identity 与 look" }),
    }));
    expect(aiResult()).toHaveValue("身份：深棕眼\n造型：黑色劲装");
    expect(originalEditor.getText()).toBe("身高约178厘米，素黑外衣一件，脚穿布靴。");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    expect(onUpdateDescription).not.toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
});

it("keeps dictionary previews separate and inserts editable selected details in the unified form", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    const editor = designDetailsEditor();
    act(() => editor.chain().selectAll().insertContent({ type: "text", text: "前文 /长发高束" }).run());
    fireEvent.click(await screen.findByRole("option", { name: /长发高束/ }));
    expect(editor.getText()).toBe("前文 /长发高束");
    fireEvent.click(screen.getByRole("button", { name: "插入到当前 Prompt" }));
    expect(editor.getText()).toBe("前文 长发高束，发际线和鬓角保留自然碎发");
    act(() => editor.commands.setContent("<p>长发高束，窄红发带。</p>"));
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: true, user_visual_requirements: { identity: "长发高束，窄红发带。", look: "" },
        identity: expect.objectContaining({ visual_notes: "长发高束，窄红发带。" }),
    }) }));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("saves and confirms the edited returned sections rather than stale generated features", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "身份：身高约178厘米，浅麦肤色，清冽眉目。\n造型：里衣一件、黑色外衣一件，布靴，无披风。" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: true,
        identity: expect.objectContaining({ visual_notes: "身高约178厘米，浅麦肤色，清冽眉目。", features: {}, editor_mode: "notes" }),
        look: expect.objectContaining({ visual_notes: "里衣一件、黑色外衣一件，布靴，无披风。", features: {}, editor_mode: "notes" }),
    }) }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenLastCalledWith({ character_design: expect.objectContaining({ confirmed: true }) }));
    expect(within(screen.getByRole("region", { name: "角色设计" })).getByRole("status")).toHaveTextContent("已保存");
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent("无披风");
    expect(screen.queryByRole("button", { name: /^应用.*到图片提示词/ })).not.toBeInTheDocument();
    expect(aiResult()).toHaveValue("身份：身高约178厘米，浅麦肤色，清冽眉目。\n造型：里衣一件、黑色外衣一件，布靴，无披风。");
    expect(within(screen.getByRole("region", { name: "角色设计" })).getByRole("status")).toHaveTextContent("已保存");
});

it("preserves structured saved identity, height and look until the unified result is explicitly edited", async () => {
    const { onUpdateAttributes } = mountSimpleDesign({ character_design: { design_draft: {
        identity: { features: { face: "窄长脸", height: "身高约182厘米" }, editor_mode: "fields" },
        look: { features: { clothing: "素黑劲装", accessories: "哑银发扣" }, editor_mode: "fields" },
        user_visual_requirements: { identity: "保存的角色细节", look: "" },
    } } });
    expect(designDetailsEditor().getText()).toBe("保存的角色细节");
    expect((aiResult() as HTMLTextAreaElement).value).toContain("身高约182厘米");
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        identity: expect.objectContaining({ features: { face: "窄长脸", height: "身高约182厘米" } }),
        look: expect.objectContaining({ features: { clothing: "素黑劲装", accessories: "哑银发扣" } }),
    }) }));
});

it("keeps manual confirmation available without AI and preserves empty output as empty", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    act(() => designDetailsEditor().commands.setContent("<p>少年，黑发，素黑劲装。</p>"));
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({ confirmed: true,
        identity: expect.objectContaining({ visual_notes: "少年，黑发，素黑劲装。" }),
    }) }));
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /^保存并使用/ })).toBeDisabled();
});

it("keeps design details and task Prompts independently editable in the same workspace", async () => {
    mountSimpleDesign();
    const original = imagePromptInput();
    act(() => designDetailsEditor().commands.setContent("<p>窄袖黑衣，不叠加披风。</p>"));
    openImagePrompt();
    await waitFor(() => expect(original).toBeVisible());
    expect(original).toHaveTextContent("素黑劲装，布靴。");
    expect(designDetailsEditor().getText()).toBe("窄袖黑衣，不叠加披风。");
});

it("does not submit a stale compiled request after the creator edits role details", async () => {
    mountSimpleDesign();
    let resolvePreview!: (value: unknown) => void;
    apiMocks.agentRequest.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    act(() => designDetailsEditor().commands.setContent("<p>新的角色约束。</p>"));
    await act(async () => resolvePreview({ messages: { system: "identity look", user: "旧约束" }, review_token: "old" }));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path === "/character-design/draft")).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "AI 优化" })).not.toBeInTheDocument();
});

it("drops an in-flight generated result after role details change", async () => {
    mountSimpleDesign();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    let resolveDraft!: (value: unknown) => void;
    apiMocks.agentRequest.mockImplementationOnce((_path, _method, body) => Promise.resolve({ messages: { system: "identity look", user: JSON.stringify(body) }, review_token: "reviewed" }));
    apiMocks.agentRequest.mockImplementationOnce(() => new Promise(resolve => { resolveDraft = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    await waitFor(() => expect(resolveDraft).toBeDefined());
    act(() => designDetailsEditor().commands.setContent("<p>新的素白衣约束。</p>"));
    await act(async () => resolveDraft({ identity: { visual_notes: "过期脸型" }, look: { visual_notes: "旧衣服" } }));
    expect(screen.queryByRole("textbox", { name: "AI 优化" })).not.toBeInTheDocument();
    expect(designDetailsEditor().getText()).toBe("新的素白衣约束。");
});

it("shows model errors without overwriting role details or saving a design", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 AI 完善" })).toBeEnabled());
    apiMocks.agentRequest.mockRejectedValueOnce(new Error("模型服务暂不可用"));
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型服务暂不可用");
    expect(designDetailsEditor().getText()).toContain("素黑劲装，布靴");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("applies the edited reviewed text to all image tasks only on explicit application", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    const result = await submitSimpleDesign();
    fireEvent.change(result, { target: { value: "身份：清冽眉目，身高约178厘米。\n造型：黑色外衣一件，布靴。" } });
    fireEvent.click(screen.getByRole("button", { name: /^应用.*到图片提示词/ }));
    openImagePrompt();
    for (const name of ["masterAsset", "threeViews", "avatar"]) {
        fireEvent.click(screen.getByRole("tab", { name }));
        const prompt = imagePromptInput();
        expect(prompt).toHaveTextContent("清冽眉目，身高约178厘米。");
        expect(prompt).toHaveTextContent("黑色外衣一件，布靴。");
    }
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("keeps the editable result and draft status when saving fails", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    onUpdateAttributes.mockRejectedValueOnce(new Error("保存失败，请重试"));
    const result = await submitSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(result).toHaveValue("身份：深棕眼\n造型：黑色劲装");
    expect(within(screen.getByRole("region", { name: "角色设计" })).getByRole("status")).toHaveTextContent("尚未保存");
});

it("does not carry retired hidden style controls into a new completion or its saved projection", async () => {
    const { onUpdateAttributes } = mountSimpleDesign({ character_design: { design_draft: {
        route: "realistic-modern", age_stage: "adult", style_notes: "旧现代风格",
        identity: { visual_notes: "旧外观" }, look: { visual_notes: "旧服装" },
    } } });
    const editor = designDetailsEditor();
    act(() => editor.commands.setContent("<p>少年侠客，古装素黑劲装。</p>"));
    await submitSimpleDesign();
    const request = apiMocks.agentRequest.mock.calls.find(([path]) => path === "/character-design/draft/preview")![2];
    expect(request).toMatchObject({ current_draft: "少年侠客，古装素黑劲装。", route: "" });
    expect(request).not.toHaveProperty("style");
    expect(request).not.toHaveProperty("age_stage");
    expect(request).not.toHaveProperty("confirmed_design");
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        route: "", age_stage: undefined, style_notes: undefined,
    }) }));
});

it("edits, confirms and reloads independent facial fields without an AI call", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "设计面板" }));
    for (const [label, value] of [["眉形", "柳叶眉"], ["眼周细节", "表情放松时仍可见浅细纹"], ["肤色", "中等中性肤色"], ["肤质", "面颊略干，保留细微干燥纹理"]]) {
        fireEvent.change(screen.getByRole("textbox", { name: `设计字段 · ${label}` }), { target: { value } });
    }
    expect(screen.getByRole("textbox", { name: "设计字段 · 眉形" })).toHaveValue("柳叶眉");
    expect(screen.getByRole("textbox", { name: "设计字段 · 眼周细节" })).toHaveValue("表情放松时仍可见浅细纹");
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.identity.features).toMatchObject({ eyebrows: "柳叶眉", eye_detail: "表情放松时仍可见浅细纹", skin_tone: "中等中性肤色", skin_texture: "面颊略干，保留细微干燥纹理" });
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent("眉形：柳叶眉");
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: design } });
    fireEvent.click(screen.getByRole("button", { name: "设计面板" }));
    expect(screen.getByRole("textbox", { name: "设计字段 · 肤质" })).toHaveValue("面颊略干，保留细微干燥纹理");
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith("/character-design/"))).toHaveLength(0);
});

it("saves dictionary face choices as fields and keeps the remaining clothing text", async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole("button", { name: "设计面板" }));
    act(() => designDetailsEditor().chain().selectAll().insertContent({ type: "text", text: "靛蓝外衣，素面布靴。 /面容" }).run());
    fireEvent.click(await screen.findByRole("option", { name: /^面容$/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "肤质" }), { target: { value: "轻微干燥肤质" } });
    fireEvent.change(screen.getByRole("combobox", { name: "肤色" }), { target: { value: "暖小麦肤色" } });
    fireEvent.click(screen.getByRole("button", { name: "应用配置" }));
    expect(screen.getByRole("textbox", { name: "设计字段 · 肤质" })).toHaveValue("面颊皮肤略显干燥，保留细微干燥纹理");
    expect(screen.getByRole("textbox", { name: "其他已输入细节" })).toHaveValue("靛蓝外衣，素面布靴。");
    fireEvent.click(screen.getByRole("button", { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        schema_version: "iframe.character-fields.v1", supplemental_prompt: "靛蓝外衣，素面布靴。",
        dictionary_configurations: [expect.objectContaining({ preset_id: "dictionary.panel.face", selections: { "肤色": "暖小麦肤色", "肤质": "轻微干燥肤质" } })],
        identity: expect.objectContaining({ editor_mode: "fields", features: { skin_tone: "暖小麦肤色", skin_texture: "面颊皮肤略显干燥，保留细微干燥纹理" } }),
    }) }));
});

it('preserves authored negative prompt arrays through AI, confirmation and reload', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    fireEvent.change(screen.getByRole('textbox', { name: '设计约束 · 必须保留' }), { target: { value: '自然皮肤纹理' } });
    fireEvent.change(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' }), { target: { value: '额外披风\ncartoon' } });
    await submitSimpleDesign();
    const request = apiMocks.agentRequest.mock.calls.find(([path]) => path === '/character-design/draft')![2];
    expect(request.constraints).toEqual({ must_keep: ['自然皮肤纹理'], negative_prompt: ['额外披风', 'cartoon'] });
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.constraints).toEqual(request.constraints);
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent('负面提示词：');
    expect((screen.getByPlaceholderText('Enter your negative prompt (avoid unwanted elements)...') as HTMLTextAreaElement).value).toContain('cartoon');
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: design } });
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('额外披风\ncartoon');
    const result = aiResult() as HTMLTextAreaElement;
    expect(result.value).not.toContain('负面提示词：');
    fireEvent.change(result, { target: { value: '圆脸，素色布衣。' } });
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('额外披风\ncartoon');
});

it('saves clothing panel sections and negative arrays without an AI call', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    act(() => designDetailsEditor().chain().selectAll().insertContent({ type: 'text', text: '/服装' }).run());
    fireEvent.click(await screen.findByRole('option', { name: /^古装外套$/ }));
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    expect((screen.getByRole('textbox', { name: '设计字段 · 服装结构与材质' }) as HTMLTextAreaElement).value).toContain('上身仅有里衣和外衣两件');
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('未指定的中衣、披风、护甲或装饰性叠领');
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.look.features.clothing).toContain('靛蓝色');
    expect(design.constraints.negative_prompt).toEqual(['未指定的中衣、披风、护甲或装饰性叠领']);
    expect(design.design_input.identity.features).toEqual(design.identity.features);
    expect(design.design_input.look.features).toEqual(design.look.features);
    expect(design.design_result.source).toBe('panel');
    expect(design.design_result.prompt).toContain('靛蓝色');
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith('/character-design/'))).toHaveLength(0);
});


it('keeps structured editors collapsed and opens discovery in the main workspace', async () => {
    mountSimpleDesign();
    expect(screen.queryByRole('textbox', { name: '设计字段 · 肤质' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '设计约束 · 负面提示词' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: '角色设计' })).getByRole('button', { name: '面板与模板' }));
    expect(designDetailsEditor().getText()).not.toContain('/');
    const workspace = screen.getByTestId('character-main-workspace');
    const dialog = await screen.findByRole('dialog', { name: '基础面板、词典和 Prompt 模板' });
    expect(workspace).toContainElement(dialog);
    expect(screen.getByRole('region', { name: '角色设计' })).not.toContainElement(dialog);
    fireEvent.click(within(dialog).getByRole('option', { name: '古装鞋履' }));
    expect(within(workspace).getByRole('combobox', { name: '鞋履图案' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭面板' }));
    expect(screen.queryByRole('dialog', { name: '基础面板、词典和 Prompt 模板' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计字段 · 肤质' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭设计面板' }));
    expect(screen.queryByRole('textbox', { name: '设计字段 · 肤质' })).not.toBeInTheDocument();
});

it('opens image Prompt discovery in the main workspace and returns to the image', async () => {
    mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '面板与模板' }));
    const dialog = await screen.findByRole('dialog', { name: '基础面板、词典和 Prompt 模板' });
    expect(screen.getByTestId('character-main-workspace')).toContainElement(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭面板' }));
    expect(imagePromptInput()).toBeInTheDocument();
});

it('names design constraints and output settings clearly and hides unavailable style actions', () => {
    mountSimpleDesign();
    expect(screen.queryByText('出图设置')).not.toBeInTheDocument();
    openImagePrompt();
    expect(screen.getByRole('textbox', { name: '出图负面提示词' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'copyStyleToPrompt' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '出图负面提示词' })).toBeInTheDocument();
});


it('opens directly into design without mode buttons or an automatic AI request', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    expect(screen.getByRole('region', { name: '角色设计' })).toBeInTheDocument();
    expect(screen.getByText('角色描述 · 设计依据')).toBeInTheDocument();
    expect(designDetailsEditor().getText()).toContain('素黑劲装');
    expect(screen.getByLabelText('设计模型')).toBeInTheDocument();
    for (const name of ['AI 完善角色设计', '展开角色设计', '返回图片 Prompt']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('textbox', { name: '本次出图提示词，@ 检索资产' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('设计模型')).toHaveValue('qwen'));
    expect(apiMocks.agentRequest.mock.calls.filter(([path]) => path.startsWith('/character-design/'))).toHaveLength(0);
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    act(() => designDetailsEditor().commands.setContent('<p>窄袖黑衣，不叠加披风。</p>'));
    expect(screen.getByRole('button', { name: /^应用.*到图片提示词/ })).toBeInTheDocument();
    openImagePrompt();
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(designDetailsEditor().getText()).toBe('窄袖黑衣，不叠加披风。');
});


it('saves input and AI result separately and restores both instead of unsaved AI edits', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    expect(screen.getByRole('button', { name: '编辑已保存设计' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认设计' })).not.toBeInTheDocument();
    const result = await submitSimpleDesign();
    expect(screen.getByRole('tab', { name: 'AI 优化' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('combobox', { name: '设计模型' })).not.toBeInTheDocument();
    fireEvent.change(result, { target: { value: '圆脸，自然肤质，素黑外衣，布靴。' } });
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "角色设计" })).getByRole("status")).toHaveTextContent('当前设计已生效'));
    expect(onUpdateAttributes).toHaveBeenCalledTimes(1);
    expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: true,
        design_input: expect.objectContaining({ prompt: '脸部：眉目清冽。\n服装：素黑劲装，布靴。' }),
        design_result: expect.objectContaining({ source: 'user-edited', prompt: '圆脸，自然肤质，素黑外衣，布靴。' }),
    }) });
    expect(imagePromptInput()).toHaveTextContent('圆脸，自然肤质，素黑外衣，布靴。');
    fireEvent.change(aiResult(), { target: { value: '尚未保存的红衣方案' } });
    const callsBeforeReedit = apiMocks.agentRequest.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '编辑已保存设计' }));
    expect(screen.getByRole('tab', { name: 'AI 优化' })).toHaveAttribute('aria-selected', 'true');
    expect(designDetailsEditor().getText().replace(/\s+/g, ' ').trim()).toBe('脸部：眉目清冽。 服装：素黑劲装，布靴。');
    expect((aiResult() as HTMLTextAreaElement).value).toBe('圆脸，自然肤质，素黑外衣，布靴。');
    expect(apiMocks.agentRequest).toHaveBeenCalledTimes(callsBeforeReedit);
    expect(onUpdateAttributes).toHaveBeenCalledTimes(1);
});

it('reads legacy confirmed designs as an input prompt plus a separate result on reedit', () => {
    const originalInput = '用户原始的面板描述';
    mountSimpleDesign({ character_design: { design_draft: {
        user_visual_requirements: { identity: originalInput, look: '' },
        identity: { features: { face_shape: '圆脸' }, editor_mode: 'fields' },
        look: { features: { clothing: '素黑劲装' }, editor_mode: 'fields' },
        confirmed: true,
    } } });
    fireEvent.click(screen.getByRole('button', { name: '编辑已保存设计' }));
    expect(designDetailsEditor().getText()).toBe(originalInput);
    expect((aiResult() as HTMLTextAreaElement).value).toContain('圆脸');
    expect((aiResult() as HTMLTextAreaElement).value).toContain('素黑劲装');
});

it('keeps authored panel fields intact when AI returns and saves them separately', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    fireEvent.change(screen.getByRole('textbox', { name: '设计字段 · 脸型' }), { target: { value: '圆脸' } });
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭设计面板' }));
    await submitSimpleDesign();
    expect(screen.getByRole('tab', { name: 'AI 优化' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计字段 · 脸型' })).toHaveValue('圆脸');
    fireEvent.click(screen.getByRole('button', { name: '关闭设计面板' }));
    fireEvent.click(screen.getByRole('tab', { name: 'AI 优化' }));
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const saved = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(saved.design_input.identity.features).toEqual({ face_shape: '圆脸' });
    expect(saved.design_input.dictionary_configurations).toEqual([]);
    expect(saved.design_result).toMatchObject({ source: 'ai', prompt: '身份：深棕眼\n造型：黑色劲装' });
    expect(saved.identity.features).toEqual({});
});

it('supports keyboard switching between design tabs without losing edits', async () => {
    mountSimpleDesign();
    act(() => designDetailsEditor().commands.setContent('<p>手工修改的服装设计</p>'));
    const designTab = screen.getByRole('tab', { name: '角色设计' });
    fireEvent.keyDown(designTab, { key: 'ArrowRight' });
    const aiTab = screen.getByRole('tab', { name: 'AI 优化' });
    expect(aiTab).toHaveFocus();
    expect(aiTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(aiTab, { key: 'Home' });
    expect(designTab).toHaveFocus();
    expect(designDetailsEditor().getText()).toBe('手工修改的服装设计');
});


it('restores saved structured fields and constraints when reopening a design', async () => {
    const saved = {
        confirmed: true,
        identity: { features: { face_shape: '圆脸', skin_texture: '自然皮肤纹理' }, editor_mode: 'fields' },
        look: { features: { clothing: '素黑劲装', footwear: '布靴' }, editor_mode: 'fields' },
        constraints: { must_keep: ['自然皮肤纹理'], negative_prompt: ['额外披风'] },
    };
    const { onUpdateAttributes } = mountSimpleDesign({ character_design: { design_draft: saved } });
    await submitSimpleDesign();
    fireEvent.click(screen.getByRole('button', { name: '编辑已保存设计' }));
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计字段 · 脸型' })).toHaveValue('圆脸');
    expect(screen.getByRole('textbox', { name: '设计约束 · 负面提示词' })).toHaveValue('额外披风');
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        identity: expect.objectContaining({ features: saved.identity.features }),
        look: expect.objectContaining({ features: saved.look.features }),
        constraints: saved.constraints, confirmed: true,
    }) }));
});


it('shows design fields only in the design panel and output editing only during generation review', async () => {
    const { onGenerate, onUpdateAttributes } = mountSimpleDesign();
    expect(screen.queryByRole('button', { name: '查看出图提示词' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看结构化字段与约束' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '出图负面提示词' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    const panel = screen.getByRole('dialog', { name: '角色设计面板' });
    expect(screen.getByTestId('character-main-workspace')).toContainElement(panel);
    fireEvent.change(within(panel).getByRole('textbox', { name: '设计字段 · 肤质' }), { target: { value: '保留自然皮肤纹理' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: '设计约束 · 负面提示词' }), { target: { value: '过度磨皮' } });
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '角色设计面板' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设计面板' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const saved = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    openImagePrompt();
    const dialog = screen.getByRole('dialog', { name: '核对图片生成请求' });
    const editor = imagePromptInput() as any;
    act(() => editor.editor.commands.setContent('<p>仅本次出图：全身，白背景。</p>'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: '出图负面提示词' }), { target: { value: '额外披风' } });
    const confirm = within(dialog).getByRole('button', { name: '确认并生成' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('full_body', '仅本次出图：全身，白背景。', false,
        '额外披风', 1, [], 'text', 'reviewed'));
    expect(onUpdateAttributes).toHaveBeenCalledTimes(1);
    expect(saved.identity.features.skin_texture).toBe('保留自然皮肤纹理');
    expect(saved.constraints.negative_prompt).toEqual(['过度磨皮']);
});

it('keeps invalid reference requests editable in review and prevents submitting them', async () => {
    const { onGenerate } = mountSimpleDesign();
    openImagePrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择至少一张参考素材');
    expect(screen.getByRole('button', { name: '确认并生成' })).toBeDisabled();
    expect(imagePromptInput()).toBeInTheDocument();
    expect(onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Text to image' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认并生成' })).toBeEnabled());
});

it('saves human gender and dictionary age and restores them in design and generation', async () => {
    const { onUpdateAttributes } = mountSimpleDesign();
    act(() => designDetailsEditor().chain().selectAll().insertContent({ type: 'text', text: '素色上衣。 /年龄' }).run());
    fireEvent.click(await screen.findByRole('option', { name: /^基础特征$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '年龄阶段' }), { target: { value: '老年' } });
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计字段 · 年龄' })).toHaveValue('人物年龄阶段为老年');
    fireEvent.change(screen.getByRole('textbox', { name: '设计字段 · 性别' }), { target: { value: '女性' } });
    fireEvent.change(screen.getByRole('textbox', { name: '设计字段 · 年龄' }), { target: { value: '约72岁' } });
    fireEvent.click(screen.getByRole('button', { name: /^保存并使用/ }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalled());
    const design = onUpdateAttributes.mock.calls.at(-1)![0].character_design;
    expect(design.identity.features.age).toBe('约72岁');
    expect(design.identity.features.gender).toBe('女性');
    openImagePrompt();
    expect(imagePromptInput()).toHaveTextContent('年龄：约72岁');
    expect(imagePromptInput()).toHaveTextContent('性别：女性');
    cleanup();
    mountSimpleDesign({ character_design: { design_draft: design } });
    fireEvent.click(screen.getByRole('tab', { name: '角色设计' }));
    fireEvent.click(screen.getByRole('button', { name: '设计面板' }));
    expect(screen.getByRole('textbox', { name: '设计字段 · 年龄' })).toHaveValue('约72岁');
    expect(screen.getByRole('textbox', { name: '设计字段 · 性别' })).toHaveValue('女性');
});
