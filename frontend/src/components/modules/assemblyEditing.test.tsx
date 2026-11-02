import { describe, expect, it } from "vitest";
import type { AssemblyEditPlan } from "@/lib/api";
import { insertAssemblyVideo, snapAssemblyTimelineTime, reorderAssemblyVideo, moveAssemblyClipInTimeline, removeAssemblyClip, splitAssemblyClip, trimAssemblyClip, trimAssemblyClipAtPlayhead } from "./assemblyEditing";
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

it("reorders videos by changing timeline ranges while preserving source crops", () => {
    const original = plan();
    const moved = reorderAssemblyVideo(original, "b", -1);
    const ordered = moved.lanes[0].clips.slice().sort((a,b) => a.timeline_start_ms - b.timeline_start_ms);
    expect(ordered.map(c => c.id)).toEqual(["b", "a"]);
    expect(ordered[0]).toMatchObject({ timeline_start_ms: 0, timeline_end_ms: 2000 });
    expect(ordered[1]).toMatchObject({ timeline_start_ms: 2000, timeline_end_ms: 6000 });
    expect(ordered[0].source_start_ms).toBe(original.lanes[0].clips[1].source_start_ms);
    expect(original.lanes[0].clips[0].timeline_start_ms).toBe(0);
});

it("inserts a split video at a distant boundary without moving captions or source crops", () => {
    const original = splitAssemblyClip(plan(), "v", "a", 2000, "middle");
    const moved = insertAssemblyVideo(original, "a", "b", true);
    const order = moved.lanes[0].clips.slice().sort((a,b) => a.timeline_start_ms-b.timeline_start_ms);
    expect(order.map(c=>c.id)).toEqual(["middle", "b", "a"]);
    expect(order.map(c=>[c.timeline_start_ms,c.timeline_end_ms])).toEqual([[0,2000],[2000,4000],[4000,6000]]);
    expect(order[2].source_start_ms).toBe(1000);
    expect(moved.target_duration_ms).toBe(original.target_duration_ms);
    expect(insertAssemblyVideo(original, "a", "middle", false)).toBe(original);
    expect(insertAssemblyVideo(original, "a", "a", true)).toBe(original);
});

it("snaps a timeline edit to nearby boundaries and leaves distant edits unchanged", () => {
    const source = { ...plan(), lanes: [{ id: "s", kind: "subtitle" as const, allow_overlap: true, clips: [
        { id: "one", timeline_start_ms: 1000, timeline_end_ms: 2000, enabled: true, source_refs: [] },
        { id: "two", timeline_start_ms: 3000, timeline_end_ms: 4000, enabled: true, source_refs: [] },
    ] }] };
    expect(snapAssemblyTimelineTime(source, "s", "one", 3050)).toBe(3000);
    expect(snapAssemblyTimelineTime(source, "s", "one", 2181)).toBe(2181);
    expect(snapAssemblyTimelineTime(source, "s", "one", 45)).toBe(0);
});


describe('playhead directional trimming', () => {
    it.each([
        ['left', 2500, 5000, 2500, 4500],
        ['right', 1000, 2500, 1500, 3500],
    ] as const)('removes the %s side of a trimmed source and ripples following video', (side, sourceStart, sourceEnd, duration, total) => {
        const original = plan();
        const result = trimAssemblyClipAtPlayhead(original, 'v', 'a', 1500, side);
        expect(result.lanes[0].clips[0]).toMatchObject({ source_start_ms: sourceStart, source_end_ms: sourceEnd, timeline_start_ms: 0, timeline_end_ms: duration });
        expect(result.lanes[0].clips[1]).toMatchObject({ timeline_start_ms: duration, timeline_end_ms: total, source_start_ms: 0, source_end_ms: 2000 });
        expect(result.target_duration_ms).toBe(total);
        expect(original).toEqual(plan());
    });
    it.each(['left', 'right'] as const)('preserves source mapping and placement for audio when trimming %s', side => {
        const original = plan();
        original.lanes.push({ id: 'music', kind: 'bgm', allow_overlap: true, clips: [{ id: 'sound', timeline_start_ms: 1000, timeline_end_ms: 4000, source_start_ms: 5000, source_end_ms: 8000, enabled: true, source_refs: [] }] });
        const result = trimAssemblyClipAtPlayhead(original, 'music', 'sound', 2200, side);
        expect(result.lanes[1].clips[0]).toMatchObject(side === 'left'
            ? { timeline_start_ms: 2200, timeline_end_ms: 4000, source_start_ms: 6200, source_end_ms: 8000 }
            : { timeline_start_ms: 1000, timeline_end_ms: 2200, source_start_ms: 5000, source_end_ms: 6200 });
        expect(result.lanes[0]).toEqual(original.lanes[0]);
        expect(result.target_duration_ms).toBe(6000);
    });
    it.each(['left', 'right'] as const)('shortens captions on the %s without rewriting their content', side => {
        const original = plan();
        original.lanes.push({ id: 's', kind: 'subtitle', allow_overlap: false, clips: [{ id: 'cue', text: 'Keep these words', timeline_start_ms: 1000, timeline_end_ms: 4000, enabled: true, source_refs: [] }] });
        const result = trimAssemblyClipAtPlayhead(original, 's', 'cue', 2200, side);
        expect(result.lanes[1].clips[0]).toMatchObject({ text: 'Keep these words', timeline_start_ms: side === 'left' ? 2200 : 1000, timeline_end_ms: side === 'right' ? 2200 : 4000 });
        expect(result.lanes[0]).toEqual(original.lanes[0]);
    });
    it('rejects boundaries and does not partially edit when late captions would be orphaned', () => {
        const original = plan();
        for (const time of [0, 4000, -1, 1.5, NaN]) expect(() => trimAssemblyClipAtPlayhead(original, 'v', 'a', time, 'left')).toThrow('inside');
        original.lanes.push({ id: 's', kind: 'subtitle', allow_overlap: false, clips: [{ id: 'cue', text: 'Late', timeline_start_ms: 5500, timeline_end_ms: 6000, enabled: true, source_refs: [] }] });
        const snapshot = JSON.stringify(original);
        expect(() => trimAssemblyClipAtPlayhead(original, 'v', 'a', 1500, 'left')).toThrow('adjust those first');
        expect(JSON.stringify(original)).toBe(snapshot);
    });
});
