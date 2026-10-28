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

/** Remove a clip. Video removal ripples the remaining video sequence only. */
export function removeAssemblyClip(plan: AssemblyEditPlan, laneId: string, clipId: string): AssemblyEditPlan {
    const lane = plan.lanes.find(l => l.id === laneId);
    if (!lane || !lane.clips.some(c => c.id === clipId)) throw new Error("Clip not found");
    const next: AssemblyEditPlan = { ...plan, lanes: plan.lanes.map(l => l.id === laneId ? { ...l, clips: l.clips.filter(c => c.id !== clipId) } : l) };
    if (lane.kind !== "video") return next;
    const ordered = next.lanes.filter(l => l.kind === "video").flatMap(l => l.clips)
        .sort((a, b) => a.timeline_start_ms - b.timeline_start_ms || a.id.localeCompare(b.id));
    let cursor = 0;
    const ranges = new Map<string, [number, number]>();
    for (const item of ordered) {
        const duration = item.timeline_end_ms - item.timeline_start_ms;
        if (duration <= 0) throw new Error("Video clips must have positive duration");
        ranges.set(item.id, [cursor, cursor + duration]);
        cursor += duration;
    }
    if (next.lanes.some(l => l.kind !== "video" && l.clips.some(c => c.timeline_end_ms > cursor)) || next.markers.some(m => m.time_ms > cursor)) {
        throw new Error("Delete would leave audio, captions or markers past the video end; adjust those first");
    }
    return { ...next, target_duration_ms: Math.max(1, cursor), lanes: next.lanes.map(l => l.kind !== "video" ? l : {
        ...l, clips: l.clips.map(c => { const [start, end] = ranges.get(c.id)!; return { ...c, timeline_start_ms: start, timeline_end_ms: end }; }),
    }) };
}

/** Move an audio/caption clip without changing its duration or crossing its lane's clips. */
export function moveAssemblyClipInTimeline(plan: AssemblyEditPlan, laneId: string, clipId: string, start: number): AssemblyEditPlan {
    if (!Number.isInteger(start) || start < 0) throw new Error("Clip position must be a non-negative integer millisecond");
    const lane = plan.lanes.find(l => l.id === laneId);
    const clip = lane?.clips.find(c => c.id === clipId);
    if (!lane || !clip) throw new Error("Clip not found");
    if (lane.kind === "video") throw new Error("Video clips must remain in sequence; trim or split them instead");
    const duration = clip.timeline_end_ms - clip.timeline_start_ms;
    const end = start + duration;
    if (end > plan.target_duration_ms) throw new Error("Clip exceeds the timeline duration");
    const clips = lane.clips.map(c => c.id === clipId ? { ...c, timeline_start_ms: start, timeline_end_ms: end } : c);
    if (!lane.allow_overlap && clips.some((a, i) => clips.some((b, j) => i !== j && a.timeline_start_ms < b.timeline_end_ms && b.timeline_start_ms < a.timeline_end_ms))) {
        throw new Error("Clip would overlap another clip");
    }
    return { ...plan, lanes: plan.lanes.map(l => l.id === laneId ? { ...l, clips } : l) };
}

/** Resize one timeline edge, preserving source mapping for media clips. */
export function resizeAssemblyClipInTimeline(plan: AssemblyEditPlan, laneId: string, clipId: string, edge: "start" | "end", time: number): AssemblyEditPlan {
    if (!Number.isInteger(time)) throw new Error("Clip edge must be an integer millisecond");
    const lane = plan.lanes.find(l => l.id === laneId);
    const clip = lane?.clips.find(c => c.id === clipId);
    if (!lane || !clip) throw new Error("Clip not found");
    if (lane.kind === "video") {
        const sourceStart = clip.source_start_ms ?? 0;
        const sourceEnd = clip.source_end_ms ?? sourceStart + clip.timeline_end_ms - clip.timeline_start_ms;
        const duration = clip.timeline_end_ms - clip.timeline_start_ms;
        const mapped = sourceStart + Math.round((time - clip.timeline_start_ms) / duration * (sourceEnd - sourceStart));
        return trimAssemblyClip(plan, laneId, clipId, edge === "start" ? mapped : sourceStart, edge === "end" ? mapped : sourceEnd);
    }
    const nextStart = edge === "start" ? time : clip.timeline_start_ms;
    const nextEnd = edge === "end" ? time : clip.timeline_end_ms;
    if (nextEnd - nextStart < 10) throw new Error("Clip must keep at least 10 milliseconds");
    if (nextStart < 0 || nextEnd > plan.target_duration_ms) throw new Error("Clip exceeds the timeline duration");
    const clips = lane.clips.map(c => c.id === clipId ? { ...c, timeline_start_ms: nextStart, timeline_end_ms: nextEnd } : c);
    if (!lane.allow_overlap && clips.some((a, i) => clips.some((b, j) => i !== j && a.timeline_start_ms < b.timeline_end_ms && b.timeline_start_ms < a.timeline_end_ms))) throw new Error("Clip would overlap another clip");
    return { ...plan, lanes: plan.lanes.map(l => l.id === laneId ? { ...l, clips } : l) };
}

/** Reorder an adjacent video pair and rebuild contiguous timeline positions. */
export function reorderAssemblyVideo(plan: AssemblyEditPlan, clipId: string, direction: -1 | 1): AssemblyEditPlan {
    const videos = plan.lanes.filter(l => l.kind === "video").flatMap(l => l.clips).sort((a,b) => a.timeline_start_ms - b.timeline_start_ms);
    const index = videos.findIndex(c => c.id === clipId), other = index + direction;
    if (index < 0 || other < 0 || other >= videos.length) return plan;
    [videos[index], videos[other]] = [videos[other], videos[index]];
    let cursor = 0;
    const positions = new Map(videos.map(c => { const start = cursor; cursor += c.timeline_end_ms - c.timeline_start_ms; return [c.id, [start, cursor]] as const; }));
    return { ...plan, lanes: plan.lanes.map(l => l.kind !== "video" ? l : { ...l, clips: l.clips.map(c => ({ ...c, timeline_start_ms: positions.get(c.id)![0], timeline_end_ms: positions.get(c.id)![1] })) }) };
}
