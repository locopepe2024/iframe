import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import ConsistencyVault from "./ConsistencyVault";

const mocks = vi.hoisted(() => ({
    getProject: vi.fn(), getSeries: vi.fn(), getEpisodeVisualContext: vi.fn(),
    syncEpisodeAssetsFromShootingPlan: vi.fn(), deleteSeriesAsset: vi.fn(),
    bindEpisodePlanScene: vi.fn(),
    getAssetReferenceIndex: vi.fn(),
    authenticatedFetch: vi.fn(),
    deleteCharacter: vi.fn(), deleteScene: vi.fn(), deleteProp: vi.fn(),
    updateAssetAttributes: vi.fn(),
    saveCharacterDesign: vi.fn(),
    updateAssetVariantMetadata: vi.fn(), agentRequest: vi.fn(),
    generateAsset: vi.fn(), getTaskStatus: vi.fn(),
    previewAssetImageSubmission: vi.fn((_id: string, request: any) => Promise.resolve({
        positive_prompt: request.prompt, negative_prompt: request.negative_prompt,
        selected_model_id: "test-model", aspect_ratio: "16:9",
        generation_type: request.generation_type, image_generation_mode: request.image_generation_mode,
        batch_size: request.batch_size, reference_inputs: request.references || [],
        design_revision_at_submission: null, fingerprint: "reviewed",
    })),
    error: vi.fn(), success: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ API_URL: "", authenticatedFetch: mocks.authenticatedFetch, agentRequest: mocks.agentRequest, api: mocks, crudApi: mocks }));
vi.mock("@/store/toastStore", () => ({ toast: { error: mocks.error, success: mocks.success, warning: vi.fn() } }));
vi.mock("./CharacterWorkbench", () => ({ default: ({ asset, onRename, onGenerate, onUpdateAttributes }: any) =>
    <div role="dialog" aria-label="角色工作台">{asset.name}
        <button type="button" onClick={() => void onRename("新名字")}>保存资产名</button>
        <button type="button" onClick={() => void onUpdateAttributes({ character_design: { test: "design" } })}>保存设计</button>
        <button type="button" onClick={() => onGenerate("three_view", "Reviewed three view", false, "blur", 1,
            [{ asset_type: "character", asset_id: asset.id, variant_id: "master-1" }], "reference")}>生成三视图</button>
    </div> }));
vi.mock("../common/VariantSelector", () => ({ VariantSelector: ({ asset, onRename, onGenerate }: any) =>
    <><button type="button" onClick={() => void onRename(asset.variants[0].id, "黄昏参考图")}>命名素材</button>
    <button type="button" onClick={() => onGenerate(1)}>测试生成图片</button></> }));
vi.mock("../common/VideoVariantSelector", () => ({ VideoVariantSelector: () => null }));
vi.mock("../modals/UploadAssetModal", () => ({ default: () => null }));
vi.mock("./playground/ReferencePromptEditor", () => ({ default: ({ value, onChange }: any) =>
    <textarea aria-label="图像提示词" value={value} onChange={event => onChange(event.target.value)} /> }));

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
    mocks.authenticatedFetch.mockResolvedValue({ ok: false });
    mocks.agentRequest.mockImplementation((path: string, _method: string, body: any) => path === "/models"
        ? Promise.resolve({ models: [{ api_model_id: "qwen", display_name: "Qwen" }] })
        : path === "/asset-image-prompt/refine/preview"
            ? Promise.resolve({ messages: { system: "只返回 JSON 对象，字段为 prompt", user: JSON.stringify(body) },
                review_token: "reviewed-token", format_note: "JSON prompt" })
            : Promise.resolve({ prompt: "黄昏参考图，青石板与粮铺门头清晰可见" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
});

it("saves only character design and retains current assets without refetching the project", async () => {
    const character = { id: "hero", name: "Hero", cover_url: "/cover.webp", source: "series" };
    const project = { id: "episode-1", characters: [character], scenes: [{ id: "scene-1" }], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    let complete: (result: any) => void = () => {};
    mocks.saveCharacterDesign.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByText("Hero"));
    fireEvent.click(screen.getByRole("button", { name: "保存设计" }));
    await waitFor(() => expect(mocks.saveCharacterDesign).toHaveBeenCalledWith("episode-1", "hero", { test: "design" }));
    // A generation can finish while the save request is in flight.
    act(() => useProjectStore.setState({ currentProject: { ...project,
        characters: [{ ...character, full_body_image_url: "/new.png", asset_revision: 4 }],
    } as any }));
    await act(async () => complete({ project_id: "episode-1", asset_id: "hero", asset_revision: 3, character_design: { saved: true } }));
    expect(useProjectStore.getState().currentProject?.characters[0]).toMatchObject({
        ...character, full_body_image_url: "/new.png", character_design: { saved: true }, asset_revision: 4,
    });
    expect(useProjectStore.getState().currentProject?.scenes).toEqual(project.scenes);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.updateAssetAttributes).not.toHaveBeenCalled();
});

