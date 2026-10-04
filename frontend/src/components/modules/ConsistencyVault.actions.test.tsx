import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AssetCard } from "./ConsistencyVault";
import EpisodeAssetPlanPanel from "./EpisodeAssetPlanPanel";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector({ currentProject: null, updateProject: vi.fn() }),
}));

it("opens the asset workbench from the cover action without submitting generation", () => {
    const open = vi.fn();
    render(<AssetCard asset={{ id: "char-1", name: "周涵", description: "大学时期" }} type="character"
        isGenerating={false} onClick={open} onToggleLock={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "设计" }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
});

it("passes a scene entry to creation without appending its text to a prompt", () => {
    const create = vi.fn();
    const entry = { key: "scene-29:character:0", sceneId: "scene-29", sceneLabel: "29、街上", details: ["北京", "冬季"], prompt: "拍摄计划场景「29、街上」：北京；冬季" };
    render(<EpisodeAssetPlanPanel entries={[entry]} onUse={create} />);
    fireEvent.click(screen.getByRole("button", { name: "新建场景资产" }));
    expect(create).toHaveBeenCalledWith(entry);
});
