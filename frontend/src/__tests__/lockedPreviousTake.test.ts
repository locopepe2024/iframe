import { describe, expect, it } from "vitest";
import { lockedPreviousTake } from "@/components/modules/storyboard-r2v/lockedPreviousTake";

const tasks = [
    { id: "take-a", frame_id: "shot-5", status: "completed", video_url: "a.mp4" },
    { id: "take-b", frame_id: "shot-5", status: "completed", video_url: "b.mp4" },
];

describe("locked previous shot take", () => {
    it("uses only the explicitly pinned completed take when two videos exist", () => {
        expect(lockedPreviousTake({ id: "shot-5", selected_video_id: "take-b", is_video_pinned: true }, tasks))
            .toEqual(tasks[1]);
    });

    it("does not infer a source from completed videos or an automatic selection", () => {
        expect(lockedPreviousTake({ id: "shot-5", selected_video_id: "take-b", is_video_pinned: false }, tasks)).toBeNull();
        expect(lockedPreviousTake({ id: "shot-5", is_video_pinned: true }, tasks)).toBeNull();
    });

    it("rejects a pinned task from another shot or without a usable video", () => {
        expect(lockedPreviousTake({ id: "shot-5", selected_video_id: "take-a", is_video_pinned: true }, [
            { ...tasks[0], frame_id: "shot-4" },
        ])).toBeNull();
        expect(lockedPreviousTake({ id: "shot-5", selected_video_id: "take-a", is_video_pinned: true }, [
            { ...tasks[0], video_url: null },
        ])).toBeNull();
    });
});
