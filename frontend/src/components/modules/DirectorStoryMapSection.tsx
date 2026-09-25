"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
    Character,
    DirectorEvidenceStatus,
    DirectorRelationshipArc,
    DirectorRelationshipState,
    DirectorStoryEvent,
    DirectorStoryMap,
    DirectorStoryPhase,
    DirectorStoryPerson,
    DirectorStoryThread,
    ScriptFactLedgerQueryEntry,
} from "@/store/projectStore";

type Draft = Record<string, unknown>;

const evidenceStatuses: DirectorEvidenceStatus[] = ["explicit", "interpretation", "uncertain", "conflicted"];
const milestoneRoles: DirectorStoryThread["milestones"][number]["role"][] = [
    "setup", "progress", "turn", "reveal", "payoff", "open", "close",
];

const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asEntry = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value));
const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === "string");
const asText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    return JSON.stringify(value, null, 2) ?? String(value);
};

function isDirectorStoryMap(value: unknown): value is DirectorStoryMap {
    if (!isRecord(value) || value.schema_version !== 1
        || !Number.isInteger(value.source_revision)
        || typeof value.source_revision_id !== "string"
        || (value.fact_ledger_revision !== null && !Number.isInteger(value.fact_ledger_revision))
        || !Array.isArray(value.people)
        || !Array.isArray(value.phases)
        || !Array.isArray(value.relationship_arcs)
        || !Array.isArray(value.story_threads)) return false;
    const people = value.people;
    const phases = value.phases;
    const arcs = value.relationship_arcs;
    const threads = value.story_threads;
    const validPeople = people.every(person => isRecord(person)
        && typeof person.person_id === "string"
        && typeof person.display_name === "string"
        && isStringArray(person.variant_character_ids));
    const validPhases = phases.every(phase => isRecord(phase)
        && typeof phase.phase_id === "string"
        && Number.isInteger(phase.order)
        && typeof phase.label === "string"
        && typeof phase.time_anchor === "string"
        && Array.isArray(phase.events)
        && phase.events.every(event => isRecord(event)
            && typeof event.event_id === "string"
            && Number.isInteger(event.order)
            && typeof event.title === "string"
            && typeof event.description === "string"
            && isStringArray(event.character_ids)
            && typeof event.dramatic_function === "string"
            && isStringArray(event.source_fact_ids)
            && evidenceStatuses.includes(event.evidence_status as DirectorEvidenceStatus)));
    const validArcs = arcs.every(arc => isRecord(arc)
        && typeof arc.relationship_id === "string"
        && Array.isArray(arc.person_ids)
        && arc.person_ids.length === 2
        && arc.person_ids.every(id => typeof id === "string")
        && typeof arc.label === "string"
        && typeof arc.legacy_summary === "string"
        && rows(arc.states).every(state => isRecord(state)
            && typeof state.phase_id === "string"
            && typeof state.state === "string"
            && isStringArray(state.trigger_event_ids)
            && isStringArray(state.source_fact_ids)
            && evidenceStatuses.includes(state.evidence_status as DirectorEvidenceStatus)));
    const validThreads = threads.every(thread => isRecord(thread)
        && typeof thread.thread_id === "string"
        && typeof thread.label === "string"
        && isStringArray(thread.person_ids)
        && rows(thread.milestones).every(milestone => isRecord(milestone)
            && typeof milestone.event_id === "string"
            && milestoneRoles.includes(milestone.role as DirectorStoryThread["milestones"][number]["role"])
            && typeof milestone.note === "string"));
    return validPeople && validPhases && validArcs && validThreads;
}

function createId(prefix: string): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function makePeople(characters: Character[]): DirectorStoryPerson[] {
    const byId = new Map(characters.map(character => [character.id, character]));
    const grouped = new Map<string, DirectorStoryPerson>();
    characters.forEach(character => {
        const personId = character.base_character_id || character.id;
        const base = byId.get(personId) ?? character;
        const person = grouped.get(personId) ?? {
            person_id: personId,
            display_name: base.persona || base.name || character.persona || character.name || personId,
            variant_character_ids: [],
        };
        if (!person.variant_character_ids.includes(character.id)) {
            person.variant_character_ids.push(character.id);
        }
        grouped.set(personId, person);
    });
    return Array.from(grouped.values()).sort((a, b) => a.display_name.localeCompare(b.display_name));
}

function legacyEvents(value: unknown): DirectorStoryEvent[] {
    const inputs = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
    return inputs.map((input, order) => {
        const entry = asEntry(input);
        const description = typeof input === "string"
            ? input
            : asText(entry.description ?? entry.event ?? entry.action ?? "");
        return {
            event_id: createId("event"),
            order,
            title: asText(entry.title ?? entry.name ?? ""),
            description,
            character_ids: [],
            dramatic_function: "",
            source_fact_ids: [],
            evidence_status: "interpretation",
        };
    });
}

export function createDirectorStoryMapFromLegacy(
    profile: Draft,
    sourceRevision: number,
    characters: Character[],
): DirectorStoryMap {
    const phases: DirectorStoryPhase[] = rows(profile.timeline).map((raw, order) => {
        const entry = asEntry(raw);
        const sourceEvents = entry.events ?? entry.event ?? entry.actions;
        return {
            phase_id: createId("phase"),
            order,
            label: asText(entry.phase ?? entry.label ?? ""),
            time_anchor: "",
            events: legacyEvents(sourceEvents),
        };
    });
    return {
        schema_version: 1,
        source_revision: sourceRevision,
        // The server binds the stable source identity when this user-created map is saved.
        source_revision_id: "",
        fact_ledger_revision: null,
        people: makePeople(characters),
        phases,
        // Legacy initial/change/final summaries deliberately remain unconverted.
        relationship_arcs: [],
        story_threads: [],
    };
}

