// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import AssetChipBar from "./AssetChipBar";

vi.mock("@/components/shared/preview/PreviewImage", () => ({ default: ({ alt }: any) => <span>{alt}</span> }));

it("inserts one semantic asset while selecting multiple child views", () => {
    const insert = vi.fn();
    const toggle = vi.fn();
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <AssetChipBar
                characters={[]}
                scenes={[]}
                props={[{ id: "product", name: "穿心莲", image_asset: {
                    selected_id: "front",
                    variants: [
                        { id: "front", url: "front.png", reference_view_role: "front" },
                        { id: "medium", url: "medium.png", reference_distance: "medium" },
                        { id: "close", url: "close.png", reference_distance: "close" },
                    ],
                } }]}
                selectedVariantIds={{ product: ["front", "medium"] }}
                onInsertAsset={insert}
                onToggleVariant={toggle}
            />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "穿心莲" }));
    expect(insert).toHaveBeenCalledWith("prop", "穿心莲");
    fireEvent.click(screen.getByRole("button", { name: "Select reference views for 穿心莲" }));
    expect(screen.getByRole("button", { name: "front" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "close" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(toggle).toHaveBeenCalledWith("product", "close", "front");
});
