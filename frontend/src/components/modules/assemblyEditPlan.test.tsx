import { describe, expect, it } from "vitest";
import { buildDraftAssemblyPlan, formatAssemblyTime, hasAssemblyPlanChanges, moveAssemblyClip, updateAssemblyClip, refreshAssemblySelectedTakes } from "./assemblyEditPlan";
import type { Project } from "@/store/projectStore";

function project(): Project {
    return {
        id: "project-1",
        title: "Sample",
        originalText: "source",
        characters: [],
        scenes: [],
        props: [],
        frames: [
            { id: "f1", duration: 5 },
            { id: "f2", duration: 5 },
            { id: "f3", duration: 5 },
        ],
        video_tasks: [
            { id: "t1", frame_id: "f1", status: "completed", video_url: "v1", duration: 5 },
            { id: "t2", frame_id: "f2", status: "completed", video_url: "v2", duration: 5 },
            { id: "t3", frame_id: "f3", status: "completed", video_url: "v3", duration: 5 },
        ],
        status: "draft",
        createdAt: "",
        updatedAt: "",
    };
}

describe("assembly edit plan helpers", () => {
    it("proposes three bounded 20 second segments", () => {
        const plan = buildDraftAssemblyPlan(project());
        const video = plan.lanes.find((lane) => lane.kind === "video");
        expect(plan.target_duration_ms).toBe(60_000);
        expect(video?.clips.map((clip) => [clip.timeline_start_ms, clip.timeline_end_ms])).toEqual([
            [0, 20_000],
            [20_000, 40_000],
            [40_000, 60_000],
        ]);
    });

    it("keeps timeline edits keyboard-addressable and ordered", () => {
        const plan = buildDraftAssemblyPlan(project());
        const changed = updateAssemblyClip(plan, "video-main", "clip-f1", { enabled: false });
        const moved = moveAssemblyClip(changed, "video-main", "clip-f2", -1);
        expect(moved.lanes[0].clips[0].id).toBe("clip-f2");
        expect(moved.lanes[0].clips[1].enabled).toBe(false);
        expect(formatAssemblyTime(60_000)).toBe("1:00");
    });

    it("requires a new or changed draft to be saved before rendering", () => {
        const saved = buildDraftAssemblyPlan(project());
        expect(hasAssemblyPlanChanges(saved, null)).toBe(true);
        expect(hasAssemblyPlanChanges(saved, structuredClone(saved))).toBe(false);

        const changed = updateAssemblyClip(saved, "video-main", "clip-f1", { enabled: false });
        expect(hasAssemblyPlanChanges(changed, saved)).toBe(true);
        expect(hasAssemblyPlanChanges(null, saved)).toBe(false);
    });
});


describe("refresh selected assembly takes", () => {
    it("repairs stale pinned references without changing edits or non-video lanes", () => {
        const source = project();
        const plan = buildDraftAssemblyPlan(source);
        plan.lanes[0].clips[0].source_start_ms = 1000;
        plan.lanes[0].clips[0].enabled = false;
        plan.lanes[0].clips[0].gain = 0.5;
        plan.lanes[1].clips = [{ ...plan.lanes[0].clips[0] }];
        (source.frames[0] as any).selected_video_id = "replacement";
        (source.frames[0] as any).is_video_pinned = true;
        source.video_tasks!.push({ id: "replacement", frame_id: "f1", status: "completed", video_url: "new" } as any);
        const refreshed = refreshAssemblySelectedTakes(plan, [source]);
        expect(refreshed.lanes[0].clips[0]).toEqual({ ...plan.lanes[0].clips[0], source_task_id: "replacement" });
        expect(refreshed.lanes[1]).toEqual(plan.lanes[1]);
        expect(plan.lanes[0].clips[0].source_task_id).toBe("t1");
        expect(refreshed.revision).toBe(plan.revision);
    });
    it("does not substitute the newest task for the selected take or cross project boundaries", () => {
        const source = project();
        (source.frames[0] as any).selected_video_id = "t1";
        const plan = buildDraftAssemblyPlan(source);
        source.video_tasks!.push({ id: "newest", frame_id: "f1", status: "completed", video_url: "new" } as any);
        expect(refreshAssemblySelectedTakes(plan, [source])).toEqual(plan);
        plan.lanes[0].clips[0].source_project_id = "other";
        plan.lanes[0].clips[0].source_task_id = "foreign";
        expect(refreshAssemblySelectedTakes(plan, [source])).toEqual(plan);
    });
    it("rejects unavailable selections instead of silently using the old video", () => {
        const source = project();
        const plan = buildDraftAssemblyPlan(source);
        (source.frames[0] as any).selected_video_id = "missing";
        expect(() => refreshAssemblySelectedTakes(plan, [source])).toThrow("Selected video unavailable");
    });
});
