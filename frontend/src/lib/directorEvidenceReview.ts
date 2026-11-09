type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter(object) : [];

function uncitedClaims(profile: RecordValue): Array<{ claim: RecordValue; path: string }> {
    if (!object(profile.story_map)) return [];
    const result: Array<{ claim: RecordValue; path: string }> = [];
    const add = (claim: RecordValue, path: string) => {
        if (claim.evidence_status === "explicit" && Array.isArray(claim.source_fact_ids) && claim.source_fact_ids.length === 0) {
            result.push({ claim, path });
        } else if (claim.evidence_status === "explicit" && claim.source_fact_ids === undefined) {
            result.push({ claim, path });
        }
    };
    records(profile.story_map.phases).forEach((phase, i) => records(phase.events).forEach((event, j) => add(event, `phases.${i}.events.${j}`)));
    records(profile.story_map.relationship_arcs).forEach((arc, i) => records(arc.states).forEach((state, j) => add(state, `relationship_arcs.${i}.states.${j}`)));
    return result;
}

export function uncitedDirectorClaimPaths(profile: RecordValue): string[] {
    return uncitedClaims(profile).map(item => item.path);
}

/** Explicit user action on an editable copy; never save, apply or invent evidence. */
export function reviewUncitedDirectorClaims(profile: RecordValue): RecordValue {
    const copy = JSON.parse(JSON.stringify(profile)) as RecordValue;
    uncitedClaims(copy).forEach(({ claim }) => { claim.evidence_status = "interpretation"; });
    return copy;
}
