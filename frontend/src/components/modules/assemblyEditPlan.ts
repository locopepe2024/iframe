import type { AssemblyClip, AssemblyEditPlan, AssemblyLane, AssemblyMarker } from "@/lib/api";
import type { Project } from "@/store/projectStore";
import { resolveAssemblyVideo } from "./assemblyReadiness";

export const ASSEMBLY_DEFAULT_DURATION_MS = 60_000;

export function formatAssemblyTime(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Create a human-editable proposal from currently available Motion takes.
 * This is deliberately a local proposal: saving it is an explicit user
 * action, and it never starts a paid generation task.
 */
export function buildDraftAssemblyPlan(project: Project): AssemblyEditPlan {
    const frames = (project.frames ?? []) as any[];
    const tasks = (project.video_tasks ?? []) as any[];
    const usableFrames = frames.filter((frame) => resolveAssemblyVideo(frame, tasks));
    const segmentSize = usableFrames.length > 0
        ? Math.floor(ASSEMBLY_DEFAULT_DURATION_MS / usableFrames.length)
        : ASSEMBLY_DEFAULT_DURATION_MS;

    let cursor = 0;
    const clips: AssemblyClip[] = [];
    const markers: AssemblyMarker[] = [];
    usableFrames.forEach((frame, index) => {
        const take = resolveAssemblyVideo(frame, tasks);
        if (!take) return;
        const end = index === usableFrames.length - 1
            ? ASSEMBLY_DEFAULT_DURATION_MS
            : cursor + segmentSize;
        const sourceDuration = Math.max(
            1,
            Math.round((take.duration ?? frame.duration ?? 5) * 1000),
        );
        clips.push({
            id: `clip-${frame.id}`,
            timeline_start_ms: cursor,
            timeline_end_ms: end,
            source_start_ms: 0,
            source_end_ms: sourceDuration,
            source_project_id: project.id,
            source_episode_id: project.id,
            source_frame_id: frame.id,
            source_task_id: take.id,
            source_refs: [`frame:${frame.id}`],
            label: `Frame ${index + 1}`,
            enabled: true,
        });
        markers.push({
            id: `marker-${frame.id}`,
            time_ms: cursor,
            label: frame.dialogue || frame.action_description || `Frame ${index + 1}`,
            marker_type: "story_node",
            source_refs: [`frame:${frame.id}`],
            source_episode_id: project.id,
        });
        cursor = end;
    });

    const lanes: AssemblyLane[] = [
        { id: "video-main", kind: "video", clips, allow_overlap: false, label: "Video" },
        { id: "dialogue", kind: "dialogue", clips: [], allow_overlap: true, label: "Dialogue" },
        { id: "bgm", kind: "bgm", clips: [], allow_overlap: true, label: "BGM" },
        { id: "sfx", kind: "sfx", clips: [], allow_overlap: true, label: "SFX" },
    ];

    return {
        id: `assembly-${project.id}`,
        scope: "project",
        target_duration_ms: ASSEMBLY_DEFAULT_DURATION_MS,
        revision: 1,
        provenance: {
            origin: "assembly_ui_draft",
            frame_count: usableFrames.length,
        },
        lanes,
        markers,
    };
}

/** Build the same bounded proposal across ordered series episodes. */
export function buildDraftSeriesAssemblyPlan(
    seriesId: string,
    episodes: Project[],
): AssemblyEditPlan {
    const sources = episodes
        .slice()
        .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
        .flatMap((episode) => {
            const tasks = (episode.video_tasks ?? []) as any[];
            return (episode.frames ?? [])
                .map((frame: any) => ({
                    episode,
                    frame,
                    take: resolveAssemblyVideo(frame, tasks),
                }))
                .filter((item) => item.take);
        });
    const segmentSize = sources.length > 0
        ? Math.floor(ASSEMBLY_DEFAULT_DURATION_MS / sources.length)
        : ASSEMBLY_DEFAULT_DURATION_MS;
    let cursor = 0;
    const clips: AssemblyClip[] = [];
    const markers: AssemblyMarker[] = [];
    sources.forEach(({ episode, frame, take }, index) => {
        if (!take) return;
        const end = index === sources.length - 1
            ? ASSEMBLY_DEFAULT_DURATION_MS
            : cursor + segmentSize;
        clips.push({
            id: `clip-${episode.id}-${frame.id}`,
            timeline_start_ms: cursor,
            timeline_end_ms: end,
            source_start_ms: 0,
            source_end_ms: Math.max(1, Math.round((take.duration ?? frame.duration ?? 5) * 1000)),
            source_project_id: episode.id,
            source_episode_id: episode.id,
            source_frame_id: frame.id,
            source_task_id: take.id,
            source_refs: [`episode:${episode.id}:frame:${frame.id}`],
            label: `EP${episode.episode_number ?? "?"} · ${frame.id}`,
            enabled: true,
        });
        markers.push({
            id: `marker-${episode.id}-${frame.id}`,
            time_ms: cursor,
            label: `EP${episode.episode_number ?? "?"} · ${frame.dialogue || frame.action_description || frame.id}`,
            marker_type: episode.episode_number === 2 ? "memory" : "episode",
            source_refs: [`episode:${episode.id}:frame:${frame.id}`],
            source_episode_id: episode.id,
        });
        cursor = end;
    });
    return {
        id: `assembly-${seriesId}`,
        scope: "series",
        target_duration_ms: ASSEMBLY_DEFAULT_DURATION_MS,
        revision: 1,
        provenance: { origin: "assembly_ui_series_draft", episode_count: episodes.length },
        lanes: [
            { id: "video-main", kind: "video", clips, allow_overlap: false, label: "Video" },
            { id: "dialogue", kind: "dialogue", clips: [], allow_overlap: true, label: "Dialogue" },
            { id: "bgm", kind: "bgm", clips: [], allow_overlap: true, label: "BGM" },
            { id: "sfx", kind: "sfx", clips: [], allow_overlap: true, label: "SFX" },
        ],
        markers,
    };
}

export function updateAssemblyClip(
    plan: AssemblyEditPlan,
    laneId: string,
    clipId: string,
    patch: Partial<AssemblyClip>,
): AssemblyEditPlan {
    return {
        ...plan,
        lanes: plan.lanes.map((lane) => lane.id !== laneId
            ? lane
            : {
                ...lane,
                clips: lane.clips.map((clip) => clip.id !== clipId
                    ? clip
                    : { ...clip, ...patch }),
            }),
    };
}

export function moveAssemblyClip(
    plan: AssemblyEditPlan,
    laneId: string,
    clipId: string,
    direction: -1 | 1,
): AssemblyEditPlan {
    return {
        ...plan,
        lanes: plan.lanes.map((lane) => {
            if (lane.id !== laneId) return lane;
            const index = lane.clips.findIndex((clip) => clip.id === clipId);
            const next = index + direction;
            if (index < 0 || next < 0 || next >= lane.clips.length) return lane;
            const clips = [...lane.clips];
            [clips[index], clips[next]] = [clips[next], clips[index]];
            return { ...lane, clips };
        }),
    };
}
