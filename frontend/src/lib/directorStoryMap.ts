/** Schema defaults only: never invent identities, source versions or story content. */
type Entry = Record<string, unknown>;
const record = (value: unknown): value is Entry => Boolean(value && typeof value === "object" && !Array.isArray(value));
function entries(value: unknown, convert: (item: Entry) => Entry): unknown {
    return Array.isArray(value) ? value.map(item => record(item) ? convert(item) : item) : value;
}
export function restoreStoryMapDefaults(value: unknown): unknown {
    if (!record(value)) return value;
    const map: Entry = { schema_version: 1, people: [], phases: [], relationship_arcs: [], story_threads: [], ...value };
    map.people = entries(map.people, person => ({ variant_character_ids: [], ...person }));
    map.phases = entries(map.phases, phase => {
        const next: Entry = { label: "", time_anchor: "", events: [], ...phase };
        next.events = entries(next.events, event => ({
            order: 0, title: "", description: "", character_ids: [], character_refs: [], unresolved_character_refs: [],
            dramatic_function: "", source_fact_ids: [], evidence_status: "interpretation", ...event,
        }));
        return next;
    });
    map.relationship_arcs = entries(map.relationship_arcs, arc => {
        const next: Entry = { person_ids: [], person_refs: [], unresolved_person_refs: [], label: "", legacy_summary: "",
            evidence_status: "interpretation", states: [], ...arc };
        next.states = entries(next.states, state => ({ state: "", trigger_event_ids: [], source_fact_ids: [], evidence_status: "interpretation", ...state }));
        return next;
    });
    map.story_threads = entries(map.story_threads, thread => {
        const next: Entry = { label: "", person_ids: [], unresolved_person_refs: [], milestones: [], evidence_status: "interpretation", ...thread };
        next.milestones = entries(next.milestones, milestone => ({ role: "progress", note: "", ...milestone }));
        return next;
    });
    return map;
}
