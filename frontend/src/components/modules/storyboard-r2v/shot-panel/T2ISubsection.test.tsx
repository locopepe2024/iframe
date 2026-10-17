import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import T2ISubsection from "./T2ISubsection";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/shared/preview/PreviewImage", () => ({ default: () => null }));

const common = {
    selectedIndex: 0,
    promptIsEmpty: false,
    generating: false,
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onGenerate: vi.fn(),
    onUpload: vi.fn(),
};

it("labels an empty FL2V ending image as step 2", () => {
    render(<T2ISubsection {...common} imageUrls={[]} frameLabel="尾帧" />);
    expect(screen.getByText("lastFrameHeroEyebrow")).toBeInTheDocument();
    expect(screen.getByText("lastFrameHeroBody")).toBeInTheDocument();
});

it("keeps the ending image at step 2 after selecting a candidate", () => {
    render(<T2ISubsection {...common} imageUrls={["https://example.com/last.webp"]} frameLabel="尾帧" />);
    expect(screen.getByText("Step 2 · 尾帧 · t2iStepOneDone")).toBeInTheDocument();
});
