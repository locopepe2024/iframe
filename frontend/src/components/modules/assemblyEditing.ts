import type { AssemblyClip, AssemblyEditPlan } from "@/lib/api";

/** Split without moving other lanes or changing the source-to-timeline mapping. */
export function splitAssemblyClip(plan: AssemblyEditPlan, laneId: string, clipId: string, time: number, newId: string): AssemblyEditPlan {
    if (!Number.isInteger(time)) throw new Error("Split position must be an integer millisecond");
    if (plan.lanes.some(l => l.clips.some(c => c.id === newId))) throw new Error("Clip ID already exists");
    const lane = plan.lanes.find(l => l.id === laneId);
    const clip = lane?.clips.find(c => c.id === clipId);
    if (!clip || time <= clip.timeline_start_ms || time >= clip.timeline_end_ms) throw new Error("Place the playhead inside a clip to split it");
    const sourceStart = clip.source_start_ms ?? 0;
    const sourceEnd = clip.source_end_ms ?? sourceStart + clip.timeline_end_ms - clip.timeline_start_ms;
    const sourceCut = sourceStart + Math.round((time - clip.timeline_start_ms) / (clip.timeline_end_ms - clip.timeline_start_ms) * (sourceEnd - sourceStart));
    if (lane?.kind !== "subtitle" && (sourceCut <= sourceStart || sourceCut >= sourceEnd)) throw new Error("Split is too close to the source boundary");
    const first: AssemblyClip = { ...clip, timeline_end_ms: time, ...(lane?.kind === "subtitle" ? {} : { source_end_ms: sourceCut }) };
    const second: AssemblyClip = { ...clip, id: newId, timeline_start_ms: time, ...(lane?.kind === "subtitle" ? {} : { source_start_ms: sourceCut, source_end_ms: sourceEnd }) };
    return { ...plan, lanes: plan.lanes.map(l => l.id !== laneId ? l : { ...l, clips: l.clips.flatMap(c => c.id === clipId ? [first, second] : [c]) }) };
}

/** Trim at original speed and ripple only video; independent audio/captions stay anchored. */
export function trimAssemblyClip(plan: AssemblyEditPlan, laneId: string, clipId: string, start: number, end: number): AssemblyEditPlan {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw new Error("Source out must be after source in (integer milliseconds)");
    const lane = plan.lanes.find(l => l.id === laneId);
    if (!lane || lane.kind === "subtitle") throw new Error("Select a media clip to trim");
    const clip = lane.clips.find(c => c.id === clipId);
    if (!clip) throw new Error("Clip not found");
    let next = { ...plan, lanes: plan.lanes.map(l => l.id !== laneId ? l : { ...l, clips: l.clips.map(c => c.id !== clipId ? c : { ...c, source_start_ms: start, source_end_ms: end, timeline_end_ms: c.timeline_start_ms + end - start }) }) };
    if (lane.kind === "video") {
        const ordered = next.lanes.filter(l => l.kind === "video").flatMap(l => l.clips).sort((a, b) => a.timeline_start_ms - b.timeline_start_ms);
        let cursor = 0;
        const ranges = new Map<string, [number, number]>();
        for (const item of ordered) { const duration = item.timeline_end_ms - item.timeline_start_ms; ranges.set(item.id, [cursor, cursor + duration]); cursor += duration; }
        if (next.lanes.some(l => l.kind !== "video" && l.clips.some(c => c.timeline_end_ms > cursor)) || next.markers.some(m => m.time_ms > cursor)) throw new Error("Trim would leave audio, captions or markers past the video end; adjust those first");
        next = { ...next, target_duration_ms: Math.max(1, cursor), lanes: next.lanes.map(l => l.kind !== "video" ? l : { ...l, clips: l.clips.map(c => { const [a, b] = ranges.get(c.id)!; return { ...c, timeline_start_ms: a, timeline_end_ms: b }; }) }) };
    } else if (next.lanes.some(l => l.clips.some(c => c.timeline_end_ms > next.target_duration_ms))) throw new Error("Trim exceeds the timeline duration");
    const updated = next.lanes.find(l => l.id === laneId)!;
    if (!updated.allow_overlap && updated.clips.some((a, i) => updated.clips.some((b, j) => i !== j && a.timeline_start_ms < b.timeline_end_ms && b.timeline_start_ms < a.timeline_end_ms))) throw new Error("Trim would overlap another clip");
    return next;
}