it("clears a stale generation overlay when a new character variant is already present", async () => {
    const project = {
        id: "episode-1",
        characters: [{ id: "hero", name: "Hero", reference_sheet: {
            selected_image_id: "new-cover",
            image_variants: [{ id: "old-cover", url: "/old.png" }, { id: "new-cover", url: "/new.png" }],
        } }], scenes: [], props: [],
    };
    useProjectStore.setState({
        currentProject: project as any,
        generatingTasks: [{ assetId: "hero", generationType: "reference_sheet", batchSize: 1, initialVariantIds: ["old-cover"] }],
    });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    render(<ConsistencyVault />);
    await waitFor(() => expect(useProjectStore.getState().generatingTasks).toEqual([]));
});

it("submits a derived character master as one stable reference identity", async () => {
    const character = { id: "hero", name: "Hero", source: "episode" };
    const project = { id: "episode-1", characters: [character], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.generateAsset.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByText("Hero"));
    fireEvent.click(screen.getByRole("button", { name: "生成三视图" }));
    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalled());
    const args = mocks.generateAsset.mock.calls[0];
    expect(args[12]).toEqual({ asset_type: "character", asset_id: "hero", variant_id: "master-1" });
    expect(args[13]).toEqual([]);
    expect(args[14]).toBe("reference");
});

