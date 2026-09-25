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
                assetIndex={[{
                    asset_type: "prop", asset_id: "product", name: "穿心莲",
                    source_scope: "series", selected_variant_id: "front",
                    variants: [
                        { id: "front", url: "front.png", reference_view_role: "front" },
                        { id: "medium", url: "medium.png", reference_distance: "medium" },
                        { id: "close", url: "close.png", reference_distance: "close" },
                    ],
                }]}
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

it("does not offer historical character variants as multiple storyboard references", () => {
    const toggle = vi.fn();
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <AssetChipBar
                characters={[{ id: "character", name: "谭瑞齐（归国时期）" }]}
                scenes={[]}
                props={[]}
                assetIndex={[{
                    asset_type: "character", asset_id: "character", name: "谭瑞齐（归国时期）",
                    source_scope: "series", selected_variant_id: "current",
                    variants: [
                        { id: "current", url: "current.jpg" },
                        { id: "old-1", url: "old-1.jpg" },
                        { id: "old-2", url: "old-2.jpg" },
                        { id: "old-3", url: "old-3.jpg" },
                        { id: "old-4", url: "old-4.jpg" },
                    ],
                }]}
                onInsertAsset={vi.fn()}
                onToggleVariant={toggle}
            />
        </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("button", { name: "Select reference views for 谭瑞齐（归国时期）" })).toBeNull();
    expect(screen.getByRole("button", { name: "谭瑞齐（归国时期）" })).toBeTruthy();
    expect(toggle).not.toHaveBeenCalled();
});
