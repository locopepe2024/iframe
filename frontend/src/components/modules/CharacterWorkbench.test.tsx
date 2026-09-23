import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CharacterWorkbench, { WorkbenchPanel } from "./CharacterWorkbench";
import {
    buildCharacterImagePrompt,
    buildCharacterMotionPrompt,
    buildCharacterVideoPrompt,
    DEFAULT_CHARACTER_NEGATIVE_PROMPT,
} from "@/lib/characterPrompts";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock("next/dynamic", () => ({
    default: () => function DynamicComponent() { return null; },
}));
vi.mock("../common/VariantSelector", () => ({
    VariantSelector: () => null,
}));
vi.mock("../common/VideoVariantSelector", () => ({
    VideoVariantSelector: () => null,
}));
vi.mock("@/lib/api", () => ({ api: {} }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector({}),
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

it("unlocks derived asset prompts when the canonical reference sheet is available", () => {
    render(
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

    const promptFields = screen.getAllByPlaceholderText("Enter prompt description...");
    expect(promptFields).toHaveLength(3);
    expect(promptFields[1]).not.toBeDisabled();
    expect(promptFields[2]).not.toBeDisabled();
    expect(screen.queryByText("Generate Master Asset first")).not.toBeInTheDocument();
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
