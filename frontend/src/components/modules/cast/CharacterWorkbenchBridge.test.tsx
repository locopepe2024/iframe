// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { updateAssetAttributes, updateProject, generateAsset } = vi.hoisted(() => ({ updateAssetAttributes: vi.fn(), updateProject: vi.fn(), generateAsset: vi.fn() }));

const project = { id: "project", style_preset: "realistic", art_direction: { style_config: {
    positive_prompt: "Hidden warm light", negative_prompt: "Hidden negative",
} }, characters: [{ id: "character", name: "Test", description: "A character" }] };
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: any) => unknown) => selector({ currentProject: project, updateProject, addGeneratingTask: vi.fn(), removeGeneratingTask: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ api: { generateAsset, getTaskStatus: vi.fn(), getProject: vi.fn(), updateAssetDescription: vi.fn(), updateAssetAttributes }, }));
vi.mock("@/lib/modelCatalog", () => ({ resolveAssetGenerationModel: vi.fn(() => "test-model") }));
vi.mock("@/components/modules/CharacterWorkbench", () => ({ default: ({ asset, onRename, onGenerate }: any) => <div data-testid="canonical-character-workbench">{asset.name}<button onClick={() => void onRename("New name")}>rename</button><button onClick={() => void onGenerate("reference_sheet", "Reviewed blue portrait", true, "red robe", 1)}>generate</button><button onClick={() => void onGenerate("three_view", "Reviewed three view", false, "blur", 1, [{ asset_type: "character", asset_id: "character", variant_id: "master-1" }], "reference", "reviewed")}>derived</button></div> }));

import CharacterWorkbenchBridge from "./CharacterWorkbenchBridge";

it("renders the canonical CharacterWorkbench for the Cast character entry", () => {
    render(<CharacterWorkbenchBridge entityId="character" onClose={vi.fn()} />);
    expect(screen.getByTestId("canonical-character-workbench")).toHaveTextContent("Test");
});

it("saves a name change through the Cast workbench", async () => {
    updateAssetAttributes.mockResolvedValue(project);
    render(<CharacterWorkbenchBridge entityId="character" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    await waitFor(() => expect(updateAssetAttributes).toHaveBeenCalledWith("project", "character", "character", { name: "New name" }));
    expect(updateProject).toHaveBeenCalledWith("project", project);
});

it("does not add hidden style text when the canonical workbench submits", async () => {
    generateAsset.mockResolvedValue(project);
    render(<CharacterWorkbenchBridge entityId="character" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "generate" }));
    await waitFor(() => expect(generateAsset).toHaveBeenCalled());
    const args = generateAsset.mock.calls[0];
    expect(args[4]).toBe("");
    expect(args[6]).toBe("Reviewed blue portrait");
    expect(args[7]).toBe(false);
    expect(args[8]).toBe("red robe");
    expect(args[15]).toBe(true);
});

it("sends a derived character master as one stable reference", async () => {
    generateAsset.mockReset().mockResolvedValue(project);
    render(<CharacterWorkbenchBridge entityId="character" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "derived" }));
    await waitFor(() => expect(generateAsset).toHaveBeenCalled());
    const args = generateAsset.mock.calls[0];
    expect(args[12]).toEqual({ asset_type: "character", asset_id: "character", variant_id: "master-1" });
    expect(args[13]).toEqual([]);
    expect(args[14]).toBe("reference");
    expect(args[16]).toBe("reviewed");
});
