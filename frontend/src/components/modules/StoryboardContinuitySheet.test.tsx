// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import StoryboardContinuitySheet from "./StoryboardContinuitySheet";

const { getStoryboardContinuitySheet } = vi.hoisted(() => ({
    getStoryboardContinuitySheet: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: { getStoryboardContinuitySheet } }));

it("filters diagnostics and shows source revisions before opening a shot", async () => {
    getStoryboardContinuitySheet.mockResolvedValue({
        rows: [
            { frame_id: "a", shot_id: "S01", scene_id: "street", scene_name: "长街",
              place_continuity_id: "street", time_continuity_id: "dusk", continuity_status: "confirmed",
              plan_revision: 2, scene_design_revision: 1, style_hash: "style", model: "m",
              fields: { weather: { value: "晴", source_kind: "plan_baseline", source_id: "street:dusk", source_revision: 2, status: "confirmed" },
                        aspect_ratio: { value: "16:9", source_kind: "model_settings", source_id: "p", source_revision: null, status: "confirmed" } },
              reference: { source_variant_id: "v1", source_design_revision: 1, selected_fields: ["lighting"] } },
            { frame_id: "b", shot_id: "S02", scene_id: "shop", scene_name: "粮店",
              place_continuity_id: "shop", time_continuity_id: "dusk", continuity_status: "confirmed",
              plan_revision: 2, scene_design_revision: null, style_hash: "style", model: "m",
              fields: { weather: { value: "雨", source_kind: "plan_baseline", source_id: "shop:dusk", source_revision: 2, status: "confirmed" } },
              reference: null },
        ],
        issues: [{ scope: "same_time_different_place", field: "weather", frame_ids: ["a", "b"],
                   values: [{ value: "晴", source_kind: "plan_baseline" }, { value: "雨", source_kind: "plan_baseline" }], status: "conflict" }],
    });
    const onOpenFrame = vi.fn();
    render(<StoryboardContinuitySheet projectId="p" revisionKey="r1" onOpenFrame={onOpenFrame} />);
    await screen.findByText("分镜 1");
    fireEvent.change(screen.getByLabelText("筛选场景"), { target: { value: "street" } });
    expect(screen.getByText("分镜 1")).toBeTruthy();
    expect(screen.queryByText("分镜 2")).toBeNull();
    fireEvent.click(screen.getByText("分镜 1"));
    expect(screen.getByText(/拍摄计划光线 r2/)).toBeTruthy();
    expect(screen.getByText(/来源设计版本 1/)).toBeTruthy();
    expect(screen.getByText(/晴 \/ 雨/)).toBeTruthy();
    expect(screen.queryByText("v1")).toBeNull();
    expect(screen.queryByText("street:dusk")).toBeNull();
    fireEvent.click(screen.getByText("编辑分镜首帧"));
    expect(onOpenFrame).toHaveBeenCalledWith("a");
    fireEvent.change(screen.getByLabelText("筛选一致性状态"), { target: { value: "unresolved" } });
    await waitFor(() => expect(screen.getByText("当前筛选没有镜头。")).toBeTruthy());
});

it("focuses a shot from its card and clears filters that would hide it", async () => {
    getStoryboardContinuitySheet.mockResolvedValue({
        rows: [
            { frame_id: "first", scene_id: "a", scene_name: "长街", continuity_status: "confirmed", fields: {}, reference: null },
            { frame_id: "second", scene_id: "b", scene_name: "粮店", continuity_status: "unresolved", fields: {}, reference: null },
        ],
        issues: [],
    });
    const { rerender } = render(<StoryboardContinuitySheet projectId="p" revisionKey="r1" onOpenFrame={() => {}} />);
    await screen.findByText("分镜 1");
    fireEvent.change(screen.getByLabelText("筛选场景"), { target: { value: "a" } });
    rerender(<StoryboardContinuitySheet projectId="p" revisionKey="r1" focusedFrameId="second" focusVersion={1} onOpenFrame={() => {}} />);
    await waitFor(() => expect(screen.getByText("分镜 2")).toBeTruthy());
    expect(screen.getByText("编辑分镜首帧")).toBeTruthy();
    expect((screen.getByLabelText("筛选场景") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByText("分镜 2"));
    expect(screen.queryByText("编辑分镜首帧")).toBeNull();
    rerender(<StoryboardContinuitySheet projectId="p" revisionKey="r1" focusedFrameId="second" focusVersion={2} onOpenFrame={() => {}} />);
    expect(screen.getByText("编辑分镜首帧")).toBeTruthy();
});

it("uses the shot-design action without changing the continuity row", async () => {
    getStoryboardContinuitySheet.mockResolvedValue({
        rows: [{ frame_id: "shot", scene_id: "street", scene_name: "长街", continuity_status: "unresolved", fields: {}, reference: null }],
        issues: [],
    });
    const onOpenFrame = vi.fn();
    render(<StoryboardContinuitySheet projectId="p" revisionKey="r1" onOpenFrame={onOpenFrame} openFrameLabel="定位镜头设计" />);
    fireEvent.click(await screen.findByText("分镜 1"));
    expect(screen.getByText(/实际提交内容以各自生成预览为准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "定位镜头设计" }));
    expect(onOpenFrame).toHaveBeenCalledWith("shot");
});
