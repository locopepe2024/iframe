"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

type Draft = Record<string, unknown>;
type Entry = Record<string, unknown>;

const settingFields = [
    "format_genre",
    "locations",
    "time_period",
    "social_context",
    "dramatic_contrast",
    "spatial_motif",
];
const timelineFields = ["phase", "events", "relationship_state", "source"];
const relationshipFields = ["pair", "initial", "change", "final"];
const keyEventFields = ["event", "function", "weight", "source"];

const rawRows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asEntry = (value: unknown): Entry =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Entry : {};
const fieldText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value, null, 2) ?? String(value);
};
const splitPair = (pair: string): string[] => pair
    .split(/\s*(?:—|–|−|->|→|↔|与)\s*/)
    .map(value => value.trim())
    .filter(Boolean);

function TextField({
    label,
    value,
    onChange,
    multiline = true,
}: {
    label: string;
    value: unknown;
    onChange: (value: string) => void;
    multiline?: boolean;
}) {
    const className = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70";
    return (
        <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            {multiline ? (
                <textarea
                    aria-label={label}
                    value={fieldText(value)}
                    onChange={event => onChange(event.target.value)}
                    className={`${className} min-h-20 resize-y`}
                />
            ) : (
                <input
                    aria-label={label}
                    value={fieldText(value)}
                    onChange={event => onChange(event.target.value)}
                    className={className}
                />
            )}
        </label>
    );
}

function EditActions({
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp,
    canMoveDown,
    itemLabel,
}: {
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
    itemLabel: string;
}) {
    const t = useTranslations("artDirection.directorEditor");
    return (
        <div className="flex shrink-0 items-center gap-1">
            <button
                type="button"
                aria-label={t("moveUp", { item: itemLabel })}
                disabled={!canMoveUp}
                onClick={onMoveUp}
                className="rounded p-2 text-text-secondary hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40"
            ><ArrowUp size={15} aria-hidden="true" /></button>
            <button
                type="button"
                aria-label={t("moveDown", { item: itemLabel })}
                disabled={!canMoveDown}
                onClick={onMoveDown}
                className="rounded p-2 text-text-secondary hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40"
            ><ArrowDown size={15} aria-hidden="true" /></button>
            <button
                type="button"
                aria-label={t("delete", { item: itemLabel })}
                onClick={onDelete}
                className="rounded p-2 text-text-secondary hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
            ><Trash2 size={15} aria-hidden="true" /></button>
        </div>
    );
}