function Field({
    label,
    value,
    onChange,
    multiline = false,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
    placeholder?: string;
}) {
    const className = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70";
    return (
        <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            {multiline ? (
                <textarea
                    aria-label={label}
                    value={value}
                    placeholder={placeholder}
                    onChange={event => onChange(event.target.value)}
                    className={`${className} min-h-20 resize-y`}
                />
            ) : (
                <input
                    aria-label={label}
                    value={value}
                    placeholder={placeholder}
                    onChange={event => onChange(event.target.value)}
                    className={className}
                />
            )}
        </label>
    );
}

function SelectField<T extends string>({
    label,
    value,
    options,
    optionLabel,
    onChange,
    disabled = false,
}: {
    label: string;
    value: T;
    options: T[];
    optionLabel: (option: T) => string;
    onChange: (value: T) => void;
    disabled?: boolean;
}) {
    return (
        <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <select
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={event => onChange(event.target.value as T)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50"
            >
                {options.map(option => <option key={option} value={option}>{optionLabel(option)}</option>)}
            </select>
        </label>
    );
}

function IconActions({
    label,
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp = true,
    canMoveDown = true,
}: {
    label: string;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onDelete: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
}) {
    const t = useTranslations("artDirection.directorEditor.storyMap");
    return (
        <div className="flex shrink-0 items-center gap-1">
            {onMoveUp && <button type="button" aria-label={t("moveUp", { item: label })} disabled={!canMoveUp} onClick={onMoveUp} className="rounded p-2 text-text-secondary hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-40"><ArrowUp size={15} aria-hidden="true" /></button>}
            {onMoveDown && <button type="button" aria-label={t("moveDown", { item: label })} disabled={!canMoveDown} onClick={onMoveDown} className="rounded p-2 text-text-secondary hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-40"><ArrowDown size={15} aria-hidden="true" /></button>}
            <button type="button" aria-label={t("delete", { item: label })} onClick={onDelete} className="rounded p-2 text-text-secondary hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"><Trash2 size={15} aria-hidden="true" /></button>
        </div>
    );
}

function factSummary(fact: ScriptFactLedgerQueryEntry): string {
    const value = fact.value ?? {};
    const prioritized = ["claim", "summary", "event", "description", "fact", "text", "name"];
    for (const key of prioritized) {
        if (typeof value[key] === "string" && value[key]) return value[key] as string;
    }
    return JSON.stringify(value) || fact.kind;
}

function FactPicker({
    label,
    selectedIds,
    facts,
    factLedgerRevision,
    mapLedgerRevision,
    loading,
    onChange,
}: {
    label: string;
    selectedIds: string[];
    facts: ScriptFactLedgerQueryEntry[];
    factLedgerRevision: number | null;
    mapLedgerRevision: number | null;
    loading: boolean;
    onChange: (ids: string[]) => void;
}) {
    const t = useTranslations("artDirection.directorEditor.storyMap");
    const [query, setQuery] = useState("");
    const revisionMatches = mapLedgerRevision === null || mapLedgerRevision === factLedgerRevision;
    const visibleFacts = useMemo(() => facts
        .filter(fact => fact.evidence_status !== "rejected")
        .filter(fact => `${fact.fact_id} ${fact.kind} ${factSummary(fact)} ${fact.evidence.map(span => span.text).join(" ")}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()))
        .slice(0, 40), [facts, query]);
    const toggle = (factId: string, checked: boolean) => {
        onChange(checked
            ? Array.from(new Set([...selectedIds, factId]))
            : selectedIds.filter(id => id !== factId));
    };

    return (
        <details className="rounded-md border border-border bg-background/50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                {label} <span className="ml-1 text-text-muted">{t("selectedFactCount", { count: selectedIds.length })}</span>
            </summary>
            <div className="mt-3 space-y-3">
                {loading ? (
                    <p className="text-xs text-text-muted">{t("loadingFacts")}</p>
                ) : factLedgerRevision === null ? (
                    <p className="text-xs text-text-muted">{t("noConfirmedLedger")}</p>
                ) : !revisionMatches ? (
                    <p role="alert" className="text-xs text-amber-200">{t("ledgerRevisionMismatch", { mapRevision: mapLedgerRevision ?? 0, availableRevision: factLedgerRevision })}</p>
                ) : facts.length === 0 ? (
                    <p className="text-xs text-text-muted">{t("noFacts")}</p>
                ) : (
                    <>
                        <p className="text-xs text-text-muted">{t("pinnedLedger", { revision: factLedgerRevision })}</p>
                        <input
                            aria-label={t("searchFacts")}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder={t("searchFacts")}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                        />
                        <div className="max-h-72 space-y-2 overflow-y-auto">
                            {visibleFacts.map(fact => {
                                const checked = selectedIds.includes(fact.fact_id);
                                return (
                                    <label key={fact.fact_id} className="flex cursor-pointer gap-2 rounded-md border border-border bg-surface p-2.5 text-xs hover:border-primary/60">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={event => toggle(fact.fact_id, event.target.checked)}
                                            className="mt-0.5 accent-primary"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                                                <span>{fact.kind}</span>
                                                <span className="font-mono text-text-muted">{fact.fact_id}</span>
                                                <span className="rounded bg-background px-1.5 py-0.5 text-text-secondary">{fact.evidence_status}</span>
                                            </span>
                                            <span className="mt-1 block text-text-secondary">{factSummary(fact)}</span>
                                            {fact.evidence[0] && (
                                                <span className="mt-1 block border-l-2 border-primary/40 pl-2 text-text-muted">
                                                    “{fact.evidence[0].text}” <span className="font-mono">[{fact.evidence[0].start}, {fact.evidence[0].end})</span>
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                );
                            })}
                            {visibleFacts.length === 0 && <p className="text-xs text-text-muted">{t("noMatchingFacts")}</p>}
                        </div>
                    </>
                )}
                {selectedIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" aria-label={t("selectedFactIds")}>
                        {selectedIds.map(id => <span key={id} className="rounded bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary">{id}</span>)}
                    </div>
                )}
            </div>
        </details>
    );
}

function EvidenceStatusField({
    value,
    onChange,
}: {
    value: DirectorEvidenceStatus;
    onChange: (value: DirectorEvidenceStatus) => void;
}) {
    const t = useTranslations("artDirection.directorEditor.storyMap");
    return <SelectField
        label={t("evidenceStatus")}
        value={value}
        options={evidenceStatuses}
        optionLabel={option => t(`evidence.${option}`)}
        onChange={onChange}
    />;
}

function StoryMapSection({
    profile,
    onChange,
    sourceRevision,
    characters,
    facts,
    factLedgerRevision,
    factsLoading,
    factsError,
    onReloadFacts,
}: {
    profile: Draft;
    onChange: (profile: Draft) => void;
    sourceRevision: number;
    characters: Character[];
    facts: ScriptFactLedgerQueryEntry[];
    factLedgerRevision: number | null;
    factsLoading: boolean;
    factsError: string;
    onReloadFacts: () => void;
}) {
    const t = useTranslations("artDirection.directorEditor.storyMap");
    const tLegacy = useTranslations("artDirection.directorEditor");
    const rawStoryMap = profile.story_map;
    const map = isDirectorStoryMap(rawStoryMap) ? rawStoryMap : null;
    const invalidMap = rawStoryMap !== undefined && rawStoryMap !== null && !map;
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [relationshipPeople, setRelationshipPeople] = useState<[string, string]>(["", ""]);
    const [selectedRelationshipId, setSelectedRelationshipId] = useState("");
    const people = map?.people ?? [];
    const phases = (map?.phases ?? []).slice().sort((a, b) => a.order - b.order);
    const allEvents = phases.flatMap(phase => phase.events);
    const characterById = useMemo(() => new Map(characters.map(character => [character.id, character])), [characters]);
    const staleSource = map !== null && map.source_revision !== sourceRevision;
    const replaceMap = (next: DirectorStoryMap) => onChange({ ...profile, story_map: next });
    const updateMap = (updater: (current: DirectorStoryMap) => DirectorStoryMap) => {
        if (!map) return;
        const next = updater(map);
        const hasFactReferences = [
            ...next.phases.flatMap(phase => phase.events.flatMap(event => event.source_fact_ids)),
            ...next.relationship_arcs.flatMap(arc => arc.states.flatMap(state => state.source_fact_ids)),
        ].length > 0;
        replaceMap({
            ...next,
            fact_ledger_revision: hasFactReferences
                ? next.fact_ledger_revision ?? factLedgerRevision
                : null,
        });
    };
    const setFactRefs = (nextIds: string[], updater: (ids: string[], current: DirectorStoryMap) => DirectorStoryMap) => {
        updateMap(current => updater(nextIds, current));
    };
    const updatePhase = (phaseId: string, patch: Partial<DirectorStoryPhase>) => updateMap(current => ({
        ...current,
        phases: current.phases.map(phase => phase.phase_id === phaseId ? { ...phase, ...patch } : phase),
    }));
    const updateEvent = (phaseId: string, eventId: string, patch: Partial<DirectorStoryEvent>) => updateMap(current => ({
        ...current,
        phases: current.phases.map(phase => phase.phase_id === phaseId
            ? { ...phase, events: phase.events.map(event => event.event_id === eventId ? { ...event, ...patch } : event) }
            : phase),
    }));
    const orderedPhases = (next: DirectorStoryPhase[]) => next.map((phase, order) => ({ ...phase, order }));
    const movePhase = (phaseId: string, direction: -1 | 1) => updateMap(current => {
        const next = current.phases.slice().sort((a, b) => a.order - b.order);
        const index = next.findIndex(phase => phase.phase_id === phaseId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= next.length) return current;
        [next[index], next[target]] = [next[target], next[index]];
        return { ...current, phases: orderedPhases(next) };
    });
    const addPhase = () => updateMap(current => {
        const nextOrder = current.phases.reduce((max, phase) => Math.max(max, phase.order), -1) + 1;
        const phase: DirectorStoryPhase = {
            phase_id: createId("phase"), order: nextOrder, label: "", time_anchor: "", events: [],
        };
        return { ...current, phases: [...current.phases, phase] };
    });
    const removePhase = (phaseId: string) => {
        const phase = phases.find(item => item.phase_id === phaseId);
        if (!phase || !window.confirm(t("confirmDeletePhase", { phase: phase.label || t("unnamedPhase") }))) return;
        const deletedEventIds = new Set(phase.events.map(event => event.event_id));
        updateMap(current => ({
            ...current,
            phases: orderedPhases(current.phases.filter(item => item.phase_id !== phaseId)),
            relationship_arcs: current.relationship_arcs.map(arc => ({
                ...arc,
                states: arc.states.filter(state => state.phase_id !== phaseId),
            })),
            story_threads: current.story_threads.map(thread => ({
                ...thread,
                milestones: thread.milestones.filter(milestone => !deletedEventIds.has(milestone.event_id)),
            })),
        }));
    };
    const moveEvent = (phaseId: string, eventId: string, direction: -1 | 1) => updateMap(current => ({
        ...current,
        phases: current.phases.map(phase => {
            if (phase.phase_id !== phaseId) return phase;
            const next = phase.events.slice().sort((a, b) => a.order - b.order);
            const index = next.findIndex(event => event.event_id === eventId);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= next.length) return phase;
            [next[index], next[target]] = [next[target], next[index]];
            return { ...phase, events: next.map((event, order) => ({ ...event, order })) };
        }),
    }));
    const addEvent = (phaseId: string) => {
        const event: DirectorStoryEvent = {
            event_id: createId("event"), order: 0, title: "", description: "", character_ids: [],
            dramatic_function: "", source_fact_ids: [], evidence_status: "interpretation",
        };
        updateMap(current => ({
            ...current,
            phases: current.phases.map(phase => phase.phase_id === phaseId
                ? {
                    ...phase,
                    events: [...phase.events, {
                        ...event,
                        order: phase.events.reduce((max, existing) => Math.max(max, existing.order), -1) + 1,
                    }],
                }
                : phase),
        }));
        setExpandedEventId(event.event_id);
    };
    const removeEvent = (phaseId: string, eventId: string) => {
        const event = allEvents.find(item => item.event_id === eventId);
        if (!event || !window.confirm(t("confirmDeleteEvent", { event: event.title || t("unnamedEvent") }))) return;
        updateMap(current => ({
            ...current,
            phases: current.phases.map(phase => phase.phase_id === phaseId
                ? { ...phase, events: phase.events.filter(item => item.event_id !== eventId).map((item, order) => ({ ...item, order })) }
                : phase),
            relationship_arcs: current.relationship_arcs.map(arc => ({
                ...arc,
                states: arc.states.map(state => ({
                    ...state,
                    trigger_event_ids: state.trigger_event_ids.filter(id => id !== eventId),
                })),
            })),
            story_threads: current.story_threads.map(thread => ({
                ...thread,
                milestones: thread.milestones.filter(milestone => milestone.event_id !== eventId),
            })),
        }));
        if (expandedEventId === eventId) setExpandedEventId(null);
    };
    const addRelationship = () => {
        if (!map || !relationshipPeople[0] || !relationshipPeople[1] || relationshipPeople[0] === relationshipPeople[1]) return;
        const arc: DirectorRelationshipArc = {
            relationship_id: createId("relationship"),
            person_ids: relationshipPeople,
            label: "",
            legacy_summary: "",
            states: [],
        };
        updateMap(current => ({ ...current, relationship_arcs: [...current.relationship_arcs, arc] }));
    };
    const updateArc = (relationshipId: string, patch: Partial<DirectorRelationshipArc>) => updateMap(current => ({
        ...current,
        relationship_arcs: current.relationship_arcs.map(arc => arc.relationship_id === relationshipId ? { ...arc, ...patch } : arc),
    }));
    const updateRelationshipState = (
        arc: DirectorRelationshipArc,
        phase: DirectorStoryPhase,
        patch: Partial<DirectorRelationshipState>,
    ) => updateArc(arc.relationship_id, {
        states: arc.states.some(state => state.phase_id === phase.phase_id)
            ? arc.states.map(state => state.phase_id === phase.phase_id ? { ...state, ...patch } : state)
            : [...arc.states, {
                phase_id: phase.phase_id,
                state: "",
                trigger_event_ids: [],
                source_fact_ids: [],
                evidence_status: "interpretation",
                ...patch,
            }],
    });
    const removeArc = (arc: DirectorRelationshipArc) => {
        if (!window.confirm(t("confirmDeleteRelationship", { relationship: relationshipLabel(arc, people) }))) return;
        updateMap(current => ({
            ...current,
            relationship_arcs: current.relationship_arcs.filter(item => item.relationship_id !== arc.relationship_id),
        }));
    };
    const addThread = () => updateMap(current => ({
        ...current,
        story_threads: [...current.story_threads, {
            thread_id: createId("thread"), label: "", person_ids: [], milestones: [],
        }],
    }));
    const updateThread = (thread: DirectorStoryThread, patch: Partial<DirectorStoryThread>) => updateMap(current => ({
        ...current,
        story_threads: current.story_threads.map(item => item.thread_id === thread.thread_id ? { ...item, ...patch } : item),
    }));
    const removeThread = (thread: DirectorStoryThread) => updateMap(current => ({
        ...current,
        story_threads: current.story_threads.filter(item => item.thread_id !== thread.thread_id),
    }));

    const oldRelationships = rows(profile.relationships).map(asEntry);
    const oldTimeline = rows(profile.timeline).map(asEntry);
    const oldKeyEvents = rows(profile.key_events).map(asEntry);
    const newMap = () => onChange({
        ...profile,
        story_map: createDirectorStoryMapFromLegacy(profile, sourceRevision, characters),
    });

    if (invalidMap) {
        return (
            <section role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-xs leading-5 text-amber-100">
                {t("invalidMap")}
            </section>
        );
    }

    if (!map) {
        return (
            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-map-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-story-map-title" className="text-sm font-semibold text-foreground">{t("title")}</h3>
                        <p className="mt-1 max-w-3xl text-xs leading-5 text-text-secondary">{t("legacyIntro")}</p>
                    </div>
                    <button type="button" onClick={newMap} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                        <Plus size={15} aria-hidden="true" />{t("createFromLegacy")}
                    </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-surface p-3">
                        <h4 className="text-xs font-semibold text-foreground">{t("legacyPhases", { count: oldTimeline.length })}</h4>
                        <ol className="mt-2 space-y-2">
                            {oldTimeline.map((phase, index) => (
                                <li key={`legacy-phase-${index}`} className="border-l-2 border-primary/30 pl-3 text-xs">
                                    <span className="font-medium text-foreground">{asText(phase.phase) || t("unnamedPhase")}</span>
                                    <span className="mt-1 block whitespace-pre-wrap text-text-secondary">{asText(phase.events)}</span>
                                </li>
                            ))}
                            {oldTimeline.length === 0 && <li className="text-xs text-text-muted">{t("noLegacyPhases")}</li>}
                        </ol>
                    </div>
                    <div className="rounded-md border border-border bg-surface p-3">
                        <h4 className="text-xs font-semibold text-foreground">{t("legacyRelationships", { count: oldRelationships.length })}</h4>
                        <ul className="mt-2 space-y-2">
                            {oldRelationships.map((relation, index) => (
                                <li key={`legacy-relation-${index}`} className="rounded border border-border bg-background p-2 text-xs">
                                    <span className="font-medium text-foreground">{asText(relation.pair ?? relation.people) || t("unnamedRelationship")}</span>
                                    <span className="mt-1 block text-text-secondary">{t("legacyArc", {
                                        initial: asText(relation.initial) || "—",
                                        change: asText(relation.change) || "—",
                                        final: asText(relation.final) || "—",
                                    })}</span>
                                </li>
                            ))}
                            {oldRelationships.length === 0 && <li className="text-xs text-text-muted">{t("noLegacyRelationships")}</li>}
                        </ul>
                    </div>
                </div>
                {oldKeyEvents.length > 0 && (
                    <details className="mt-3 rounded-md border border-border bg-surface p-3">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">{t("legacyEvents", { count: oldKeyEvents.length })}</summary>
                        <ul className="mt-2 space-y-2">
                            {oldKeyEvents.map((event, index) => <li key={`legacy-event-${index}`} className="text-xs text-text-secondary"><strong className="text-foreground">{asText(event.event ?? event.scene) || t("unnamedEvent")}</strong> — {asText(event.function)}</li>)}
                        </ul>
                    </details>
                )}
            </section>
        );
    }

    const renderEventEditor = (phase: DirectorStoryPhase, event: DirectorStoryEvent, eventIndex: number) => {
        const isOpen = expandedEventId === event.event_id;
        const possibleVariants = people.flatMap(person => person.variant_character_ids.map(id => ({
            id,
            person,
            label: characterById.get(id)?.name || characterById.get(id)?.persona || person.display_name,
        })));
        const unknownSelectedIds = event.character_ids.filter(id => !possibleVariants.some(item => item.id === id));
        const selectedFacts = event.source_fact_ids;
        return (
            <article key={event.event_id} className="rounded-md border border-border bg-background/60 p-3">
                <div className="flex items-start justify-between gap-2">
                    <button type="button" aria-expanded={isOpen} onClick={() => setExpandedEventId(isOpen ? null : event.event_id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                        <span className="block truncate text-xs font-semibold text-foreground">{event.title || event.description || t("unnamedEvent")}</span>
                        <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-[11px] leading-4 text-text-secondary">{event.description || t("eventNeedsDescription")}</span>
                    </button>
                    <IconActions
                        label={t("eventNumber", { number: eventIndex + 1 })}
                        canMoveUp={eventIndex > 0}
                        canMoveDown={eventIndex < phase.events.length - 1}
                        onMoveUp={() => moveEvent(phase.phase_id, event.event_id, -1)}
                        onMoveDown={() => moveEvent(phase.phase_id, event.event_id, 1)}
                        onDelete={() => removeEvent(phase.phase_id, event.event_id)}
                    />
                </div>
                {isOpen && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <Field label={t("eventTitle")} value={event.title} onChange={value => updateEvent(phase.phase_id, event.event_id, { title: value })} />
                        <Field label={t("eventDescription")} value={event.description} multiline onChange={value => updateEvent(phase.phase_id, event.event_id, { description: value })} />
                        <Field label={t("dramaticFunction")} value={event.dramatic_function} multiline onChange={value => updateEvent(phase.phase_id, event.event_id, { dramatic_function: value })} />
                        <fieldset className="space-y-2">
                            <legend className="text-xs font-medium text-text-secondary">{t("eventPeople")}</legend>
                            {people.length === 0 && <p className="text-xs text-text-muted">{t("noPeople")}</p>}
                            <div className="flex flex-wrap gap-2">
                                {possibleVariants.map(item => (
                                    <label key={item.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary">
                                        <input type="checkbox" checked={event.character_ids.includes(item.id)} onChange={change => updateEvent(phase.phase_id, event.event_id, {
                                            character_ids: change.target.checked
                                                ? Array.from(new Set([...event.character_ids, item.id]))
                                                : event.character_ids.filter(id => id !== item.id),
                                        })} className="accent-primary" />
                                        {item.label}
                                    </label>
                                ))}
                                {unknownSelectedIds.map(id => <span key={id} className="rounded bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">{t("unknownCharacter", { id })}</span>)}
                            </div>
                        </fieldset>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <EvidenceStatusField value={event.evidence_status} onChange={value => updateEvent(phase.phase_id, event.event_id, { evidence_status: value })} />
                            <FactPicker
                                label={t("eventEvidence")}
                                selectedIds={selectedFacts}
                                facts={facts}
                                factLedgerRevision={factLedgerRevision}
                                mapLedgerRevision={map.fact_ledger_revision}
                                loading={factsLoading}
                                onChange={ids => setFactRefs(ids, (nextIds, current) => ({
                                    ...current,
                                    phases: current.phases.map(item => item.phase_id === phase.phase_id ? {
                                        ...item,
                                        events: item.events.map(candidate => candidate.event_id === event.event_id ? { ...candidate, source_fact_ids: nextIds } : candidate),
                                    } : item),
                                }))}
                            />
                        </div>
                    </div>
                )}
            </article>
        );
    };

    return (
        <div className="space-y-6">
            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-map-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-story-map-title" className="text-sm font-semibold text-foreground">{t("title")}</h3>
                        <p className="mt-1 max-w-3xl text-xs leading-5 text-text-secondary">{t("mapHint")}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="rounded bg-primary/10 px-2 py-1 text-primary">{t("sourceRevision", { revision: map.source_revision })}</span>
                            {map.fact_ledger_revision !== null && <span className="rounded bg-background px-2 py-1 text-text-secondary">{t("pinnedLedger", { revision: map.fact_ledger_revision })}</span>}
                            {staleSource && <span role="alert" className="rounded bg-amber-400/10 px-2 py-1 text-amber-200">{t("staleSource", { mapRevision: map.source_revision, currentRevision: sourceRevision })}</span>}
                        </div>
                    </div>
                    <button type="button" onClick={onReloadFacts} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
                        <RefreshCw size={14} aria-hidden="true" />{t("reloadEvidence")}
                    </button>
                </div>
                {factsError && <p role="alert" className="mt-3 text-xs text-amber-200">{factsError}</p>}

                <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-semibold text-foreground">{t("timelineTitle")}</h4>
                        <p className="mt-1 text-xs text-text-secondary">{t("timelineHint")}</p>
                    </div>
                    <button type="button" onClick={addPhase} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Plus size={14} aria-hidden="true" />{t("addPhase")}</button>
                </div>

                <div className="mt-3 overflow-x-auto pb-2">
                    <div className="flex min-w-max items-stretch gap-3">
                        {phases.map((phase, phaseIndex) => (
                            <article key={phase.phase_id} className="w-[min(84vw,360px)] rounded-lg border border-border bg-surface p-3 sm:w-[340px]">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">{t("phaseIndex", { number: phaseIndex + 1 })}</span>
                                    <IconActions
                                        label={t("phaseNumber", { number: phaseIndex + 1 })}
                                        canMoveUp={phaseIndex > 0}
                                        canMoveDown={phaseIndex < phases.length - 1}
                                        onMoveUp={() => movePhase(phase.phase_id, -1)}
                                        onMoveDown={() => movePhase(phase.phase_id, 1)}
                                        onDelete={() => removePhase(phase.phase_id)}
                                    />
                                </div>
                                <div className="mt-2 space-y-3">
                                    <Field label={t("phaseName")} value={phase.label} placeholder={t("phaseNamePlaceholder")} onChange={value => updatePhase(phase.phase_id, { label: value })} />
                                    <Field label={t("timeAnchor")} value={phase.time_anchor} placeholder={t("timeAnchorPlaceholder")} onChange={value => updatePhase(phase.phase_id, { time_anchor: value })} />
                                </div>
                                <div className="mt-4 space-y-2 border-l border-primary/30 pl-3">
                                    {phase.events.slice().sort((a, b) => a.order - b.order).map((event, eventIndex) => renderEventEditor(phase, event, eventIndex))}
                                    {phase.events.length === 0 && <p className="text-xs text-text-muted">{t("noEvents")}</p>}
                                </div>
                                <button type="button" onClick={() => addEvent(phase.phase_id)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-text-secondary hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Plus size={14} aria-hidden="true" />{t("addEvent")}</button>
                            </article>
                        ))}
                        {phases.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">{t("noPhases")}</p>}
                    </div>
                </div>
            </section>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-relationship-graph-title">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-relationship-graph-title" className="text-sm font-semibold text-foreground">{t("relationshipsTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">{t("relationshipsHint")}</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="space-y-1.5">
                            <span className="block text-[10px] text-text-secondary">{t("relationshipPersonA")}</span>
                            <select aria-label={t("relationshipPersonA")} value={relationshipPeople[0]} onChange={event => setRelationshipPeople([event.target.value, relationshipPeople[1]])} className="max-w-44 rounded-md border border-border bg-background px-2 py-2 text-xs text-foreground">
                                <option value="">{t("choosePerson")}</option>
                                {people.map(person => <option key={person.person_id} value={person.person_id}>{person.display_name}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1.5">
                            <span className="block text-[10px] text-text-secondary">{t("relationshipPersonB")}</span>
                            <select aria-label={t("relationshipPersonB")} value={relationshipPeople[1]} onChange={event => setRelationshipPeople([relationshipPeople[0], event.target.value])} className="max-w-44 rounded-md border border-border bg-background px-2 py-2 text-xs text-foreground">
                                <option value="">{t("choosePerson")}</option>
                                {people.map(person => <option key={person.person_id} value={person.person_id}>{person.display_name}</option>)}
                            </select>
                        </label>
                        <button type="button" disabled={people.length < 2 || !relationshipPeople[0] || !relationshipPeople[1] || relationshipPeople[0] === relationshipPeople[1]} onClick={addRelationship} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={14} aria-hidden="true" />{t("addRelationship")}</button>
                    </div>
                </div>

                {people.length >= 2 && (
                    <RelationshipGraph
                        people={people}
                        arcs={map.relationship_arcs}
                        selectedId={selectedRelationshipId || map.relationship_arcs[0]?.relationship_id || ""}
                        onSelect={relationshipId => {
                            setSelectedRelationshipId(relationshipId);
                            const card = document.getElementById(`relationship-${relationshipId}`);
                            if (card && typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        }}
                        t={(key, values) => t(key, values)}
                    />
                )}
                {people.length < 2 && <p className="rounded-md border border-dashed border-border p-4 text-xs text-text-muted">{t("needPeople")}</p>}

                <div className="mt-4 space-y-3">
                    {map.relationship_arcs.map((arc, index) => (
                        <article id={`relationship-${arc.relationship_id}`} key={arc.relationship_id} className="scroll-mt-4 rounded-lg border border-border bg-surface p-3 sm:p-4">
                            <div className="mb-3 flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-foreground">{relationshipLabel(arc, people)}</p>
                                    <Field label={t("relationshipLabel")} value={arc.label} placeholder={t("relationshipLabelPlaceholder")} onChange={value => updateArc(arc.relationship_id, { label: value })} />
                                    {arc.legacy_summary && <p className="mt-2 text-xs text-text-secondary">{arc.legacy_summary}</p>}
                                </div>
                                <IconActions label={t("relationshipNumber", { number: index + 1 })} onDelete={() => removeArc(arc)} />
                            </div>
                            {phases.length === 0 ? <p className="text-xs text-text-muted">{t("needPhasesForStates")}</p> : (
                                <div className="grid gap-3 lg:grid-cols-2">
                                    {phases.map(phase => {
                                        const state = arc.states.find(item => item.phase_id === phase.phase_id);
                                        const value = state?.state ?? "";
                                        const phaseEvents = phase.events.slice().sort((a, b) => a.order - b.order);
                                        return (
                                            <section key={phase.phase_id} className="space-y-3 rounded-md border border-border bg-background/50 p-3" aria-label={t("relationshipStateInPhase", { relationship: relationshipLabel(arc, people), phase: phase.label || t("unnamedPhase") })}>
                                                <h4 className="text-xs font-semibold text-foreground">{phase.label || t("unnamedPhase")}</h4>
                                                <Field label={t("relationshipState")} value={value} placeholder={t("relationshipStatePlaceholder")} onChange={nextValue => {
                                                    if (!nextValue.trim()) {
                                                        updateArc(arc.relationship_id, { states: arc.states.filter(item => item.phase_id !== phase.phase_id) });
                                                    } else {
                                                        updateRelationshipState(arc, phase, { state: nextValue });
                                                    }
                                                }} />
                                                {state && <>
                                                    <EvidenceStatusField value={state.evidence_status} onChange={next => updateRelationshipState(arc, phase, { evidence_status: next })} />
                                                    {phaseEvents.length > 0 && (
                                                        <fieldset className="space-y-2">
                                                            <legend className="text-xs font-medium text-text-secondary">{t("triggerEvents")}</legend>
                                                            <div className="space-y-1.5">
                                                                {phaseEvents.map(event => (
                                                                    <label key={event.event_id} className="flex cursor-pointer items-start gap-2 text-xs text-text-secondary">
                                                                        <input type="checkbox" checked={state.trigger_event_ids.includes(event.event_id)} onChange={change => updateRelationshipState(arc, phase, {
                                                                            trigger_event_ids: change.target.checked
                                                                                ? Array.from(new Set([...state.trigger_event_ids, event.event_id]))
                                                                                : state.trigger_event_ids.filter(id => id !== event.event_id),
                                                                        })} className="mt-0.5 accent-primary" />
                                                                        <span>{event.title || event.description || t("unnamedEvent")}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </fieldset>
                                                    )}
                                                    <FactPicker
                                                        label={t("relationshipEvidence")}
                                                        selectedIds={state.source_fact_ids}
                                                        facts={facts}
                                                        factLedgerRevision={factLedgerRevision}
                                                        mapLedgerRevision={map.fact_ledger_revision}
                                                        loading={factsLoading}
                                                        onChange={ids => setFactRefs(ids, (nextIds, current) => ({
                                                            ...current,
                                                            relationship_arcs: current.relationship_arcs.map(candidate => candidate.relationship_id === arc.relationship_id ? {
                                                                ...candidate,
                                                                states: candidate.states.map(candidateState => candidateState.phase_id === phase.phase_id ? { ...candidateState, source_fact_ids: nextIds } : candidateState),
                                                            } : candidate),
                                                        }))}
                                                    />
                                                </>}
                                            </section>
                                        );
                                    })}
                                </div>
                            )}
                        </article>
                    ))}
                    {map.relationship_arcs.length === 0 && <p className="text-xs text-text-muted">{t("noRelationships")}</p>}
                </div>
            </section>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-storyline-title">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-storyline-title" className="text-sm font-semibold text-foreground">{t("storylinesTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">{t("storylinesHint")}</p>
                    </div>
                    <button type="button" onClick={addThread} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Plus size={14} aria-hidden="true" />{t("addStoryline")}</button>
                </div>
                <div className="space-y-4">
                    {map.story_threads.map((thread, index) => (
                        <article key={thread.thread_id} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
                            <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1 space-y-3">
                                    <Field label={t("storylineLabel")} value={thread.label} placeholder={t("storylineLabelPlaceholder")} onChange={value => updateThread(thread, { label: value })} />
                                    <fieldset>
                                        <legend className="mb-2 text-xs font-medium text-text-secondary">{t("storylinePeople")}</legend>
                                        <div className="flex flex-wrap gap-2">
                                            {people.map(person => <label key={person.person_id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary"><input type="checkbox" checked={thread.person_ids.includes(person.person_id)} onChange={change => updateThread(thread, {
                                                person_ids: change.target.checked ? Array.from(new Set([...thread.person_ids, person.person_id])) : thread.person_ids.filter(id => id !== person.person_id),
                                            })} className="accent-primary" />{person.display_name}</label>)}
                                            {people.length === 0 && <p className="text-xs text-text-muted">{t("noPeople")}</p>}
                                        </div>
                                    </fieldset>
                                </div>
                                <IconActions label={t("storylineNumber", { number: index + 1 })} onDelete={() => removeThread(thread)} />
                            </div>
                            <div className="mt-4 overflow-x-auto">
                                <div className="grid min-w-max gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(phases.length, 1)}, minmax(220px, 1fr))` }}>
                                    {phases.map(phase => {
                                        const milestones = thread.milestones.filter(milestone => phase.events.some(event => event.event_id === milestone.event_id));
                                        const availableEvents = phase.events.filter(event => !thread.milestones.some(milestone => milestone.event_id === event.event_id));
                                        return (
                                            <section key={phase.phase_id} className="min-h-24 space-y-2 rounded-md border border-border bg-background/50 p-2.5" aria-label={t("storylineLane", { storyline: thread.label || t("unnamedStoryline"), phase: phase.label || t("unnamedPhase") })}>
                                                <h4 className="text-[10px] font-semibold text-text-secondary">{phase.label || t("unnamedPhase")}</h4>
                                                {milestones.map(milestone => {
                                                    const event = allEvents.find(item => item.event_id === milestone.event_id);
                                                    if (!event) return null;
                                                    return (
                                                        <div key={milestone.event_id} className="space-y-2 rounded border border-primary/20 bg-primary/5 p-2">
                                                            <p className="text-xs font-medium text-foreground">{event.title || event.description || t("unnamedEvent")}</p>
                                                            <SelectField label={t("milestoneRole")} value={milestone.role} options={milestoneRoles} optionLabel={role => t(`milestone.${role}`)} onChange={role => updateThread(thread, {
                                                                milestones: thread.milestones.map(item => item.event_id === milestone.event_id ? { ...item, role } : item),
                                                            })} />
                                                            <Field label={t("milestoneNote")} value={milestone.note} onChange={note => updateThread(thread, {
                                                                milestones: thread.milestones.map(item => item.event_id === milestone.event_id ? { ...item, note } : item),
                                                            })} />
                                                            <button type="button" onClick={() => updateThread(thread, { milestones: thread.milestones.filter(item => item.event_id !== milestone.event_id) })} className="text-[10px] text-text-muted underline hover:text-foreground">{t("removeMilestone")}</button>
                                                        </div>
                                                    );
                                                })}
                                                {availableEvents.length > 0 && (
                                                    <label className="block space-y-1">
                                                        <span className="text-[10px] text-text-muted">{t("addMilestone")}</span>
                                                        <select value="" aria-label={t("addMilestoneInPhase", { phase: phase.label || t("unnamedPhase") })} onChange={change => {
                                                            if (!change.target.value) return;
                                                            updateThread(thread, { milestones: [...thread.milestones, { event_id: change.target.value, role: "progress", note: "" }] });
                                                        }} className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                                                            <option value="">{t("chooseEvent")}</option>
                                                            {availableEvents.map(event => <option key={event.event_id} value={event.event_id}>{event.title || event.description || t("unnamedEvent")}</option>)}
                                                        </select>
                                                    </label>
                                                )}
                                                {phase.events.length === 0 && <p className="text-[10px] text-text-muted">{t("noEvents")}</p>}
                                            </section>
                                        );
                                    })}
                                    {phases.length === 0 && <p className="rounded border border-dashed border-border p-3 text-xs text-text-muted">{t("needPhasesForStorylines")}</p>}
                                </div>
                            </div>
                        </article>
                    ))}
                    {map.story_threads.length === 0 && <p className="text-xs text-text-muted">{t("noStorylines")}</p>}
                </div>
            </section>

            {(oldTimeline.length > 0 || oldRelationships.length > 0 || oldKeyEvents.length > 0) && (
                <details className="rounded-lg border border-border bg-background/30 p-4">
                    <summary className="cursor-pointer text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">{t("legacyDataTitle")}</summary>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{t("legacyDataHint")}</p>
                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        {oldTimeline.length > 0 && <LegacyList title={tLegacy("timelineTitle")} items={oldTimeline.map(item => `${asText(item.phase)}：${asText(item.events)}`)} />}
                        {oldRelationships.length > 0 && <LegacyList title={tLegacy("relationshipsTitle")} items={oldRelationships.map(item => `${asText(item.pair ?? item.people)}：${asText(item.initial)} → ${asText(item.change)} → ${asText(item.final)}`)} />}
                        {oldKeyEvents.length > 0 && <LegacyList title={tLegacy("keyEventsTitle")} items={oldKeyEvents.map(item => `${asText(item.event ?? item.scene)}：${asText(item.function)}`)} />}
                    </div>
                </details>
            )}
        </div>
    );
}

