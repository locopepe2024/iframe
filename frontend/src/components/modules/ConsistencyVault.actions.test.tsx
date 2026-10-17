import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AssetCard, CharacterDetailModal } from "./ConsistencyVault";
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

it("places lighting and camera beside scene references and binds the chosen scene variant", () => {
    const generate = vi.fn();
    render(<CharacterDetailModal
        asset={{ id: "scene-1", name: "街道", description: "夜景", image_asset: { variants: [{ id: "scene-v1", url: "/scene.png" }] } }}
        type="scene" onClose={vi.fn()} onUpdateDescription={vi.fn()} onGenerate={generate} isGenerating={false}
    />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Image Reference", "Video Reference", "光影", "镜头"]);
    fireEvent.click(screen.getByRole("tab", { name: "光影" }));
    fireEvent.click(screen.getByRole("button", { name: "生成光影候选" }));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("调整场景打光"), false, expect.any(String), 1,
        [{ asset_type: "scene", asset_id: "scene-1", variant_id: "scene-v1" }], "reference");
    fireEvent.click(screen.getByRole("tab", { name: "镜头" }));
    expect(screen.getByRole("button", { name: "生成镜头候选" })).toBeEnabled();
});
