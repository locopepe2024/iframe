import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import ConsistencyVault from "./ConsistencyVault";

const mocks = vi.hoisted(() => ({
    getProject: vi.fn(), getSeries: vi.fn(), getEpisodeVisualContext: vi.fn(),
    syncEpisodeAssetsFromShootingPlan: vi.fn(), deleteSeriesAsset: vi.fn(),
    deleteCharacter: vi.fn(), deleteScene: vi.fn(), deleteProp: vi.fn(),
    error: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ API_URL: "", authenticatedFetch: vi.fn(), api: mocks, crudApi: mocks }));
vi.mock("@/store/toastStore", () => ({ toast: { error: mocks.error } }));
vi.mock("./CharacterWorkbench", () => ({ default: () => null }));
vi.mock("../common/VariantSelector", () => ({ VariantSelector: () => null }));
vi.mock("../common/VideoVariantSelector", () => ({ VideoVariantSelector: () => null }));
vi.mock("../modals/UploadAssetModal", () => ({ default: () => null }));
vi.mock("./playground/ReferencePromptEditor", () => ({ default: () => null }));

function state(assetType: string, assetId: string, bound = true) {
    return {
        context: {
            shooting_plan_revision: 1, scenes: [], shots: [], props: [],
            characters: assetType === "character" ? [{
                person_id: "person-1", person_label: "Hero", character_asset_ids: bound ? [assetId] : [],
                scene_ids: ["scene-1"], shot_ids: ["shot-1"],
            }] : [],
        },
        bindings: bound ? [{ asset_type: assetType, asset_id: assetId, status: "pending",
            scene_ids: ["scene-1"], shot_ids: ["shot-1"] }] : [],
        new_bindings: [], reusable_bindings: [], changed_bindings: [], stale_bindings: [], unresolved_bindings: [],
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
});

it.each([
    ["character", "Characters", "characters", "deleteCharacter"],
    ["scene", "Scenes", "scenes", "deleteScene"],
    ["prop", "Props", "props", "deleteProp"],
] as const)("refreshes plan bindings and series options after deleting a %s", async (type, tab, key, deletion) => {
    const asset = { id: "asset-1", name: "Old asset", source: "series" };
    const project = { id: "episode-1", series_id: "series-1", characters: [], scenes: [], props: [], [key]: [asset] };
    const emptyProject = { ...project, [key]: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getSeries.mockResolvedValueOnce({ [key]: [asset] }).mockResolvedValue({ [key]: [] });
    mocks.getEpisodeVisualContext.mockResolvedValue(state(type, asset.id));
    mocks.syncEpisodeAssetsFromShootingPlan.mockResolvedValueOnce(state(type, asset.id))
        .mockResolvedValue(state(type, asset.id, false));
    mocks.getProject.mockResolvedValueOnce(project).mockResolvedValue(emptyProject);
    render(<ConsistencyVault />);
    await screen.findByRole("region", { name: "拍摄计划资产需求" });
    fireEvent.click(screen.getByRole("button", { name: "从拍摄计划同步" }));
    await screen.findByText("拍摄计划上下文已同步：");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tab) }));
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(mocks.syncEpisodeAssetsFromShootingPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useProjectStore.getState().currentProject?.[key]).toEqual([]));
    expect(mocks.deleteSeriesAsset).toHaveBeenCalledWith("series-1", type, asset.id);
    expect(mocks[deletion]).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("拍摄计划上下文已同步：")).not.toBeInTheDocument());
    if (type === "character") {
        const requirements = screen.getByRole("region", { name: "拍摄计划资产需求" });
        expect(within(requirements).getByText(/待关联角色资产/)).toBeInTheDocument();
        expect(within(requirements).queryByRole("option", { name: /Old asset/ })).not.toBeInTheDocument();
    } else {
        expect(screen.queryByRole("region", { name: "拍摄计划资产需求" })).not.toBeInTheDocument();
    }
    expect(window.alert).not.toHaveBeenCalled();
});

it("keeps a successful local deletion when the plan refresh fails", async () => {
    const project = { id: "episode-1", characters: [{ id: "asset-1", name: "Hero" }], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue(state("character", "asset-1"));
    mocks.getProject.mockResolvedValue({ ...project, characters: [] });
    mocks.syncEpisodeAssetsFromShootingPlan.mockRejectedValue(new Error("Refresh unavailable"));
    render(<ConsistencyVault />);
    await screen.findByRole("region", { name: "拍摄计划资产需求" });
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("资产已删除，部分数据刷新失败", expect.anything()));
    expect(useProjectStore.getState().currentProject?.characters).toEqual([]);
    expect(screen.queryByRole("region", { name: "拍摄计划资产需求" })).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
});

it("deletes an unsynced asset without requiring a confirmed plan", async () => {
    const project = { id: "episode-1", characters: [{ id: "asset-1", name: "Hero" }], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.getProject.mockResolvedValue({ ...project, characters: [] });
    render(<ConsistencyVault />);
    await waitFor(() => expect(mocks.getEpisodeVisualContext).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(useProjectStore.getState().currentProject?.characters).toEqual([]));
    expect(mocks.syncEpisodeAssetsFromShootingPlan).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
});

it("preserves the plan display when deletion is rejected", async () => {
    const project = { id: "episode-1", characters: [{ id: "asset-1", name: "Hero" }], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue(state("character", "asset-1"));
    mocks.deleteCharacter.mockRejectedValue(new Error("Delete unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ConsistencyVault />);
    await screen.findByRole("region", { name: "拍摄计划资产需求" });
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.getByRole("region", { name: "拍摄计划资产需求" })).toHaveTextContent("待生成");
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.syncEpisodeAssetsFromShootingPlan).not.toHaveBeenCalled();
});

it("discards a deletion refresh after switching episodes", async () => {
    const project = { id: "episode-1", characters: [{ id: "asset-1", name: "Hero" }], scenes: [], props: [] };
    const nextProject = { id: "episode-2", characters: [], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValueOnce(state("character", "asset-1"))
        .mockResolvedValue({ context: null, bindings: [] });
    let finishRefresh!: (value: unknown) => void;
    mocks.syncEpisodeAssetsFromShootingPlan.mockReturnValue(new Promise(resolve => { finishRefresh = resolve; }));
    mocks.getProject.mockResolvedValue({ ...project, characters: [] });
    render(<ConsistencyVault />);
    await screen.findByRole("region", { name: "拍摄计划资产需求" });
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(mocks.syncEpisodeAssetsFromShootingPlan).toHaveBeenCalled());
    await act(async () => { useProjectStore.setState({ currentProject: nextProject as any }); });
    await act(async () => { finishRefresh(state("character", "asset-1")); });
    expect(useProjectStore.getState().currentProject?.id).toBe("episode-2");
    expect(screen.queryByRole("region", { name: "拍摄计划资产需求" })).not.toBeInTheDocument();
});
