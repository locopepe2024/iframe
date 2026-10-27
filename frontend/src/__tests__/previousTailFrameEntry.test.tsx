// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import T2ISubsection from "@/components/modules/storyboard-r2v/shot-panel/T2ISubsection";

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

it("offers the previous tail in empty and selected first-frame states", () => {
    const onUsePreviousEndFrame = vi.fn();
    const { rerender } = render(
        <T2ISubsection {...common} imageUrls={[]} onUsePreviousEndFrame={onUsePreviousEndFrame} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "usePrevEndFrame" }));
    rerender(<T2ISubsection {...common} imageUrls={["https://example.com/first.webp"]}
        onUsePreviousEndFrame={onUsePreviousEndFrame} />);
    fireEvent.click(screen.getByRole("button", { name: "usePrevEndFrame" }));
    expect(onUsePreviousEndFrame).toHaveBeenCalledTimes(2);
});

it("shows the lock requirement and blocks extraction in either state", () => {
    const onUsePreviousEndFrame = vi.fn();
    const reason = "Pin a completed take in the previous shot first";
    const { rerender } = render(
        <T2ISubsection {...common} imageUrls={[]} onUsePreviousEndFrame={onUsePreviousEndFrame}
            previousEndFrameUnavailableReason={reason} />,
    );
    expect(screen.getByRole("button", { name: "usePrevEndFrame" })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    rerender(<T2ISubsection {...common} imageUrls={["first.webp"]}
        onUsePreviousEndFrame={onUsePreviousEndFrame} previousEndFrameUnavailableReason={reason} />);
    expect(screen.getByRole("button", { name: "usePrevEndFrame" })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(onUsePreviousEndFrame).not.toHaveBeenCalled();
});
