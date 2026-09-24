import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssetDrawer from "./AssetDrawer";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/components/shared/preview/PreviewImage", () => ({
    default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

describe("AssetDrawer product references", () => {
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
