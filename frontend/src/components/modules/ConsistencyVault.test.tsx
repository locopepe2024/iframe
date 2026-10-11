import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import ConsistencyVault from "./ConsistencyVault";

const mocks = vi.hoisted(() => ({
    getProject: vi.fn(), getSeries: vi.fn(), getEpisodeVisualContext: vi.fn(),
    syncEpisodeAssetsFromShootingPlan: vi.fn(), deleteSeriesAsset: vi.fn(),
    bindEpisodePlanScene: vi.fn(),
    getAssetReferenceIndex: vi.fn(),
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
        bindings: bound ? [{ asset_type: assetType, asset_id: assetId, status: "suggested",
            scene_ids: ["scene-1"], shot_ids: ["shot-1"] }] : [],
        new_bindings: [], reusable_bindings: [], changed_bindings: [], stale_bindings: [], unresolved_bindings: [],
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAssetReferenceIndex.mockResolvedValue({ assets: [] });
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
    expect(screen.getByText(/新增记录 0 · 可复用记录 0 · 变更记录 0 · 过期记录 0/)).toBeInTheDocument();
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

it("offers an existing scene asset for a plan scene with no asset ID", async () => {
    const project = { id: "episode-1", characters: [], scenes: [{ id: "street", name: "长街" }], props: [] };
    const unbound = {
        ...state("scene", "street", false),
        context: {
            shooting_plan_revision: 2,
            scenes: [{ scene_id: "plan-street", scene_ref: "粮铺门前", scene_asset_id: null }],
            shots: [{ scene_id: "plan-street", shot_id: "shot-1", scene_asset_id: null }],
            characters: [], props: [],
        },
    };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue(unbound);
    mocks.getProject.mockResolvedValue(project);
    mocks.bindEpisodePlanScene.mockResolvedValue({ ...unbound,
        context: { ...unbound.context, scenes: [{ ...unbound.context.scenes[0], scene_asset_id: "street" }],
            shots: [{ ...unbound.context.shots[0], scene_asset_id: "street" }] },
        bindings: [{ asset_type: "scene", asset_id: "street", status: "suggested", scene_ids: ["plan-street"], shot_ids: ["shot-1"] }],
    });

    render(<ConsistencyVault />);
    const picker = await screen.findByRole("combobox", { name: "为计划场景 粮铺门前 选择资产" });
    fireEvent.change(picker, { target: { value: "street" } });

    await waitFor(() => expect(mocks.bindEpisodePlanScene).toHaveBeenCalledWith(
        "episode-1", "plan-street", null, "street", 2));
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "为计划场景 粮铺门前 选择资产" })).not.toBeInTheDocument());
});

it("explains that re-extracted scene and prop IDs need explicit plan bindings", async () => {
    const project = { id: "episode-1", characters: [],
        scenes: [{ id: "new-scene", name: "长街" }], props: [{ id: "new-prop", name: "竹篮" }] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({
        context: { shooting_plan_revision: 1,
            scenes: [{ scene_id: "plan-scene", scene_ref: "长街", scene_asset_id: "old-scene", plan_scene_asset_id: "old-scene" }],
            shots: [], characters: [], props: [{ prop_id: "old-prop", plan_prop_id: "old-prop", scene_ids: ["plan-scene"], shot_ids: [] }] },
        bindings: [
            { asset_type: "scene", asset_id: "old-scene", status: "suggested", scene_ids: ["plan-scene"], shot_ids: [] },
            { asset_type: "prop", asset_id: "old-prop", status: "suggested", scene_ids: ["plan-scene"], shot_ids: [] },
        ],
    });

    render(<ConsistencyVault />);
    const requirements = await screen.findByRole("region", { name: "拍摄计划资产需求" });
    expect(within(requirements).getByText(/重新提炼会生成新的资产 ID/)).toBeInTheDocument();
    expect(within(requirements).getAllByRole("option", { name: /长街 · 本集资产/ })).toHaveLength(1);
    expect(within(requirements).getAllByRole("option", { name: /竹篮 · 本集资产/ })).toHaveLength(1);
});

it("recognizes personal-library scene and prop assets in plan requirements", async () => {
    const project = { id: "episode-1", characters: [], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getAssetReferenceIndex.mockResolvedValue({ assets: [
        { asset_type: "scene", asset_id: "global-street", name: "长街", source_scope: "global" },
        { asset_type: "prop", asset_id: "global-sign", name: "粮铺招牌", source_scope: "global" },
    ] });
    mocks.getEpisodeVisualContext.mockResolvedValue({
        context: { shooting_plan_revision: 1, scenes: [], shots: [], characters: [], props: [] },
        bindings: [
            { asset_type: "scene", asset_id: "global-street", status: "suggested", scene_ids: [], shot_ids: [] },
            { asset_type: "prop", asset_id: "global-sign", status: "suggested", scene_ids: [], shot_ids: [] },
        ],
    });

    render(<ConsistencyVault />);
    const requirements = await screen.findByRole("region", { name: "拍摄计划资产需求" });
    await waitFor(() => expect(within(requirements).getByText("长街 · 个人资产")).toBeInTheDocument());
    expect(within(requirements).getByText("粮铺招牌 · 个人资产")).toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "拍摄计划资产需求" })).toHaveTextContent("候选引用");
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
