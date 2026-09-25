// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import type { DirectorProfile, ScriptFactLedgerQueryEntry } from "@/store/projectStore";
import DirectorInterpretationVisualEditor from "./DirectorInterpretationVisualEditor";
import { createDirectorStoryMapFromLegacy } from "./DirectorStoryMapSection";

const people = [
    { person_id: "shen", display_name: "Shen Xia", variant_character_ids: ["shen-college"] },
    { person_id: "zhou", display_name: "Zhou Han", variant_character_ids: ["zhou-college"] },
];

const characters = [
    { id: "shen-college", name: "Shen Xia (college)", persona: "Shen Xia", base_character_id: "shen" },
    { id: "zhou-college", name: "Zhou Han (college)", persona: "Zhou Han", base_character_id: "zhou" },
];

const fact: ScriptFactLedgerQueryEntry = {
    fact_id: "fact-meet",
    kind: "event",
    subject_ids: ["shen", "zhou"],
    phase: "University",
    source_revision: 1,
    source_revision_id: "source-r1:test-hash",
    source_ranges: [{ start: 0, end: 28 }],
    value: { summary: "They meet in the university library" },
    evidence_status: "confirmed",
    conflict_group_id: null,
    evidence: [{ start: 0, end: 28, text: "Shen Xia and Zhou Han meet in the library." }],
};

const storyMap: NonNullable<DirectorProfile["story_map"]> = {
    schema_version: 1,
    source_revision: 1,
    source_revision_id: "source-r1:test-hash",
    fact_ledger_revision: 1,
    people,
    phases: [{
        phase_id: "phase-university",
        order: 0,
        label: "University",
        time_anchor: "College years",
        events: [{
            event_id: "event-meet",
            order: 0,
            title: "First meeting",
            description: "They meet in the library",
            character_ids: ["shen-college", "zhou-college"],
            dramatic_function: "Establish the relationship",
            source_fact_ids: [],
            evidence_status: "interpretation",
        }],
    }],
    relationship_arcs: [{
        relationship_id: "relationship-main",
        person_ids: ["shen", "zhou"],
        label: "College partners",
        legacy_summary: "",
        states: [{
            phase_id: "phase-university",
            state: "They are dating",
            trigger_event_ids: ["event-meet"],
            source_fact_ids: [],
            evidence_status: "interpretation",
        }],
    }],
    story_threads: [{
        thread_id: "thread-main",
        label: "Main relationship",
        person_ids: ["shen", "zhou"],
        milestones: [],
    }],
};

const profile: Record<string, unknown> = {
    setting: { locations: "Campus" },
    timeline: [{ phase: "University", events: "They meet", relationship_state: "Together", source: "Scene 1" }],
    relationships: [{ pair: "Shen Xia—Zhou Han", initial: "Close", change: "Long distance", final: "Separated", legacy_note: "keep me" }],
    key_events: [{ event: "Leaving", function: "Break in routine", weight: "turning point", source: "Scene 4" }],
    emotional_arc: "Longing",
    pacing: "Slow down at separation",
    visual_language: "Natural light",
    performance_direction: "Restrained",
    dialogue_direction: "Keep original dialogue",
    sound_direction: "Rain",
    continuity_constraints: ["Keep the ring on the left hand"],
    prohibitions: ["Do not invent a wedding"],
    unresolved_questions: ["Exact year"],
    future_field: { preserved: true },
};

function renderEditor(
    activeProfile: Record<string, unknown> = profile,
    onChange: (profile: Record<string, unknown>) => void = vi.fn(),
    facts: ScriptFactLedgerQueryEntry[] = [],
    factLedgerRevision: number | null = 1,
) {
    function Harness() {
        const [currentProfile, setCurrentProfile] = React.useState<Record<string, unknown>>(activeProfile);
        return (
            <NextIntlClientProvider locale="en" messages={messages}>
                <DirectorInterpretationVisualEditor
                    profile={currentProfile}
                    onChange={next => { onChange(next); setCurrentProfile(next); }}
                    sourceRevision={1}
                    characters={characters}
                    facts={facts}
                    factLedgerRevision={factLedgerRevision}
                />
            </NextIntlClientProvider>
        );
    }
    return {
        onChange,
        ...render(<Harness />),
    };
}

it("requires an explicit user action to build a map from legacy phases and keeps old relationship summaries separate", () => {
    const onChange = vi.fn();
    renderEditor(profile, onChange);

    expect(screen.getByText("Initial: Close · Change: Long distance · Ending: Separated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create visual story map" }));

    const changed = onChange.mock.lastCall?.[0] as Record<string, unknown> | undefined;
    expect(changed).toEqual(expect.objectContaining({
        relationships: profile.relationships,
        future_field: profile.future_field,
        story_map: expect.objectContaining({
            source_revision: 1,
            fact_ledger_revision: null,
            relationship_arcs: [],
            phases: [expect.objectContaining({
                label: "University",
                events: [expect.objectContaining({
                    description: "They meet",
                    evidence_status: "interpretation",
                    source_fact_ids: [],
                })],
            })],
        }),
    }));
});

it("builds an explicit story map from a legacy timeline without inventing phase relationship states", () => {
    const result = createDirectorStoryMapFromLegacy(profile, 4, characters);
    expect(result.source_revision).toBe(4);
    expect(result.people).toEqual(people);
    expect(result.phases[0].events[0].evidence_status).toBe("interpretation");
    expect(result.relationship_arcs).toEqual([]);
});

