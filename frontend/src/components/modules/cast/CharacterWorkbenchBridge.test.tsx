// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const project = { id: "project", style_preset: "realistic", characters: [{ id: "character", name: "Test", description: "A character" }] };
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: any) => unknown) => selector({ currentProject: project, updateProject: vi.fn(), addGeneratingTask: vi.fn(), removeGeneratingTask: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ api: { generateAsset: vi.fn(), getTaskStatus: vi.fn(), getProject: vi.fn(), updateAssetDescription: vi.fn() }, }));
vi.mock("@/lib/modelCatalog", () => ({ resolveAssetGenerationModel: vi.fn(() => "test-model") }));
vi.mock("@/components/modules/CharacterWorkbench", () => ({ default: ({ asset }: any) => <div data-testid="canonical-character-workbench">{asset.name}</div> }));

import CharacterWorkbenchBridge from "./CharacterWorkbenchBridge";

it("renders the canonical CharacterWorkbench for the Cast character entry", () => {
    render(<CharacterWorkbenchBridge entityId="character" onClose={vi.fn()} />);
    expect(screen.getByTestId("canonical-character-workbench")).toHaveTextContent("Test");
});
