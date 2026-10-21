/** Read legacy model results without inventing narrative content or coercing invalid fields. */
export function restoreStoryMapMilestoneDefaults(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const map = value as Record<string, unknown>;
    if (!Array.isArray(map.story_threads)) return value;
    return { ...map, story_threads: map.story_threads.map(thread => {
        if (!thread || typeof thread !== "object" || Array.isArray(thread)) return thread;
        if (!Array.isArray(thread.milestones)) return thread;
        return { ...thread, milestones: thread.milestones.map((milestone: unknown) => {
            if (!milestone || typeof milestone !== "object" || Array.isArray(milestone)) return milestone;
            // These are Pydantic schema defaults; null/wrong types remain invalid.
            return { role: "progress", note: "", ...milestone };
        }) };
    }) };
}