it("rejects a malformed story map instead of rendering incomplete arrays", () => {
    renderEditor({
        ...profile,
        story_map: {
            schema_version: 1,
            source_revision: 1,
            source_revision_id: "source-r1:test-hash",
            fact_ledger_revision: null,
        },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("incomplete or malformed");
});

it("edits events, reorders phases, and adds a user described event in the same story map", () => {
    const onChange = vi.fn();
    renderEditor({ ...profile, story_map: storyMap }, onChange);

    fireEvent.click(screen.getByRole("button", { name: /First meeting/ }));
    fireEvent.change(screen.getByLabelText("What happens"), { target: { value: "They meet and exchange books" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        story_map: expect.objectContaining({
            phases: [expect.objectContaining({ events: [expect.objectContaining({ description: "They meet and exchange books" })] })],
        }),
        future_field: profile.future_field,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    const phaseNameFields = screen.getAllByLabelText("Phase name");
    fireEvent.change(phaseNameFields[1], { target: { value: "Graduation" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add event" })[1]);
    fireEvent.change(screen.getByLabelText("What happens"), { target: { value: "They begin a long-distance relationship" } });

    const result = onChange.mock.lastCall?.[0] as Record<string, unknown>;
    const resultMap = result.story_map as NonNullable<DirectorProfile["story_map"]>;
    expect(resultMap.phases).toHaveLength(2);
    expect(resultMap.phases[1].events[0]).toEqual(expect.objectContaining({
        description: "They begin a long-distance relationship",
        evidence_status: "interpretation",
    }));
});

it("selects a relationship edge and edits its state for a specific phase", () => {
    const onChange = vi.fn();
    renderEditor({ ...profile, story_map: storyMap }, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Select relationship: Shen Xia ↔ Zhou Han" }));
    fireEvent.change(screen.getByLabelText("Relationship state"), { target: { value: "They are growing apart" } });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        story_map: expect.objectContaining({
            relationship_arcs: [expect.objectContaining({
                states: [expect.objectContaining({
                    phase_id: "phase-university",
                    state: "They are growing apart",
                })],
            })],
        }),
    }));
});

it("links an event to exact confirmed ledger text and adds an event to a story thread lane", () => {
    const onChange = vi.fn();
    renderEditor({ ...profile, story_map: storyMap }, onChange, [fact]);

    fireEvent.click(screen.getByRole("button", { name: /First meeting/ }));
    fireEvent.click(screen.getByText(/Script evidence/));
    fireEvent.click(screen.getAllByRole("checkbox", { name: /fact-meet/ })[0]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        story_map: expect.objectContaining({
            fact_ledger_revision: 1,
            phases: [expect.objectContaining({ events: [expect.objectContaining({ source_fact_ids: ["fact-meet"] })] })],
        }),
    }));

    fireEvent.change(screen.getByLabelText("Add an existing event in University"), { target: { value: "event-meet" } });
    const result = onChange.mock.lastCall?.[0] as Record<string, unknown>;
    const resultMap = result.story_map as NonNullable<DirectorProfile["story_map"]>;
    expect(resultMap.story_threads[0].milestones).toEqual([
        { event_id: "event-meet", role: "progress", note: "" },
    ]);
});

it("appends phase and event order values after existing gaps", () => {
    const onChange = vi.fn();
    const gappedMap = {
        ...storyMap,
        phases: [{
            ...storyMap.phases[0],
            order: 4,
            events: [{ ...storyMap.phases[0].events[0], order: 6 }],
        }],
    };
    renderEditor({ ...profile, story_map: gappedMap }, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    let changed = onChange.mock.lastCall?.[0] as Record<string, unknown>;
    let changedMap = changed.story_map as NonNullable<DirectorProfile["story_map"]>;
    expect(changedMap.phases[0].events.map(event => event.order)).toEqual([6, 7]);

    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    changed = onChange.mock.lastCall?.[0] as Record<string, unknown>;
    changedMap = changed.story_map as NonNullable<DirectorProfile["story_map"]>;
    expect(changedMap.phases.map(phase => phase.order)).toEqual([4, 5]);
});

it("cleans deleted event references and clears the ledger pin when no citations remain", () => {
    const onChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const referencedMap = {
        ...storyMap,
        phases: [{
            ...storyMap.phases[0],
            events: [{ ...storyMap.phases[0].events[0], source_fact_ids: ["fact-meet"] }],
        }],
        relationship_arcs: [{
            ...storyMap.relationship_arcs[0],
            states: [{ ...storyMap.relationship_arcs[0].states[0], source_fact_ids: [], trigger_event_ids: ["event-meet"] }],
        }],
        story_threads: [{
            ...storyMap.story_threads[0],
            milestones: [{ event_id: "event-meet", role: "turn" as const, note: "Changes the relationship" }],
        }],
    };
    renderEditor({ ...profile, story_map: referencedMap }, onChange);

    fireEvent.click(screen.getByRole("button", { name: /First meeting/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete event 1" }));

    const changed = onChange.mock.lastCall?.[0] as Record<string, unknown>;
    const changedMap = changed.story_map as NonNullable<DirectorProfile["story_map"]>;
    expect(changedMap.phases[0].events).toEqual([]);
    expect(changedMap.relationship_arcs[0].states[0].trigger_event_ids).toEqual([]);
    expect(changedMap.story_threads[0].milestones).toEqual([]);
    expect(changedMap.fact_ledger_revision).toBeNull();
    confirm.mockRestore();
});

it("does not offer citations from a different pinned ledger revision", () => {
    const mismatchedProfile = {
        ...profile,
        story_map: { ...storyMap, fact_ledger_revision: 2 },
    };
    renderEditor(mismatchedProfile, vi.fn(), [fact], 1);

    fireEvent.click(screen.getByRole("button", { name: /First meeting/ }));
    fireEvent.click(screen.getByText(/Script evidence/));

    expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("ledger v2"))).toBe(true);
    expect(screen.queryByRole("checkbox", { name: /fact-meet/ })).not.toBeInTheDocument();
});