it("sends only the visible edited scene prompt and negative prompt", async () => {
    const asset = { id: "scene-1", name: "长街", description: "蓝调长街", source: "episode",
        image_asset: { selected_id: "v1", variants: [{ id: "v1", url: "/street.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [],
        art_direction: { style_config: { positive_prompt: "暮秋蓝调", negative_prompt: "暖红色调" } } };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.generateAsset.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText("长街"));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    const visiblePrompt = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    expect(visiblePrompt).toContain("暮秋蓝调");
    fireEvent.click(screen.getByRole("button", { name: "测试生成图片" }));
    const confirm = await screen.findByRole("button", { name: "确认并生成" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalled());
    const args = mocks.generateAsset.mock.calls[0];
    expect(args[6]).toBe(visiblePrompt);
    expect(args[7]).toBe(false);
    expect(args[15]).toBe(true);
    expect(args[16]).toBe("reviewed");
    expect(args[4]).toBe("");
});

it("edits scene light and view before refinement and submits only the applied visible prompt", async () => {
    const asset = { id: "street", name: "青溪镇长街", description: "人来人往的青石长街", source: "episode",
        lighting_mood: "暮秋黄昏", image_asset: { selected_id: "v1", variants: [{ id: "v1", url: "/street.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [],
        art_direction: { style_config: { positive_prompt: "", negative_prompt: "" } } };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockResolvedValue(project);
    mocks.generateAsset.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText("青溪镇长街"));
    expect(screen.queryByRole("textbox", { name: "场景风格" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    expect(screen.getByRole("textbox", { name: "场景风格" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "场景风格" }), { target: { value: "写实蓝调" } });
    fireEvent.click(screen.getByText("补充描述与旧版设置", { selector: "summary" }));
    fireEvent.change(screen.getByRole("textbox", { name: "场景环境光" }), { target: { value: "街道保持蓝色黄昏" } });
    fireEvent.change(screen.getByRole("textbox", { name: "场景参考图视角" }), { target: { value: "沿街向北" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并使用场景设计" }));
    await waitFor(() => expect(mocks.updateAssetAttributes).toHaveBeenCalledWith("episode-1", "street", "scene",
        expect.objectContaining({ asset_design: expect.objectContaining({
            style: "写实蓝调", ambient_lighting: "街道保持蓝色黄昏",
            reference_viewpoint: "沿街向北", confirmed: true,
        }) })));
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "提交 AI 完善" }));
    await waitFor(() => expect(mocks.agentRequest).toHaveBeenCalledWith("/asset-image-prompt/refine/preview", "POST",
        expect.objectContaining({ style: expect.stringContaining("环境光：街道保持蓝色黄昏") })));
    expect(mocks.agentRequest).not.toHaveBeenCalledWith("/asset-image-prompt/refine", "POST", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "确认输入并优化" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("黄昏参考图，青石板与粮铺门头清晰可见"));
    fireEvent.click(screen.getByRole("tab", { name: "场景设计" }));
    const visible = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    expect(visible).toContain("环境光：街道保持蓝色黄昏");
    fireEvent.click(screen.getByRole("button", { name: "测试生成图片" }));
    const confirm = await screen.findByRole("button", { name: "确认并生成" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalled());
    expect(mocks.generateAsset.mock.calls[0][6]).toBe(visible);
});

it("reviews a scene image tool with its source and settings before enqueue", async () => {
    const asset = { id: "street", name: "长街", description: "青石长街", source: "episode",
        image_asset: { selected_id: "source", variants: [{ id: "source", url: "/street.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.generateAsset.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText("长街"));
    fireEvent.click(screen.getByRole("button", { name: "光影" }));
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    await waitFor(() => expect(mocks.previewAssetImageSubmission).toHaveBeenCalledWith("episode-1",
        expect.objectContaining({
            asset_type: "scene", image_generation_mode: "reference",
            references: [{ asset_type: "scene", asset_id: "street", variant_id: "source" }],
            scene_tool: expect.objectContaining({ kind: "lighting", brightness: 50 }),
        })));
    const dialog = await screen.findByRole("dialog", { name: "核对图片生成请求" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认并生成" }));
    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalled());
    const submitted = mocks.generateAsset.mock.calls[0];
    expect(submitted[13]).toEqual([{ asset_type: "scene", asset_id: "street", variant_id: "source" }]);
    expect(submitted[16]).toBe("reviewed");
    expect(submitted[17]).toEqual(expect.objectContaining({ kind: "lighting", brightness: 50 }));
});

it.each(["design", "ai"] as const)("reviews and generates only the active scene %s prompt and references", async source => {
    const reference = { asset_type: "scene", asset_id: "gate", variant_id: "gate-v1" };
    const workspace = {
        settings_pending: false,
        design: { prompt: "原始石板长街", mode: "text", references: [] },
        ai: { prompt: "优化长街 @城门", mode: "reference", references: [reference] },
    };
    const asset = { id: "street", name: "来源测试长街", description: "剧本中的长街", source: "episode",
        asset_design: { design_draft: { visual_notes: "石板街", prompt_workspace: workspace } },
        image_asset: { selected_id: "v1", variants: [{ id: "v1", url: "/street.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.generateAsset.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    const label = source === "ai" ? "AI 优化" : "场景设计";
    fireEvent.click(screen.getByRole("tab", { name: label }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue(workspace[source].prompt);
    fireEvent.click(screen.getByRole("button", { name: "测试生成图片" }));
    expect(await screen.findByText(`提示词来源：${label}`)).toBeInTheDocument();
    await waitFor(() => expect(mocks.previewAssetImageSubmission).toHaveBeenCalledWith("episode-1",
        expect.objectContaining({ prompt: workspace[source].prompt, references: workspace[source].references,
            image_generation_mode: workspace[source].mode, preserve_prompt: true, apply_style: false })));
    const confirm = await screen.findByRole("button", { name: "确认并生成" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalled());
    expect(mocks.generateAsset.mock.calls[0][6]).toBe(workspace[source].prompt);
    expect(mocks.generateAsset.mock.calls[0][13]).toEqual(workspace[source].references);
    expect(mocks.generateAsset.mock.calls[0][14]).toBe(workspace[source].mode);
});

it("saves both scene sources and restores independent edits when reopened", async () => {
    const workspace = { settings_pending: false,
        design: { prompt: "原设计", mode: "text", references: [] },
        ai: { prompt: "已有优化", mode: "text", references: [] } };
    const asset = { id: "street", name: "保存测试长街", description: "保持原文不变", source: "episode",
        asset_design: { design_draft: { visual_notes: "长街", prompt_workspace: workspace } },
        image_asset: { variants: [{ id: "v1", url: "/street.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockImplementation((_id, _assetId, _type, attributes) => Promise.resolve({ ...project,
        scenes: [{ ...asset, asset_design: { design_draft: attributes.asset_design } }] }));
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "手工修改原设计" } });
    fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("已有优化");
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "手工修改优化" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并使用 AI 优化" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("已保存并使用 AI 优化"));
    expect(mocks.updateAssetAttributes).toHaveBeenCalledWith("episode-1", "street", "scene",
        expect.objectContaining({ asset_design: expect.objectContaining({ prompt_workspace: {
            active_source: "ai", settings_pending: false,
            design: { ...workspace.design, prompt: "手工修改原设计" },
            ai: { ...workspace.ai, prompt: "手工修改优化" },
        } }) }));
    fireEvent.click(screen.getByRole("button", { name: "关闭工作台" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "AI 优化" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText(asset.name));
    expect(screen.getByRole("tab", { name: "AI 优化" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "未保存优化" } });
    fireEvent.click(screen.getByRole("tab", { name: "场景设计" }));
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "未保存原设计" } });
    expect(screen.getByText(/已保存的设计有修改/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑已保存设计" }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("手工修改原设计");
    fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("手工修改优化");
    expect(mocks.agentRequest.mock.calls.every(([path]) => path === "/models")).toBe(true);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(screen.getAllByText("保持原文不变").length).toBeGreaterThan(0);
});

it("does not submit an empty AI source or add unselected people-view constraints", async () => {
    const asset = { id: "street", name: "空优化长街", description: "长街原文", source: "episode",
        image_asset: { variants: [{ id: "v1", url: "/street.png" }] } };
    useProjectStore.setState({ currentProject: { id: "episode-1", characters: [], scenes: [asset], props: [] } as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    expect(screen.getByRole("button", { name: "保存并使用 AI 优化" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "测试生成图片" }));
    expect(mocks.previewAssetImageSubmission).not.toHaveBeenCalled();
    expect(mocks.generateAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "场景设计" }));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "可见人脸上限" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    const text = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    expect(text).toContain("可见人脸上限：3 张");
    expect(text).not.toMatch(/侧身|远景/);
});

it("keeps the last successful scene save when a later save fails", async () => {
    const asset = { id: "street", name: "保存失败场景", description: "场景原文", source: "episode",
        asset_design: { design_draft: { visual_notes: "街道", prompt_workspace: {
            active_source: "design", settings_pending: false,
            design: { prompt: "成功保存的街道", mode: "text", references: [] },
            ai: { prompt: "成功保存的优化", mode: "text", references: [] },
        } } } };
    useProjectStore.setState({ currentProject: { id: "episode-1", characters: [], scenes: [asset], props: [] } as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockRejectedValue(new Error("保存连接失败"));
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "未保存的街道" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并使用场景设计" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("场景设计保存失败", expect.anything()));
    expect(screen.getByRole("alert")).toHaveTextContent("保存连接失败");
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("未保存的街道");
    fireEvent.click(screen.getByRole("button", { name: "编辑已保存设计" }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("成功保存的街道");
    fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("成功保存的优化");
    expect(mocks.success).not.toHaveBeenCalled();
});

it.each([
    ["scene", "scenes", "粮铺门前"],
    ["prop", "props", "双手剑"],
] as const)("optimizes and names %s materials without leaving the workbench", async (type, key, name) => {
    const asset = { id: `${type}-1`, name, description: `${name}的视觉档案`, source: "series",
        image_asset: { selected_id: "variant-1", variants: [{ id: "variant-1", url: "/asset.png" }] } };
    const project = { id: "episode-1", characters: [], scenes: [], props: [], [key]: [asset] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetVariantMetadata.mockResolvedValue({ ...project, [key]: [{ ...asset,
        image_asset: { ...asset.image_asset, variants: [{ ...asset.image_asset.variants[0], display_name: "黄昏参考图" }] },
    }] });
    render(<ConsistencyVault />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(type === "scene" ? "Scenes" : "Props") }));
    fireEvent.click(screen.getByText(name));
    const optimizeLabel = type === "scene" ? "提交 AI 完善" : "优化提示词";
    await waitFor(() => expect(screen.getByRole("button", { name: optimizeLabel })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: optimizeLabel }));
    await screen.findByRole("button", { name: "确认输入并优化" });
    expect(mocks.agentRequest).not.toHaveBeenCalledWith("/asset-image-prompt/refine", "POST", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "确认输入并优化" }));
    if (type === "prop") {
        await screen.findByRole("button", { name: "采用建议" });
        expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue(asset.description);
        fireEvent.click(screen.getByRole("button", { name: "采用建议" }));
    } else {
        await waitFor(() => expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("黄昏参考图，青石板与粮铺门头清晰可见"));
        fireEvent.click(screen.getByRole("tab", { name: "场景设计" }));
        expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue(asset.description);
        fireEvent.click(screen.getByRole("tab", { name: "AI 优化" }));
    }
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("黄昏参考图，青石板与粮铺门头清晰可见");
    expect(mocks.agentRequest).toHaveBeenCalledWith("/asset-image-prompt/refine", "POST",
        expect.objectContaining({ asset_type: type, asset_name: name, current_prompt: asset.description,
            project_id: "episode-1", asset_id: asset.id, review_token: "reviewed-token" }));

    fireEvent.click(screen.getByRole("button", { name: "命名素材" }));
    await waitFor(() => expect(mocks.updateAssetVariantMetadata).toHaveBeenCalledWith(
        "episode-1", asset.id, type, "variant-1", undefined, undefined, "黄昏参考图"));
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue("黄昏参考图，青石板与粮铺门头清晰可见");
    expect(useProjectStore.getState().currentProject?.[key][0].image_asset?.variants[0].display_name).toBe("黄昏参考图");
});

it("sends the edited review text and discards a review after source changes", async () => {
    const asset = { id: "prop-1", name: "旧剑", description: "旧剑档案", source: "episode" };
    useProjectStore.setState({ currentProject: { id: "episode-1", characters: [], scenes: [], props: [asset] } as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Props/ }));
    fireEvent.click(screen.getByText("旧剑"));
    await waitFor(() => expect(screen.getByRole("button", { name: "优化提示词" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByRole("button", { name: "确认输入并优化" });
    const reviewedUser = screen.getByRole("textbox", { name: "资产描述与可见提示词" });
    fireEvent.change(reviewedUser, { target: { value: '{"current_prompt":"只保留冷色旧剑"}' } });
    fireEvent.click(screen.getByRole("button", { name: "确认输入并优化" }));
    await waitFor(() => expect(mocks.agentRequest).toHaveBeenCalledWith("/asset-image-prompt/refine", "POST",
        expect.objectContaining({ reviewed_messages: expect.objectContaining({
            user: '{"current_prompt":"只保留冷色旧剑"}',
        }) })));

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByRole("button", { name: "确认输入并优化" });
    fireEvent.change(screen.getByRole("textbox", { name: "图像提示词" }), { target: { value: "修改后的可见提示词" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认输入并优化" })).not.toBeInTheDocument());
    expect(mocks.agentRequest.mock.calls.filter(([path]) => path === "/asset-image-prompt/refine")).toHaveLength(1);
});

it("keeps a series character workbench open after renaming", async () => {
    const character = { id: "hero", name: "旧名字", source: "series" };
    const project = { id: "episode-1", characters: [character], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockResolvedValue({ ...project,
        characters: [{ ...character, name: "新名字" }] });
    render(<ConsistencyVault />);

    fireEvent.click(screen.getByText("旧名字"));
    fireEvent.click(screen.getByRole("button", { name: "保存资产名" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "角色工作台" })).toHaveTextContent("新名字"));
    expect(useProjectStore.getState().currentProject?.characters).toHaveLength(1);
    expect(mocks.getProject).not.toHaveBeenCalled();
});

it("reloads a partial rename response before replacing the visible asset list", async () => {
    const character = { id: "hero", name: "旧名字", source: "series" };
    const other = { id: "support", name: "配角", source: "series" };
    const project = { id: "episode-1", characters: [character, other], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockResolvedValue({ ...project, characters: [{ ...character, name: "新名字" }] });
    mocks.getProject.mockResolvedValue({ ...project, characters: [{ ...character, name: "新名字" }, other] });
    render(<ConsistencyVault />);

    fireEvent.click(screen.getByText("旧名字"));
    fireEvent.click(screen.getByRole("button", { name: "保存资产名" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "角色工作台" })).toHaveTextContent("新名字"));
    expect(mocks.getProject).toHaveBeenCalledWith("episode-1");
    expect(useProjectStore.getState().currentProject?.characters).toHaveLength(2);
    expect(screen.queryByText("No characters found")).not.toBeInTheDocument();
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
    expect(screen.getByText("计划场景 · 粮铺门前")).toBeInTheDocument();
    expect(screen.getByText("关联场景资产 · 待关联")).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "street" } });

    await waitFor(() => expect(mocks.bindEpisodePlanScene).toHaveBeenCalledWith(
        "episode-1", "plan-street", null, "street", 2));
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "为计划场景 粮铺门前 选择资产" })).not.toBeInTheDocument());
    expect(screen.getByText("关联场景资产 · 长街 · 本集资产")).toBeInTheDocument();
});

it("shows a director person and its resolved character asset as separate identities", async () => {
    const character = { id: "hero", name: "清溪镇百姓", source: "series" };
    const project = { id: "episode-1", characters: [character], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({
        context: { shooting_plan_revision: 1, scenes: [], shots: [], props: [], characters: [{
            person_id: "person-1", person_label: "镇上居民", character_asset_ids: ["hero"],
            scene_ids: ["scene-1"], shot_ids: ["shot-1"],
        }] },
        bindings: [{ asset_type: "character", asset_id: "hero", status: "suggested",
            scene_ids: ["scene-1"], shot_ids: ["shot-1"] }],
    });

    render(<ConsistencyVault />);
    await screen.findByText("计划人物 · 镇上居民");
    expect(screen.getByText("关联角色资产 · 清溪镇百姓 · 系列共享")).toBeInTheDocument();
    expect(screen.getByText(/按人物身份关联/)).toBeInTheDocument();
    expect(screen.queryByText("使用导演映射")).not.toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "拍摄计划资产需求" })).toHaveTextContent("计划人物 · Hero");
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

it('stops a missing-task spinner and refreshes the asset without resubmitting generation', async () => {
    const character = { id: 'hero', name: 'Hero', source: 'episode' };
    const project = { id: 'episode-1', characters: [character], scenes: [], props: [] };
    useProjectStore.setState({ currentProject: project as any, generatingTasks: [] });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.generateAsset.mockResolvedValue({ _task_id: 'lost-task' });
    mocks.getTaskStatus.mockRejectedValue({ response: { status: 404, data: { detail: 'Task not found' } } });
    mocks.getProject.mockResolvedValue(project);
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByText('Hero'));
    fireEvent.click(screen.getByRole('button', { name: '生成三视图' }));
    await waitFor(() => expect(useProjectStore.getState().generatingTasks).toHaveLength(1));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('找不到这次生成的任务记录')), { timeout: 4000 });
    expect(useProjectStore.getState().generatingTasks).toEqual([]);
    expect(mocks.generateAsset).toHaveBeenCalledTimes(1);
    expect(mocks.getProject).toHaveBeenCalledWith('episode-1');
});

it("applies, saves and restores selected scene layers without rewriting the AI source", async () => {
    const asset = { id: "street", name: "三层场景", description: "青石街道", source: "episode",
        asset_design: { design_draft: { visual_notes: "青石街道", prompt_workspace: {
            active_source: "design", settings_pending: false,
            design: { prompt: "手工场景正文", mode: "text", references: [] },
            ai: { prompt: "已有 AI 正文", mode: "text", references: [] },
        } } } };
    const project = { id: "episode-1", characters: [], scenes: [asset], props: [] };
    useProjectStore.setState({ currentProject: project as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    mocks.updateAssetAttributes.mockImplementation((_id, _assetId, _type, attributes) => Promise.resolve({ ...project,
        scenes: [{ ...asset, asset_design: { design_draft: attributes.asset_design } }] }));
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    for (const title of ["光影", "镜头", "构图"]) fireEvent.click(screen.getByText(title, { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "月光" }));
    fireEvent.click(screen.getByRole("button", { name: "宁静" }));
    fireEvent.click(screen.getByRole("button", { name: "薄雾" }));
    fireEvent.click(screen.getByRole("button", { name: "冷光" }));
    fireEvent.click(screen.getByRole("button", { name: "长焦" }));
    fireEvent.click(screen.getByRole("button", { name: "深景深" }));
    fireEvent.click(screen.getByRole("button", { name: "前中后景" }));
    fireEvent.change(screen.getByRole("textbox", { name: "对焦目标" }), { target: { value: "门口石狮" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "指定画面对焦位置" }));
    fireEvent.change(screen.getByRole("slider", { name: "对焦水平位置" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    const prompt = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    expect(prompt).toContain("手工场景正文");
    expect(prompt).toContain("光影：光源：月光");
    expect(prompt).toContain("焦距观感：长焦观感");
    expect(prompt).toContain("景深：深景深");
    expect(prompt).toContain("对焦目标：门口石狮");
    expect(prompt).toContain("画面坐标 x=30%、y=50%");
    expect(prompt).toContain("构图：空间层次：");
    expect(prompt).not.toMatch(/奶油|柔肤|ARRI|剪辑/);
    fireEvent.click(screen.getByRole("button", { name: "保存并使用场景设计" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    const saved = mocks.updateAssetAttributes.mock.calls[0][3].asset_design;
    expect(saved.prompt_layers.lighting.source).toBe("月光");
    expect(saved.prompt_layers.lighting.mood).toContain("宁静平和");
    expect(saved.prompt_layers.lighting.air).toContain("稀薄雾气");
    expect(saved.prompt_layers.lighting.color).toContain("照明偏冷");
    expect(saved.prompt_layers.camera.focal_length).toContain("长焦");
    expect(saved.prompt_layers.camera.focus).toEqual({ target: "门口石狮", x: 30, y: 50, radius: 18 });
    expect(saved.prompt_workspace.design.prompt).toBe(prompt);
    expect(saved.prompt_workspace.ai.prompt).toBe("已有 AI 正文");
    // Reopen from the returned record, then restore the saved panel after edits.
    fireEvent.click(screen.getByRole("button", { name: "关闭工作台" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "AI 优化" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    fireEvent.click(screen.getByText("光影", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "宁静" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("镜头", { selector: "summary" }));
    expect(screen.getByRole("textbox", { name: "对焦目标" })).toHaveValue("门口石狮");
    expect(screen.getByRole("slider", { name: "对焦水平位置" })).toHaveValue("30");
    fireEvent.change(screen.getByRole("textbox", { name: "对焦目标" }), { target: { value: "未保存目标" } });
    expect(screen.getByRole("button", { name: "长焦" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "长焦" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑已保存设计" }));
    expect(screen.getByRole("button", { name: "长焦" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "对焦目标" })).toHaveValue("门口石狮");
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue(prompt);
});

it("blocks applying a scene light direction forbidden by the same design", async () => {
    const asset = { id: "street", name: "方向冲突场景", description: "街道" };
    useProjectStore.setState({ currentProject: { id: "episode-1", characters: [], scenes: [asset], props: [] } as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    fireEvent.click(screen.getByText("光影", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "顶部" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "禁止顶部光" }));
    const previous = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    expect(screen.getByRole("alert")).toHaveTextContent("所选光源方向与禁止方向冲突");
    expect(screen.getByRole("textbox", { name: "图像提示词" })).toHaveValue(previous);
});

it("fills an atmosphere Prompt template into editable scene settings without changing camera settings", async () => {
    const asset = { id: "street", name: "氛围模板场景", description: "庭院", source: "episode",
        asset_design: { design_draft: { visual_notes: "庭院", prompt_layers: { camera: { depth_of_field: "深景深" } } } } };
    useProjectStore.setState({ currentProject: { id: "episode-1", characters: [], scenes: [asset], props: [] } as any });
    mocks.getEpisodeVisualContext.mockResolvedValue({ context: null, bindings: [] });
    render(<ConsistencyVault />);
    fireEvent.click(screen.getByRole("button", { name: /Scenes/ }));
    fireEvent.click(screen.getByText(asset.name));
    fireEvent.click(screen.getByRole("button", { name: /基础面板 ·/ }));
    fireEvent.click(screen.getByText("Prompt 模板 · 氛围", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "黄金时刻" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    const prompt = (screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value;
    expect(prompt).toContain("临近日落的太阳光");
    expect(prompt).toContain("仰角 12°");
    expect(prompt).toContain("温暖舒缓的傍晚氛围");
    expect(prompt).toContain("景深：深景深");
    fireEvent.click(screen.getByText("光影", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "硬光" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到图片提示词" }));
    expect((screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value).toContain("硬质定向光");
    expect((screen.getByRole("textbox", { name: "图像提示词" }) as HTMLTextAreaElement).value).not.toContain("软硬：柔和漫射光");
});
