export interface AssemblyFrameInput {
    id: string;
    selected_video_id?: string | null;
    dubbed_video_url?: string | null;
    dubbed_video_task_id?: string | null;
}

export interface AssemblyVideoTaskInput {
    id: string;
    frame_id?: string | null;
    status?: string | null;
    video_url?: string | null;
    duration?: number | null;
    model?: string | null;
}

export interface AssemblyVideoCandidate {
    id: string | null;
    video_url: string;
    duration?: number | null;
    model?: string | null;
    source: "dubbed" | "selected" | "default";
}

/**
 * Resolve the clip that the backend merge pipeline will use for one frame.
 *
 * A selected take is authoritative. For older projects where no take was
 * persisted yet, the backend falls back to the first completed task for the
 * frame, so the assembly gate must recognise that same fallback as ready.
 */
export function resolveAssemblyVideo(
    frame: AssemblyFrameInput,
    tasks: AssemblyVideoTaskInput[],
): AssemblyVideoCandidate | null {
    if (frame.dubbed_video_url) {
        return {
            id: frame.dubbed_video_task_id ?? frame.selected_video_id ?? null,
            video_url: frame.dubbed_video_url,
            source: "dubbed",
        };
    }

    if (frame.selected_video_id) {
        const selected = tasks.find((task) => task.id === frame.selected_video_id);
        if (selected?.status === "completed" && selected.video_url) {
            return {
                id: selected.id,
                video_url: selected.video_url,
                duration: selected.duration,
                model: selected.model,
                source: "selected",
            };
        }
        // The backend treats a persisted but unavailable selection as
        // authoritative and does not silently replace it with another take.
        return null;
    }

    const fallback = tasks.find(
        (task) => task.frame_id === frame.id && task.status === "completed" && Boolean(task.video_url),
    );
    return fallback?.video_url
        ? {
              id: fallback.id,
              video_url: fallback.video_url,
              duration: fallback.duration,
              model: fallback.model,
              source: "default",
          }
        : null;
}

export function countAssemblyReadyFrames(
    frames: AssemblyFrameInput[],
    tasks: AssemblyVideoTaskInput[],
): number {
    return frames.reduce(
        (ready, frame) => ready + (resolveAssemblyVideo(frame, tasks) ? 1 : 0),
        0,
    );
}

export interface AssemblyReadiness {
    total: number;
    ready: number;
    missing: number;
    canMerge: boolean;
}

/**
 * Describe the merge gate exposed by the assembly UI.
 *
 * The backend can concatenate every usable clip and skip frames that have no
 * clip yet. Keep the UI honest about that partial result while still allowing
 * a user to export when at least one frame is available.
 */
export function getAssemblyReadiness(
    frames: AssemblyFrameInput[],
    tasks: AssemblyVideoTaskInput[],
): AssemblyReadiness {
    const total = frames.length;
    const ready = countAssemblyReadyFrames(frames, tasks);
    return {
        total,
        ready,
        missing: Math.max(0, total - ready),
        canMerge: ready > 0,
    };
}