export default function DirectorInterpretationVisualEditor({
    profile,
    onChange,
}: {
    profile: Draft;
    onChange: (profile: Draft) => void;
}) {
    const t = useTranslations("artDirection.directorEditor");
    const setting = profile.setting && typeof profile.setting === "object" && !Array.isArray(profile.setting)
        ? profile.setting as Draft
        : {};
    const timeline = rawRows(profile.timeline);
    const relationships = rawRows(profile.relationships);
    const keyEvents = rawRows(profile.key_events);
    const characterNames = useMemo(() => Array.from(new Set(relationships.flatMap(value => {
        const pair = fieldText(asEntry(value).pair);
        return splitPair(pair);
    }))), [relationships]);

    const updateProfile = (key: string, value: unknown) => onChange({ ...profile, [key]: value });
    const updateSetting = (key: string, value: string) => updateProfile("setting", { ...setting, [key]: value });
    const updateObjectAt = (key: string, index: number, field: string, value: string) => {
        const next = rawRows(profile[key]).slice();
        next[index] = { ...asEntry(next[index]), [field]: value };
        updateProfile(key, next);
    };
    const updateListAt = (key: string, index: number, value: string) => {
        const next = rawRows(profile[key]).slice();
        next[index] = value;
        updateProfile(key, next);
    };
    const moveItem = (key: string, index: number, direction: -1 | 1) => {
        const next = rawRows(profile[key]).slice();
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        updateProfile(key, next);
    };
    const deleteItem = (key: string, index: number) => {
        updateProfile(key, rawRows(profile[key]).filter((_item, itemIndex) => itemIndex !== index));
    };
    const addObject = (key: string, value: Entry) => updateProfile(key, [...rawRows(profile[key]), value]);
    const addString = (key: string) => updateProfile(key, [...rawRows(profile[key]), ""]);

    const settingKeyLabel = (key: string) => {
        const known = settingFields.includes(key);
        return known ? t(`setting.${key}`) : key;
    };
    const settingKeys = [...settingFields, ...Object.keys(setting).filter(key => !settingFields.includes(key))];

    const renderObjectFields = (
        key: string,
        index: number,
        fields: string[],
        fieldLabel: (field: string) => string,
    ) => {
        const entry = asEntry(rawRows(profile[key])[index]);
        const extraFields = Object.keys(entry).filter(field => !fields.includes(field));
        return (
            <>
                <div className="grid gap-3 md:grid-cols-2">
                    {[...fields, ...extraFields].map(field => (
                        <TextField
                            key={field}
                            label={fieldLabel(field)}
                            value={entry[field]}
                            onChange={value => updateObjectAt(key, index, field, value)}
                            multiline={field !== "phase" && field !== "pair" && field !== "weight"}
                        />
                    ))}
                </div>
            </>
        );
    };

    const graphNodes = useMemo(() => {
        const count = characterNames.length;
        if (!count) return [];
        return characterNames.map((name, index) => {
            if (count === 1) return { name, x: 320, y: 160 };
            if (count === 2) return { name, x: index === 0 ? 150 : 490, y: 160 };
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
            return { name, x: 320 + Math.cos(angle) * 210, y: 160 + Math.sin(angle) * 105 };
        });
    }, [characterNames]);

    const relationshipEdges = relationships.map((value, index) => {
        const pair = fieldText(asEntry(value).pair);
        const [left, right] = splitPair(pair);
        return { index, left, right };
    }).filter(edge => edge.left && edge.right);

    return (
        <div className="space-y-6">
            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-overview">
                <div className="mb-4">
                    <h3 id="director-story-overview" className="text-sm font-semibold text-foreground">{t("overviewTitle")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{t("overviewHint")}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {settingKeys.map(key => (
                        <TextField
                            key={key}
                            label={settingKeyLabel(key)}
                            value={setting[key]}
                            onChange={value => updateSetting(key, value)}
                        />
                    ))}
                    {(["emotional_arc", "pacing", "visual_language", "performance_direction", "dialogue_direction", "sound_direction"] as const).map(field => (
                        <TextField
                            key={field}
                            label={t(`field.${field}`)}
                            value={profile[field]}
                            onChange={value => updateProfile(field, value)}
                        />
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-timeline">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-story-timeline" className="text-sm font-semibold text-foreground">{t("timelineTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">{t("timelineHint")}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => addObject("timeline", { phase: "", events: "", relationship_state: "", source: "" })}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    ><Plus size={15} aria-hidden="true" />{t("addPhase")}</button>
                </div>
                <ol className="space-y-3 border-l border-primary/30 pl-4 sm:pl-6">
                    {timeline.map((item, index) => (
                        <li key={`timeline-${index}`} className="relative rounded-lg border border-border bg-surface p-3 sm:p-4">
                            <span className="absolute -left-[1.55rem] top-5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary sm:-left-[1.8rem]" aria-hidden="true" />
                            <div className="mb-3 flex items-start justify-between gap-2">
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                    {fieldText(asEntry(item).phase) || t("untitledPhase", { number: index + 1 })}
                                </span>
                                <EditActions
                                    itemLabel={t("phaseItem", { number: index + 1 })}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < timeline.length - 1}
                                    onMoveUp={() => moveItem("timeline", index, -1)}
                                    onMoveDown={() => moveItem("timeline", index, 1)}
                                    onDelete={() => deleteItem("timeline", index)}
                                />
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                {[...timelineFields, ...Object.keys(asEntry(item)).filter(field => !timelineFields.includes(field))].map(field => (
                                    <TextField
                                        key={field}
                                        label={timelineFields.includes(field) ? t(`timeline.${field}`) : field}
                                        value={asEntry(item)[field]}
                                        onChange={value => updateObjectAt("timeline", index, field, value)}
                                        multiline={field !== "phase"}
                                    />
                                ))}
                            </div>
                        </li>
                    ))}
                    {timeline.length === 0 && <li className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">{t("noTimeline")}</li>}
                </ol>
            </section>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-character-relationships">
                <div className="mb-4">
                    <h3 id="director-character-relationships" className="text-sm font-semibold text-foreground">{t("relationshipsTitle")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{t("relationshipsHint")}</p>
                </div>

                {graphNodes.length > 0 && (
                    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-surface p-2 sm:p-4">
                        <svg
                            viewBox="0 0 640 320"
                            className="h-auto max-h-80 w-full"
                            role="img"
                            aria-label={t("relationshipGraphDescription", { characters: characterNames.join("、"), count: relationshipEdges.length })}
                            focusable="false"
                        >
                            {relationshipEdges.map(edge => {
                                const from = graphNodes.find(node => node.name === edge.left);
                                const to = graphNodes.find(node => node.name === edge.right);
                                if (!from || !to) return null;
                                return <line key={`edge-${edge.index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" className="text-primary" />;
                            })}
                            {graphNodes.map(node => (
                                <g key={node.name}>
                                    <rect x={node.x - 62} y={node.y - 20} width="124" height="40" rx="12" className="fill-elevated stroke-border" strokeWidth="1.5" />
                                    <text x={node.x} y={node.y + 5} textAnchor="middle" className="fill-foreground text-[12px]">{node.name}</text>
                                </g>
                            ))}
                        </svg>
                    </div>
                )}

                <div className="space-y-3">
                    {relationships.map((item, index) => (
                        <article key={`relationship-${index}`} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
                            <div className="mb-3 flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                                    <span className="truncate rounded-md border border-border bg-background px-2 py-1">{fieldText(asEntry(item).pair) || t("unnamedCharacter")}</span>
                                    <span aria-hidden="true" className="text-primary">↔</span>
                                    <span className="truncate text-text-secondary">{fieldText(asEntry(item).initial) || t("relationshipInitial")}</span>
                                </div>
                                <EditActions
                                    itemLabel={t("relationshipItem", { number: index + 1 })}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < relationships.length - 1}
                                    onMoveUp={() => moveItem("relationships", index, -1)}
                                    onMoveDown={() => moveItem("relationships", index, 1)}
                                    onDelete={() => deleteItem("relationships", index)}
                                />
                            </div>
                            {renderObjectFields(
                                "relationships",
                                index,
                                relationshipFields,
                                field => relationshipFields.includes(field) ? t(`relationship.${field}`) : field,
                            )}
                        </article>
                    ))}
                    <button
                        type="button"
                        onClick={() => addObject("relationships", { pair: "", initial: "", change: "", final: "" })}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    ><Plus size={15} aria-hidden="true" />{t("addRelationship")}</button>
                    {relationships.length === 0 && <p className="text-sm text-text-muted">{t("noRelationships")}</p>}
                </div>
            </section>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-key-events">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="director-key-events" className="text-sm font-semibold text-foreground">{t("keyEventsTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">{t("keyEventsHint")}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => addObject("key_events", { event: "", function: "", weight: "", source: "" })}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    ><Plus size={15} aria-hidden="true" />{t("addKeyEvent")}</button>
                </div>
                <div className="space-y-3">
                    {keyEvents.map((item, index) => (
                        <article key={`key-event-${index}`} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
                            <div className="mb-3 flex justify-end">
                                <EditActions
                                    itemLabel={t("keyEventItem", { number: index + 1 })}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < keyEvents.length - 1}
                                    onMoveUp={() => moveItem("key_events", index, -1)}
                                    onMoveDown={() => moveItem("key_events", index, 1)}
                                    onDelete={() => deleteItem("key_events", index)}
                                />
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                {[...keyEventFields, ...Object.keys(asEntry(item)).filter(field => !keyEventFields.includes(field))].map(field => (
                                    <TextField
                                        key={field}
                                        label={keyEventFields.includes(field) ? t(`keyEvent.${field}`) : field}
                                        value={asEntry(item)[field]}
                                        onChange={value => updateObjectAt("key_events", index, field, value)}
                                        multiline={field !== "weight"}
                                    />
                                ))}
                            </div>
                        </article>
                    ))}
                    {keyEvents.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">{t("noKeyEvents")}</p>}
                </div>
            </section>

            {(["continuity_constraints", "prohibitions", "unresolved_questions"] as const).map(field => (
                <section key={field} className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby={`director-${field}`}>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 id={`director-${field}`} className="text-sm font-semibold text-foreground">{t(`field.${field}`)}</h3>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">{t(`listHint.${field}`)}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => addString(field)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                        ><Plus size={15} aria-hidden="true" />{t("addItem")}</button>
                    </div>
                    <div className="space-y-3">
                        {rawRows(profile[field]).map((value, index) => (
                            <div key={`${field}-${index}`} className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2">
                                <div className="min-w-0 flex-1">
                                    <TextField
                                        label={t("listItem", { number: index + 1 })}
                                        value={value}
                                        onChange={next => updateListAt(field, index, next)}
                                    />
                                </div>
                                <EditActions
                                    itemLabel={t("listItem", { number: index + 1 })}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < rawRows(profile[field]).length - 1}
                                    onMoveUp={() => moveItem(field, index, -1)}
                                    onMoveDown={() => moveItem(field, index, 1)}
                                    onDelete={() => deleteItem(field, index)}
                                />
                            </div>
                        ))}
                        {rawRows(profile[field]).length === 0 && <p className="text-sm text-text-muted">{t("noItems")}</p>}
                    </div>
                </section>
            ))}
        </div>
    );
}
