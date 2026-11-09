import { expect, it } from "vitest";
import { reviewUncitedDirectorClaims, uncitedDirectorClaimPaths } from "@/lib/directorEvidenceReview";

it("only reclassifies uncited explicit claims on an editable copy", () => {
    const draft = { story_map: { fact_ledger_revision: 7,
        phases: [{ events: [
            { event_id: "event-a", description: "Preserve prose", evidence_status: "explicit", source_fact_ids: [] },
            { event_id: "event-b", evidence_status: "explicit", source_fact_ids: ["confirmed-fact"] },
            { event_id: "event-c", evidence_status: "conflicted", source_fact_ids: [] },
            { event_id: "event-d", evidence_status: "explicit", source_fact_ids: "invalid-value" },
        ] }], relationship_arcs: [{ states: [{ phase_id: "phase-a", state: "Ally", evidence_status: "explicit" }] }],
    } };
    expect(uncitedDirectorClaimPaths(draft)).toEqual(["phases.0.events.0", "relationship_arcs.0.states.0"]);
    const reviewed = reviewUncitedDirectorClaims(draft) as typeof draft;
    expect(uncitedDirectorClaimPaths(reviewed)).toEqual([]);
    expect(draft.story_map.phases[0].events[0].evidence_status).toBe("explicit");
    expect(reviewed.story_map.phases[0].events[0]).toEqual({ ...draft.story_map.phases[0].events[0], evidence_status: "interpretation" });
    expect(reviewed.story_map.phases[0].events.slice(1)).toEqual(draft.story_map.phases[0].events.slice(1));
    expect(reviewed.story_map.fact_ledger_revision).toBe(7);
    expect(reviewed.story_map.relationship_arcs[0].states[0]).toEqual({ phase_id: "phase-a", state: "Ally", evidence_status: "interpretation" });
});
