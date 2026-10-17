import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    previewAssetImageSubmission: vi.fn((_id: string, request: any) => Promise.resolve({
        positive_prompt: request.prompt, negative_prompt: request.negative_prompt,
        selected_model_id: "test-model", aspect_ratio: "9:16",
        generation_type: request.generation_type, image_generation_mode: request.image_generation_mode,
        batch_size: request.batch_size, reference_inputs: request.reference ? [request.reference] : request.references || [],
        design_revision_at_submission: null, fingerprint: "reviewed",
    })),
    agentRequest: vi.fn((path: string) => path === "/models"
        ? Promise.resolve({ models: [{ api_model_id: "qwen", display_name: "Qwen" }] })
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
    VariantSelector: ({ onGenerate, filmstripTitle }: { onGenerate?: (batchSize: number) => void; filmstripTitle?: string }) => (
        <div>
            <span>{filmstripTitle}</span>
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

it("keeps an AI design as an editable draft until the user confirms it", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const onUpdateAttributes = vi.fn().mockResolvedValue(undefined);
    const onGenerate = vi.fn();
    render(<CharacterWorkbench asset={{ id: "character-1", name: "Hero", description: "A hero" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onUpdateAttributes={onUpdateAttributes}
        onGenerate={onGenerate} generatingTypes={[]} />);

    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    const editor = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    expect(editor.editor.getText()).not.toContain("深棕眼");
    fireEvent.click(screen.getByRole("button", { name: "生成草稿" }));
    await waitFor(() => expect(screen.getByLabelText("身份视觉值")).toHaveValue("深棕眼"));
    expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.objectContaining({
        profile: "A hero",
        current_draft: "",
        user_answers: {},
    }));
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    expect(editor.editor.getText()).toContain("深棕眼");

    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: true,
        skill_revision: "skill-hash",
        field_status: expect.objectContaining({ visual_notes: "creative-choice" }),
    }) }));
    await waitFor(() => expect(screen.getByText("已确认 r1")).toBeInTheDocument());
    expect(editor.editor.getText()).toContain("深棕眼");
    expect(editor.editor.getText()).toContain("黑色劲装");
});

it("uses visual fields as editable inputs before generating a draft", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const onUpdateAttributes = vi.fn().mockResolvedValue(undefined);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onUpdateAttributes={onUpdateAttributes}
        onGenerate={vi.fn()} generatingTypes={[]} />);

    const identity = screen.getByLabelText("身份视觉值");
    const look = screen.getByLabelText("造型视觉值");
    const generate = screen.getByRole("button", { name: "生成草稿" });
    expect(identity.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(look.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(identity, { target: { value: "日晒肤色，宽肩长腿" } });
    fireEvent.change(look, { target: { value: "宋代服装，长柄双手剑" } });
    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    fireEvent.click(generate);

    await waitFor(() => expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.objectContaining({
        current_draft: "",
        user_visual_requirements: { identity: "日晒肤色，宽肩长腿", look: "宋代服装，长柄双手剑" },
    })));
    await waitFor(() => expect((identity as HTMLTextAreaElement).value).toContain("日晒肤色，宽肩长腿"));
    expect((look as HTMLTextAreaElement).value).toContain("宋代服装，长柄双手剑");
    expect(onUpdateAttributes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        user_visual_requirements: { identity: "日晒肤色，宽肩长腿", look: "宋代服装，长柄双手剑" },
        confirmed: false,
    }) }));
});

it("lets the user answer a design conflict and carries answers into confirmed prompts", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const question = "剧本写十六岁，但确认设计为二十四岁，两者冲突";
    const onUpdateAttributes = vi.fn().mockResolvedValue(undefined);
    render(<CharacterWorkbench asset={{
        id: "character-1", name: "苏砚", description: "少年剑客",
        character_design: { design_draft: {
            route: "historical-costume", age_stage: "young-adult",
            identity: { visual_notes: "短黑发，沉静面容" },
            look: { visual_notes: "素黑色劲装" },
            unresolved: [question], confirmed: false,
        }, design_revisions: [] },
    }} onClose={vi.fn()} onUpdateDescription={vi.fn()} onUpdateAttributes={onUpdateAttributes} onGenerate={vi.fn()} generatingTypes={[]} />);

    expect(screen.getByRole("button", { name: /dossier/ })).toHaveTextContent("pendingDesignQuestions");

    fireEvent.change(screen.getByPlaceholderText(/可直接修改建议|补充你的决定/), { target: { value: "按十七岁少年表现，身形尚未完全长成" } });
    fireEvent.click(screen.getByRole("button", { name: "确认设计" }));

    await waitFor(() => expect(onUpdateAttributes).toHaveBeenCalledWith({ character_design: expect.objectContaining({
        confirmed: true,
        unresolved: [],
        field_answers: { [question]: "按十七岁少年表现，身形尚未完全长成" },
    }) }));
    await waitFor(() => expect(screen.getByText("已确认 r1")).toBeInTheDocument());
    const editor = screen.getByRole("textbox", { name: "Enter prompt description..." });
    expect(editor).toHaveTextContent("按十七岁少年表现，身形尚未完全长成");
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

it("applies edited identity and look values to image prompts without saving a revision", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const onUpdateAttributes = vi.fn().mockResolvedValue(undefined);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onUpdateAttributes={onUpdateAttributes}
        onGenerate={vi.fn()} generatingTypes={[]} />);

    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    fireEvent.change(screen.getByLabelText("身份视觉值"), { target: { value: "窄长脸，深棕眼，短黑发" } });
    fireEvent.change(screen.getByLabelText("造型视觉值"), { target: { value: "黑色窄袖劲装，哑光棉布，布靴" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));

    const editor = screen.getByRole("textbox", { name: "Enter prompt description..." });
    expect(editor).toHaveTextContent("窄长脸，深棕眼，短黑发");
    expect(editor).toHaveTextContent("黑色窄袖劲装，哑光棉布，布靴");
    fireEvent.click(screen.getByRole("tab", { name: "threeViews" }));
    expect(screen.getByRole("textbox", { name: "Enter prompt description..." })).toHaveTextContent("黑色窄袖劲装，哑光棉布，布靴");
    fireEvent.click(screen.getByRole("tab", { name: "avatar" }));
    expect(screen.getByRole("textbox", { name: "Enter prompt description..." })).toHaveTextContent("窄长脸，深棕眼，短黑发");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
});