function relationshipLabel(arc: DirectorRelationshipArc, people: DirectorStoryPerson[]): string {
    const names = arc.person_ids.map(id => people.find(person => person.person_id === id)?.display_name ?? id);
    return names.join(" ↔ ");
}

function RelationshipGraph({
    people,
    arcs,
    selectedId,
    onSelect,
    t,
}: {
    people: DirectorStoryPerson[];
    arcs: DirectorRelationshipArc[];
    selectedId: string;
    onSelect: (relationshipId: string) => void;
    t: (key: string, values?: Record<string, string | number>) => string;
}) {
    const visiblePeople = people.slice(0, 14);
    const positions = visiblePeople.map((person, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / visiblePeople.length;
        return {
            person,
            x: visiblePeople.length === 1 ? 320 : 320 + Math.cos(angle) * 230,
            y: visiblePeople.length === 1 ? 170 : 170 + Math.sin(angle) * 112,
        };
    });
    const point = new Map(positions.map(item => [item.person.person_id, item]));
    return (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface p-2 sm:p-4">
            {people.length > visiblePeople.length && <p className="mb-2 text-[10px] text-text-muted">{t("graphLimit", { shown: visiblePeople.length, total: people.length })}</p>}
            <svg viewBox="0 0 640 340" className="mx-auto h-auto max-h-[360px] min-w-[560px] w-full" role="group" aria-label={t("relationshipGraphDescription", { people: people.length, relationships: arcs.length })}>
                {arcs.map((arc, index) => {
                    const from = point.get(arc.person_ids[0]);
                    const to = point.get(arc.person_ids[1]);
                    if (!from || !to) return null;
                    const active = arc.relationship_id === selectedId;
                    const midX = (from.x + to.x) / 2;
                    const midY = (from.y + to.y) / 2 + (index % 2 === 0 ? -7 : 7);
                    const label = relationshipLabel(arc, people);
                    return (
                        <g key={arc.relationship_id} role="button" tabIndex={0} aria-label={t("selectRelationship", { relationship: label })} onClick={() => onSelect(arc.relationship_id)} onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(arc.relationship_id); }
                        }} className="cursor-pointer focus:outline-none">
                            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="18" />
                            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={active ? "#818cf8" : "#64748b"} strokeOpacity={active ? "0.9" : "0.62"} strokeWidth={active ? "3" : "2"} />
                            {arc.label && <text x={midX} y={midY} textAnchor="middle" className="fill-text-secondary text-[9px]">{arc.label.slice(0, 22)}</text>}
                        </g>
                    );
                })}
                {positions.map(({ person, x, y }) => (
                    <g key={person.person_id}>
                        <rect x={x - 62} y={y - 20} width="124" height="40" rx="10" className="fill-elevated stroke-border" strokeWidth="1.5" />
                        <text x={x} y={y + 4} textAnchor="middle" className="fill-foreground text-[11px]">{person.display_name.slice(0, 16)}</text>
                    </g>
                ))}
            </svg>
            <p className="mt-2 text-[10px] text-text-muted">{t("graphKeyboardHint")}</p>
        </div>
    );
}

function LegacyList({ title, items }: { title: string; items: string[] }) {
    return (
        <div className="rounded-md border border-border bg-surface p-3">
            <h4 className="text-xs font-semibold text-foreground">{title}</h4>
            <ul className="mt-2 space-y-1.5">
                {items.map((item, index) => <li key={index} className="whitespace-pre-wrap text-xs text-text-secondary">{item}</li>)}
            </ul>
        </div>
    );
}

export default function DirectorStoryMapSection(props: {
    profile: Draft;
    onChange: (profile: Draft) => void;
    sourceRevision: number;
    characters: Character[];
    facts: ScriptFactLedgerQueryEntry[];
    factLedgerRevision: number | null;
    factsLoading: boolean;
    factsError: string;
    onReloadFacts: () => void;
}) {
    return <StoryMapSection {...props} />;
}
