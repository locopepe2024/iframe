import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssetDrawer from "./AssetDrawer";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/components/shared/AssetIndexPreview", () => ({
    AssetIndexPreview: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

describe("AssetDrawer product references", () => {
    it("selects a frame variant by asset and variant identity even when names match", () => {
        const onSelectFrameVariant = vi.fn();
        const assetIndex = ["actor-a", "actor-b"].map((asset_id) => ({
            asset_type: "character" as const, asset_id, name: "同名角色",
            source_scope: "episode" as const,
            variants: [{ id: `${asset_id}-front`, url: `${asset_id}.png` }],
        }));
        render(<AssetDrawer isOpen onClose={vi.fn()} characters={[]} scenes={[]} props={[]}
            assetIndex={assetIndex} frameSlot="last" onSelectAsset={vi.fn()}
            onSelectFrameVariant={onSelectFrameVariant} />);
        fireEvent.click(screen.getByRole("button", { name: "同名角色 变体 actor-b-front" }));
        expect(onSelectFrameVariant).toHaveBeenCalledWith(assetIndex[1], "actor-b-front");
    });

    it("lets one product expose multiple per-shot view choices", () => {
        const onToggleVariant = vi.fn();
        render(
            <AssetDrawer
                isOpen
                onClose={vi.fn()}
                characters={[]}
                scenes={[]}
                props={[{
                    id: "product",
                    name: "穿心莲",
                    image_asset: {
                        selected_id: "front",
                        variants: [
                            { id: "front", url: "front.jpg", reference_view_role: "front" },
                            { id: "right", url: "right.jpg", reference_view_role: "right" },
                        ],
                    },
                }]}
                assetIndex={[{
                    asset_type: "prop", asset_id: "product", name: "穿心莲",
                    source_scope: "series", selected_variant_id: "front",
                    variants: [
                        { id: "front", url: "front.jpg", reference_view_role: "front" },
                        { id: "right", url: "right.jpg", reference_view_role: "right" },
                    ],
                }]}
                onSelectAsset={vi.fn()}
                selectedVariantIds={{ product: ["front", "right"] }}
                onToggleVariant={onToggleVariant}
            />,
        );
        const right = screen.getByTitle("right");
        expect(right).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(right);
        expect(onToggleVariant).toHaveBeenCalledWith("product", "right", "front");
    });
});

it("shows only project and inherited series assets, excluding reusable global candidates", () => {
    const entry = (id: string, source_scope: "episode" | "series" | "global") => ({
        asset_type: "character" as const, asset_id: id, name: id,
        source_scope, variants: [],
    });
    render(<AssetDrawer isOpen onClose={vi.fn()} characters={[]} scenes={[]} props={[]}
        assetIndex={[entry("Project actor", "episode"), entry("Series actor", "series"), entry("Global candidate", "global")]}
        onSelectAsset={vi.fn()} />);
    expect(screen.getByText("Project actor")).toBeInTheDocument();
    expect(screen.getByText("Series actor")).toBeInTheDocument();
    expect(screen.queryByText("Global candidate")).not.toBeInTheDocument();
});

it("keeps the asset drawer open and reports an attach failure so selection can be retried", async () => {
    const onClose = vi.fn();
    const onSelectFrameVariant = vi.fn()
        .mockRejectedValueOnce(new Error("Asset image not found"))
        .mockResolvedValueOnce(undefined);
    render(<AssetDrawer isOpen onClose={onClose} characters={[]} scenes={[]} props={[]}
        assetIndex={[{ asset_type: "scene", asset_id: "scene-1", name: "长街",
            source_scope: "episode", variants: [{ id: "v1", url: "expired-url" }] }]}
        frameSlot="first" onSelectAsset={vi.fn()} onSelectFrameVariant={onSelectFrameVariant} />);
    const variant = screen.getByRole("button", { name: "长街 变体 v1" });
    fireEvent.click(variant);
    expect(await screen.findByRole("alert")).toHaveTextContent("Asset image not found");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(variant);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