it("lets the user adopt an Agent suggestion for a genuine character decision", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [] } as any);
    const defaultAgentRequest = apiMocks.agentRequest.getMockImplementation();
    const designResult = {
            identity: { visual_notes: "少年感面容，短黑发", basis: ["creative_choice"] },
            look: { visual_notes: "窄袖黑色劲装，哑光布面，布靴", basis: ["script_fact", "creative_choice"] },
            unresolved: ["剧本写少年，但年龄阶段选择为青年"],
            field_suggestions: { "剧本写少年，但年龄阶段选择为青年": "十七八岁少年感，脸部线条尚未完全成熟。" },
            field_suggestion_choices: { "剧本写少年，但年龄阶段选择为青年": { age_stage: "teen" } },
            skill_revision: "skill-hash",
        };
    apiMocks.agentRequest.mockImplementation((path: string) => path === "/models"
        ? Promise.resolve({ models: [{ api_model_id: "qwen", display_name: "Qwen" }] })
        : Promise.resolve(designResult as any));
    const onUpdateAttributes = vi.fn();
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onUpdateAttributes={onUpdateAttributes}
        onGenerate={vi.fn()} generatingTypes={[]} />);

    await waitFor(() => expect(screen.getByLabelText("设计模型")).toHaveValue("qwen"));
    fireEvent.click(screen.getByRole("button", { name: "生成草稿" }));
    await waitFor(() => expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.anything()));
    await waitFor(() => expect(screen.getByLabelText("身份视觉值")).toHaveValue("少年感面容，短黑发"));
    fireEvent.click(screen.getByText("采用此建议"));
    expect(screen.getByLabelText("年龄阶段")).toHaveValue("teen");
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));

    expect(screen.getByRole("textbox", { name: "Enter prompt description..." })).toHaveTextContent("十七八岁少年感");
    expect(screen.getByRole("textbox", { name: "Enter prompt description..." })).toHaveTextContent("少年少女年龄表现");
    expect(screen.getByRole("textbox", { name: "Enter prompt description..." })).not.toHaveTextContent("青年年龄表现");
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    apiMocks.agentRequest.mockImplementation(defaultAgentRequest!);
});

it("searches current project materials and passes selected reference IDs to design drafting", async () => {
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({ assets: [{
        asset_type: "character", asset_id: "ref-character", name: "苏砚定妆照", source_scope: "episode",
        variants: [{ id: "front-view", url: "/files/front.png" }],
    }] } as any);
    render(<CharacterWorkbench asset={{ id: "character-1", name: "苏砚", description: "少年剑客" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]} />);

    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledWith("project-1"));
    fireEvent.click(screen.getByRole("button", { name: "选择角色参考图" }));
    fireEvent.change(screen.getByLabelText("搜索角色参考素材"), { target: { value: "苏砚" } });
    fireEvent.click(await screen.findByRole("option", { name: /苏砚定妆照/ }));
    fireEvent.click(screen.getByRole("button", { name: "生成草稿" }));

    await waitFor(() => expect(apiMocks.agentRequest).toHaveBeenCalledWith("/character-design/draft", "POST", expect.objectContaining({
        project_id: "project-1",
        reference_assets: [{ asset_type: "character", asset_id: "ref-character", variant_id: "front-view" }],
    })));
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

it("keeps shooting-plan constraints collapsed in the workbench header", () => {
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
    expect(screen.getByText("2018年秋天 · 室外")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加入提示词" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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
