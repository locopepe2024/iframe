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
vi.mock("@/lib/api", () => ({ API_URL: "", api: apiMocks, agentRequest: apiMocks.agentRequest }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector(projectStoreMocks),
}));
vi.mock("@/store/toastStore", () => ({ toast: { success: vi.fn() } }));

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
    expect(screen.queryByText("2018年秋天 · 室外")).not.toBeInTheDocument();
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
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce({
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
    act(() => { promptEditor!.editor!.commands.setContent("<p>@wat</p>"); });
    expect(await screen.findByRole("listbox")).toHaveTextContent("Pocket watch");
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.click(screen.getAllByRole("button", { name: "Reference image" })[0]);
    fireEvent.click(screen.getAllByTestId("variant-generate")[0]);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
        "full_body",
        "@Pocket watch ",
        true,
        expect.any(String),
        1,
        [{ asset_type: "prop", asset_id: "watch-1", variant_id: "watch-front" }],
        "reference",
    ));
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
    expect(onUpdateAttributes).not.toHaveBeenCalled();
    expect(editor.editor.getText()).not.toContain("深棕眼");

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
        .mockResolvedValueOnce(indexWithNewView);
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
    act(() => { editor!.editor!.commands.setContent("<p>@Hero</p>"); });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.click(screen.getAllByRole("button", { name: "Reference image" })[0]);
    fireEvent.click(screen.getAllByTestId("variant-generate")[0]);

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
        "full_body",
        "@Hero ",
        true,
        expect.any(String),
        1,
        [{ asset_type: "character", asset_id: "character-1", variant_id: "new-view" }],
        "reference",
    ));
});

it("does not refetch references for an equivalent project snapshot or discard them on refresh failure", async () => {
    apiMocks.getAssetReferenceIndex.mockReset();
    const index = { assets: [{
        asset_type: "character", asset_id: "character-1", name: "Hero", source_scope: "series",
        variants: [{ id: "view-1", url: "/files/view-1.png" }],
    }] };
    apiMocks.getAssetReferenceIndex.mockResolvedValueOnce(index).mockRejectedValueOnce(new Error("temporary failure"));
    projectStoreMocks.currentProject = { id: "project-1", characters: [{ id: "character-1" }] };
    const view = () => <CharacterWorkbench
        asset={{ id: "character-1", name: "Hero", description: "A hero" }}
        onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={vi.fn()} generatingTypes={[]}
    />;
    const { rerender } = render(view());
    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(1));

    projectStoreMocks.currentProject = { id: "project-1", characters: [{ id: "character-1" }] };
    rerender(view());
    expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(1);

    projectStoreMocks.currentProject = { id: "project-1", characters: [{ id: "character-1", updated_at: 2 }] };
    rerender(view());
    await waitFor(() => expect(apiMocks.getAssetReferenceIndex).toHaveBeenCalledTimes(2));
    const editor = document.querySelector("[contenteditable]") as HTMLElement & { editor: import("@tiptap/core").Editor };
    act(() => { editor.editor.commands.setContent("<p>@</p>"); });
    expect(screen.getByRole("option", { name: /Hero/ })).toHaveTextContent("Hero");
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
