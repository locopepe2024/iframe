import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkbenchPanel } from "./CharacterWorkbench";

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
