// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import StoryboardFrameEditor from "./StoryboardFrameEditor";

const { api, state } = vi.hoisted(() => ({
    api: {
        listShotVisualPresets: vi.fn(),
        previewShotVisualPreset: vi.fn(),
        applyShotVisualPreset: vi.fn(),
        applyStaticFraming: vi.fn(),
    },
    state: { currentProject: { id: "project", frames: [{ id: "frame", action_description: "target action" }] }, currentSeries: null, updateProject: vi.fn() },
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/store/projectStore", () => ({ useProjectStore: Object.assign((select: any) => select(state), { getState: () => state }) }));
vi.mock("@/lib/api", () => ({ api, API_URL: "" }));
vi.mock("../common/VariantSelector", () => ({ VariantSelector: () => <div>当前首帧预览</div> }));
vi.mock("./RenderPromptPreviewDialog", () => ({ default: () => null }));

it("selects a source thumbnail and applies only confirmed fields", async () => {
    api.listShotVisualPresets.mockResolvedValue([
        { id: "first", name: "长街变体 A", preview_url: "/preview/a.webp" },
        { id: "second", name: "长街变体 B", preview_url: "/preview/b.webp" },
    ]);
    api.previewShotVisualPreset.mockResolvedValue({
        reference_image_available: true,
        projection: { scope: "same_time_world_light", source_visual_version_known: true, source_scene_design_revision: 2,
            eligible_fields: ["lighting"], available_fields: ["lighting"], visual_design: { lighting: { story_time: "dusk" } } },
    });
    api.applyShotVisualPreset.mockResolvedValue({ id: "frame" });
    render(<StoryboardFrameEditor frame={state.currentProject.frames[0]} onClose={() => {}} />);

    expect(screen.getByText("分镜首帧编辑")).toBeTruthy();
    expect(screen.getByText("静态起幅")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "选择参考图 长街变体 B" }));
    await waitFor(() => expect(api.previewShotVisualPreset).toHaveBeenCalledWith("project", "frame", "second"));
    expect(await screen.findByText("来源图片：场景设计版本 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("参考提交模式"), { target: { value: "image_and_context" } });
    fireEvent.click(await screen.findByLabelText("带入光影"));
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(api.applyShotVisualPreset).toHaveBeenCalledWith("project", "frame", "second", "image_and_context", ["lighting"]));
});

it("identifies a legacy image with no structured version and keeps image-only submission", async () => {
    api.listShotVisualPresets.mockResolvedValue([{ id: "legacy", name: "旧长街", preview_url: "/preview/old.webp" }]);
    api.previewShotVisualPreset.mockResolvedValue({
        reference_image_available: true,
        projection: { scope: "unresolved", source_visual_version_known: false,
            eligible_fields: [], available_fields: [], visual_design: {} },
    });
    api.applyShotVisualPreset.mockResolvedValue({ id: "frame" });
    render(<StoryboardFrameEditor frame={state.currentProject.frames[0]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "选择参考图 旧长街" }));
    expect(await screen.findByText("来源图片：结构化版本未知")).toBeInTheDocument();
    expect(await screen.findByText(/此图的结构化版本未知/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(api.applyShotVisualPreset).toHaveBeenCalledWith("project", "frame", "legacy", "image_only", []));
});

it("distinguishes image-only reference from the effective lighting input", async () => {
    const originalFrames = state.currentProject.frames;
    state.currentProject.frames = [{
        id: "frame", action_description: "target action",
        reference_visual_projection: {
            source_preset_id: "previous", selected_fields: [],
            visual_design: { lighting: { daylight_phase: "暮秋残阳" } },
        },
    } as any];
    api.listShotVisualPresets.mockResolvedValue([{ id: "previous", name: "上一镜首帧" }]);
    api.previewShotVisualPreset.mockResolvedValue({ reference_image_available: true, projection: {
        scope: "same_place_time", eligible_fields: ["lighting"], available_fields: ["lighting"],
        visual_design: { lighting: { daylight_phase: "暮秋残阳" } },
    } });
    try {
        render(<StoryboardFrameEditor frame={state.currentProject.frames[0]} onClose={() => {}} />);
        expect(await screen.findByText("此参考仅提交图片，未选择其结构化光影。请在生成预览中核对本镜实际光影输入。")).toBeInTheDocument();
        expect(screen.getByText(/当前参考：上一镜首帧/)).toBeInTheDocument();
    } finally {
        state.currentProject.frames = originalFrames;
    }
});

it("applies a reviewed opening composition in Storyboard and refreshes the project", async () => {
    const originalFrames = state.currentProject.frames;
    const updated = { id: "project", frames: [{ id: "frame", shot_size: "近景" }] };
    state.currentProject.frames = [{
        id: "frame", action_description: "target action", shot_size: "中景",
        static_framing_candidate: {
            id: "opening", fields: { shot_size: "近景" }, current_fields: { shot_size: "中景" },
            rationale: { shot_size: "看清起始表情" }, source_refs: { shot_size: ["current_action"] }, uncertainties: [],
        },
    } as any];
    api.listShotVisualPresets.mockResolvedValue([]);
    api.applyStaticFraming.mockResolvedValue(updated);
    state.updateProject.mockClear();
    try {
        const { container } = render(<StoryboardFrameEditor frame={state.currentProject.frames[0]} onClose={() => {}} />);
        fireEvent.click(container.querySelector("summary")!);
        fireEvent.click(screen.getByRole("button", { name: "应用所选字段" }));
        await waitFor(() => expect(api.applyStaticFraming).toHaveBeenCalledWith("project", "frame", "opening", ["shot_size"]));
        expect(state.updateProject).toHaveBeenCalledWith("project", updated);
    } finally {
        state.currentProject.frames = originalFrames;
    }
});
