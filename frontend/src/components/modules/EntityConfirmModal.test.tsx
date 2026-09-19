// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import EntityConfirmModal from "./EntityConfirmModal";

const preview = {
    characters: [{ name: "Host", description: "Presenter" }],
    scenes: [{ name: "Studio" }],
    props: [{ name: "Product" }],
};

it("submits natural-language revisions while keeping apply explicit", async () => {
    const refine = vi.fn().mockResolvedValue(undefined);
    const apply = vi.fn();
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <EntityConfirmModal
                isOpen
                preview={preview}
                currentCounts={{ characters: 0, scenes: 0, props: 0 }}
                onConfirm={apply}
                onDiscard={() => {}}
                onRefine={refine}
                feedback={[]}
                isRefining={false}
            />
        </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Merge duplicate hosts" } });
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
    await waitFor(() => expect(refine).toHaveBeenCalledWith("Merge duplicate hosts"));
    expect(apply).not.toHaveBeenCalled();
});

it("disables applying a stale draft while a refinement is running", () => {
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <EntityConfirmModal
                isOpen
                preview={preview}
                currentCounts={{ characters: 1, scenes: 1, props: 1 }}
                onConfirm={() => {}}
                onDiscard={() => {}}
                onRefine={vi.fn()}
                feedback={["Exclude extras"]}
                isRefining
            />
        </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Apply to Cast" })).toBeDisabled();
    expect(screen.getByText("Exclude extras")).toBeTruthy();
});
