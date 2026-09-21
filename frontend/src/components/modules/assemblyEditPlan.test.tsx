import { describe, expect, it } from "vitest";
import { buildDraftAssemblyPlan, formatAssemblyTime, moveAssemblyClip, updateAssemblyClip } from "./assemblyEditPlan";
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
});

