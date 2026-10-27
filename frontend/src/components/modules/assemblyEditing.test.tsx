import { describe, expect, it } from "vitest";
import type { AssemblyEditPlan } from "@/lib/api";
import { moveAssemblyClipInTimeline, removeAssemblyClip, splitAssemblyClip, trimAssemblyClip } from "./assemblyEditing";
function plan(): AssemblyEditPlan { return { id: "p", scope: "project", revision: 1, target_duration_ms: 6000, provenance: {}, markers: [], lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [
    { id: "a", timeline_start_ms: 0, timeline_end_ms: 4000, source_start_ms: 1000, source_end_ms: 5000, source_refs: ["frame:a"], enabled: true },
    { id: "b", timeline_start_ms: 4000, timeline_end_ms: 6000, source_start_ms: 0, source_end_ms: 2000, source_refs: ["frame:b"], enabled: true },
] }] }; }
describe("Assembly editing", () => {
    it("splits at the mapped source position without changing subsequent shots", () => {
        const source = plan(); const split = splitAssemblyClip(source, "v", "a", 1500, "new");
        expect(split.lanes[0].clips[0]).toMatchObject({ timeline_end_ms: 1500, source_end_ms: 2500 });
        expect(split.lanes[0].clips[1]).toMatchObject({ id: "new", timeline_start_ms: 1500, timeline_end_ms: 4000, source_start_ms: 2500, source_end_ms: 5000 });
        expect(split.lanes[0].clips[2]).toEqual(source.lanes[0].clips[1]);
        expect(source.lanes[0].clips).toHaveLength(2);
    });
    it("preserves existing speed mapping on a split", () => {
        const source = plan(); source.lanes[0].clips[0].source_end_ms = 9000;
        expect(splitAssemblyClip(source, "v", "a", 2000, "new").lanes[0].clips[0].source_end_ms).toBe(5000);
        expect(() => splitAssemblyClip(source, "v", "a", 0, "new")).toThrow("inside");
        expect(() => splitAssemblyClip(source, "v", "a", 1000, "b")).toThrow("already exists");
    });
    it("ripples video after original-speed trimming", () => {
        const trimmed = trimAssemblyClip(plan(), "v", "a", 2000, 4000);
        expect(trimmed.target_duration_ms).toBe(4000);
        expect(trimmed.lanes[0].clips[0]).toMatchObject({ timeline_start_ms: 0, timeline_end_ms: 2000, source_start_ms: 2000, source_end_ms: 4000 });
        expect(trimmed.lanes[0].clips[1]).toMatchObject({ timeline_start_ms: 2000, timeline_end_ms: 4000 });
    });
    it("refuses trimming that would orphan independent captions", () => {
        const source = plan(); source.lanes.push({ id: "s", kind: "subtitle", allow_overlap: false, clips: [{ id: "c", text: "hello", timeline_start_ms: 5000, timeline_end_ms: 6000, enabled: true, source_refs: [] }] });
        expect(() => trimAssemblyClip(source, "v", "a", 2000, 4000)).toThrow("adjust those first");
    });
    it("ripples remaining video clips after deletion", () => {
        const removed = removeAssemblyClip(plan(), "v", "a");
        expect(removed.target_duration_ms).toBe(2000);
        expect(removed.lanes[0].clips[0]).toMatchObject({ id: "b", timeline_start_ms: 0, timeline_end_ms: 2000 });
    });
    it("refuses deletion that would orphan independent captions", () => {
        const source = plan(); source.lanes.push({ id: "s", kind: "subtitle", allow_overlap: false, clips: [{ id: "c", text: "late", timeline_start_ms: 1500, timeline_end_ms: 2500, enabled: true, source_refs: [] }] });
        expect(() => removeAssemblyClip(source, "v", "a")).toThrow("past the video end");
    });
    it("moves an audio or caption clip while preserving duration", () => {
        const source = { ...plan(), lanes: [{ id: "s", kind: "subtitle" as const, allow_overlap: false, clips: [{ id: "c", timeline_start_ms: 500, timeline_end_ms: 1500, text: "cue", enabled: true, source_refs: [] }] }] };
        const moved = moveAssemblyClipInTimeline(source, "s", "c", 2500);
        expect(moved.lanes[0].clips[0]).toMatchObject({ timeline_start_ms: 2500, timeline_end_ms: 3500 });
    });
    it("rejects moving a video clip out of its sequence", () => {
        expect(() => moveAssemblyClipInTimeline(plan(), "v", "a", 500)).toThrow("remain in sequence");
    });
});
