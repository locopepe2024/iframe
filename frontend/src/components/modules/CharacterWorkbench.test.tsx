import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock("next/dynamic", () => ({
    default: () => function DynamicComponent() { return null; },
}));
vi.mock("../common/VariantSelector", () => ({
    VariantSelector: ({ onGenerate }: { onGenerate?: (batchSize: number) => void }) => (
        <button type="button" data-testid="variant-generate" onClick={() => onGenerate?.(1)}>Generate</button>
    ),
}));
vi.mock("../common/VideoVariantSelector", () => ({
    VideoVariantSelector: () => null,
}));
vi.mock("@/lib/api", () => ({ API_URL: "", api: apiMocks }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector({
        currentProject: { id: "project-1" },
        updateProject: vi.fn(),
    }),
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

it("exposes a labelled edit action for the selected character image", () => {
    const onEditImage = vi.fn();
    render(<WorkbenchPanel {...baseProps} editImageUrl="/files/character.png" onEditImage={onEditImage} />);

    fireEvent.click(screen.getByRole("button", { name: "title: Full body" }));

    expect(onEditImage).toHaveBeenCalledTimes(1);
});

it("does not offer editing when a panel has no selected image", () => {
    render(<WorkbenchPanel {...baseProps} editImageUrl={undefined} onEditImage={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "title: Full body" })).not.toBeInTheDocument();
});

it("uploads a new image directly from the static asset panel", async () => {
    const onUploadImage = vi.fn().mockResolvedValue(undefined);
    render(<WorkbenchPanel {...baseProps} onUploadImage={onUploadImage} />);
    const file = new File(["image"], "actor.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("uploadRef: Full body"), { target: { files: [file] } });

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledWith(file));
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
    fireEvent.mouseDown(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("option"));

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
    const editors = screen.getAllByRole("textbox") as Array<HTMLElement & { editor: import("@tiptap/core").Editor }>;
    act(() => { editors[0].editor.commands.setContent("<p>@wat</p>"); });
    expect(await screen.findByRole("listbox")).toHaveTextContent("Pocket watch");
    fireEvent.mouseDown(screen.getByRole("option"));
    fireEvent.click(screen.getByRole("option"));
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

it("builds Chinese character defaults without duplicate punctuation", () => {
    const prompt = buildCharacterImagePrompt(
        "full_body",
        "周涵（大学时期）",
        "黑色短发，五官端正，身材高挑匀称，外形阳光帅气，具有年轻大学生的清爽气质。",
    );

    expect(prompt).toContain("全身角色设计：周涵（大学时期）");
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
