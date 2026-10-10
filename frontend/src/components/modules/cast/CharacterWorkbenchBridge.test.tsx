// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { updateAssetAttributes, updateProject } = vi.hoisted(() => ({ updateAssetAttributes: vi.fn(), updateProject: vi.fn() }));

const project = { id: "project", style_preset: "realistic", characters: [{ id: "character", name: "Test", description: "A character" }] };
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: any) => unknown) => selector({ currentProject: project, updateProject, addGeneratingTask: vi.fn(), removeGeneratingTask: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ api: { generateAsset: vi.fn(), getTaskStatus: vi.fn(), getProject: vi.fn(), updateAssetDescription: vi.fn(), updateAssetAttributes }, }));
vi.mock("@/lib/modelCatalog", () => ({ resolveAssetGenerationModel: vi.fn(() => "test-model") }));
vi.mock("@/components/modules/CharacterWorkbench", () => ({ default: ({ asset, onRename }: any) => <div data-testid="canonical-character-workbench">{asset.name}<button onClick={() => void onRename("New name")}>rename</button></div> }));

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
