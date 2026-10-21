import { expect, it } from "vitest";
import { restoreStoryMapMilestoneDefaults } from "@/lib/directorStoryMap";
it("restores missing optional note/role from previously returned results without mutating them", () => {
    const original = { story_threads: [{ milestones: [{ event_id: "event-1", role: "setup" }, { event_id: "event-2" }] }] };
    expect(restoreStoryMapMilestoneDefaults(original)).toEqual({ story_threads: [{ milestones: [
        { event_id: "event-1", role: "setup", note: "" }, { event_id: "event-2", role: "progress", note: "" },
    ] }] });
    expect(original.story_threads[0].milestones[0]).not.toHaveProperty("note");
});
it("preserves explicit notes and malformed values for validation", () => {
    const original = { story_threads: [{ milestones: [{ event_id: "event-1", note: null, role: "wrong" }, { event_id: "event-2", note: "用户注释" }] }] };
    const result = restoreStoryMapMilestoneDefaults(original) as typeof original;
    expect(result.story_threads[0].milestones[0]).toEqual(original.story_threads[0].milestones[0]);
    expect(result.story_threads[0].milestones[1].note).toBe("用户注释");
    expect(restoreStoryMapMilestoneDefaults("bad")).toBe("bad");
});
