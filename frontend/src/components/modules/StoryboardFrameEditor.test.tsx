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
        projection: { scope: "same_time_world_light", eligible_fields: ["lighting"], available_fields: ["lighting"], visual_design: { lighting: { story_time: "dusk" } } },
    });
    api.applyShotVisualPreset.mockResolvedValue({ id: "frame" });
    render(<StoryboardFrameEditor frame={state.currentProject.frames[0]} onClose={() => {}} />);

    expect(screen.getByText("分镜首帧编辑")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "选择参考图 长街变体 B" }));
    await waitFor(() => expect(api.previewShotVisualPreset).toHaveBeenCalledWith("project", "frame", "second"));
    fireEvent.change(screen.getByLabelText("参考提交模式"), { target: { value: "image_and_context" } });
    fireEvent.click(await screen.findByLabelText("带入光影"));
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(api.applyShotVisualPreset).toHaveBeenCalledWith("project", "frame", "second", "image_and_context", ["lighting"]));
});
