// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import StoryboardAnalysisModal from "./StoryboardAnalysisModal";

const draft = [{
    scene_ref_name: "Studio",
    action_summary: "Host presents the product",
    duration: 5,
}];

it("keeps storyboard application explicit while accepting direction", async () => {
    const refine = vi.fn().mockResolvedValue(undefined);
    const apply = vi.fn().mockResolvedValue(undefined);
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <StoryboardAnalysisModal
                isOpen
                draft={draft}
                feedback={[]}
                existingShotCount={3}
                isBusy={false}
                onRefine={refine}
                onApply={apply}
                onDiscard={() => {}}
            />
        </NextIntlClientProvider>,
    );
    expect(screen.getByText("Host presents the product")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Direction request"), {
        target: { value: "Split the product close-up into its own shot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send direction request" }));
    await waitFor(() => expect(refine).toHaveBeenCalledWith("Split the product close-up into its own shot"));
    expect(apply).not.toHaveBeenCalled();
});

it("prevents applying a stale draft during refinement", () => {
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <StoryboardAnalysisModal
                isOpen
                draft={draft}
                feedback={["Keep total duration"]}
                existingShotCount={0}
                isBusy
                onRefine={vi.fn()}
                onApply={vi.fn()}
                onDiscard={() => {}}
            />
        </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Apply to storyboard" })).toBeDisabled();
    expect(screen.getByText("Keep total duration")).toBeTruthy();
});
