import { expect, it } from "vitest";
import { restoreStoryMapDefaults } from "@/lib/directorStoryMap";
it("restores every optional field the visual editor consumes, including relation evidence and milestone notes", () => {
    const original = {
        schema_version: 1, source_revision: 2, source_revision_id: "source-2",
        people: [{ person_id: "p", display_name: "角色" }],
        phases: [{ phase_id: "phase", order: 0, events: [{ event_id: "event" }] }],
        relationship_arcs: [{ relationship_id: "arc", states: [{ phase_id: "phase" }] }],
        story_threads: [{ thread_id: "thread", milestones: [{ event_id: "event", role: "setup" }, { event_id: "event" }] }],
    };
    const saved = JSON.stringify(original);
    const result = restoreStoryMapDefaults(original) as any;
    expect(result.people[0].variant_character_ids).toEqual([]);
    expect(result.phases[0]).toMatchObject({ label: "", time_anchor: "" });
    expect(result.phases[0].events[0]).toMatchObject({ order: 0, title: "", description: "", character_ids: [], dramatic_function: "", source_fact_ids: [], evidence_status: "interpretation" });
    expect(result.relationship_arcs[0]).toMatchObject({ person_ids: [], label: "", legacy_summary: "" });
    expect(result.relationship_arcs[0].states[0]).toMatchObject({ state: "", trigger_event_ids: [], source_fact_ids: [], evidence_status: "interpretation" });
    expect(result.story_threads[0].milestones).toEqual([{ event_id: "event", role: "setup", note: "" }, { event_id: "event", role: "progress", note: "" }]);
    expect(JSON.stringify(original)).toBe(saved);
    expect(restoreStoryMapDefaults(result)).toEqual(result);
});
it("preserves explicit or invalid fields without coercion, and never fabricates required identity", () => {
    const original = { phases: null, relationship_arcs: [{ relationship_id: "r", states: [{ phase_id: "p", source_fact_ids: null, evidence_status: "wrong" }] }], story_threads: [{ milestones: [{ event_id: "e", note: null, role: "wrong" }, { event_id: "e2", note: "用户注释" }] }] };
    const result = restoreStoryMapDefaults(original) as any;
    expect(result.phases).toBeNull();
    expect(result.relationship_arcs[0].states[0].source_fact_ids).toBeNull();
    expect(result.relationship_arcs[0].states[0].evidence_status).toBe("wrong");
    expect(result.story_threads[0].milestones[0]).toEqual(original.story_threads[0].milestones[0]);
    expect(result.story_threads[0].milestones[1].note).toBe("用户注释");
    expect(result).not.toHaveProperty("source_revision");
    expect(result.relationship_arcs[0].states[0].evidence_status).not.toBe("explicit");
    expect(restoreStoryMapDefaults("bad")).toBe("bad");
});
