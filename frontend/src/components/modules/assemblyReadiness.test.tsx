import { expect, it } from "vitest";
import { countAssemblyReadyFrames, getAssemblyReadiness, resolveAssemblyVideo } from "./assemblyReadiness";

const completed = (id: string, frame_id: string, video_url = `${id}.mp4`) => ({
    id,
    frame_id,
    status: "completed",
    video_url,
    duration: 5,
    model: "wan2.7-i2v",
});

it("uses an explicitly selected completed take", () => {
    const frame = { id: "frame-1", selected_video_id: "take-2" };
    const result = resolveAssemblyVideo(frame, [completed("take-1", frame.id), completed("take-2", frame.id)]);

    expect(result).toMatchObject({ id: "take-2", video_url: "take-2.mp4", source: "selected" });
});

it("treats a completed default take as ready when no selection was persisted", () => {
    const frame = { id: "frame-1" };
    const result = resolveAssemblyVideo(frame, [completed("take-1", frame.id)]);

    expect(result).toMatchObject({ id: "take-1", video_url: "take-1.mp4", source: "default" });
    expect(countAssemblyReadyFrames([frame], [completed("take-1", frame.id)])).toBe(1);
});

it("does not replace an unavailable persisted selection with another take", () => {
    const frame = { id: "frame-1", selected_video_id: "pending-take" };
    expect(resolveAssemblyVideo(frame, [completed("fallback", frame.id)])).toBeNull();
});

it("prefers an available dubbed clip for assembly", () => {
    const frame = { id: "frame-1", dubbed_video_url: "dubbed.mp4", dubbed_video_task_id: "take-1" };
    expect(resolveAssemblyVideo(frame, [])).toMatchObject({
        id: "take-1",
        video_url: "dubbed.mp4",
        source: "dubbed",
    });
});

it("allows a partial merge while reporting missing frames", () => {
    const frames = [{ id: "frame-1" }, { id: "frame-2" }];
    const readiness = getAssemblyReadiness(frames, [completed("take-1", "frame-1")]);

    expect(readiness).toEqual({ total: 2, ready: 1, missing: 1, canMerge: true });
});

it("does not allow a merge when no frame has a usable clip", () => {
    expect(getAssemblyReadiness([{ id: "frame-1" }], [])).toEqual({
        total: 1,
        ready: 0,
        missing: 1,
        canMerge: false,
    });
});
