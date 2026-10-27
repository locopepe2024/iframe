export interface PreviousFrameTake {
    id: string;
    selected_video_id?: string | null;
    is_video_pinned?: boolean;
}

export interface PreviousVideoTake {
    id: string;
    frame_id?: string | null;
    status?: string | null;
    video_url?: string | null;
}

export function lockedPreviousTake(
    frame: PreviousFrameTake | null | undefined,
    tasks: PreviousVideoTake[],
): PreviousVideoTake | null {
    if (!frame?.is_video_pinned || !frame.selected_video_id) return null;
    return tasks.find(task =>
        task.id === frame.selected_video_id &&
        task.frame_id === frame.id &&
        task.status === "completed" &&
        Boolean(task.video_url)
    ) ?? null;
}
