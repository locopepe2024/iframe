"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Character, ScriptFactLedgerQueryEntry } from "@/store/projectStore";
import DirectorStoryMapSection from "./DirectorStoryMapSection";

type Draft = Record<string, unknown>;

const settingFields = [
    "format_genre",
    "locations",
    "time_period",
    "social_context",
    "dramatic_contrast",
    "spatial_motif",
];
const longFields = ["emotional_arc", "pacing", "visual_language", "performance_direction", "dialogue_direction", "sound_direction"] as const;
const listFields = ["continuity_constraints", "prohibitions", "unresolved_questions"] as const;
const asText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value, null, 2) ?? String(value);
};

function TextField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <textarea
                aria-label={label}
                value={value}
                onChange={event => onChange(event.target.value)}
                className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            />
        </label>
    );
}

export default function DirectorInterpretationVisualEditor({
    profile,
    onChange,
    sourceRevision = 1,
    characters = [],
    facts = [],
    factLedgerRevision = null,
    factsLoading = false,
    factsError = "",
    onReloadFacts = () => undefined,
    mindMapOnly = false,
}: {
    profile: Draft;
    onChange: (profile: Draft) => void;
    sourceRevision?: number;
    characters?: Character[];
    facts?: ScriptFactLedgerQueryEntry[];
    factLedgerRevision?: number | null;
    factsLoading?: boolean;
    factsError?: string;
    onReloadFacts?: () => void;
    mindMapOnly?: boolean;
}) {
    const t = useTranslations("artDirection.directorEditor");
    const [activeDomain, setActiveDomain] = useState<"overview" | "structure" | "continuity" | "consistency" | "questions">("overview");
    const setting = profile.setting && typeof profile.setting === "object" && !Array.isArray(profile.setting)
        ? profile.setting as Draft
        : {};
    const settingKeys = [...settingFields, ...Object.keys(setting).filter(key => !settingFields.includes(key))];
    const updateProfile = (key: string, value: unknown) => onChange({ ...profile, [key]: value });
    const updateSetting = (key: string, value: string) => updateProfile("setting", { ...setting, [key]: value });
    const updateListAt = (key: string, index: number, value: string) => {
        const next = Array.isArray(profile[key]) ? (profile[key] as unknown[]).slice() : [];
        next[index] = value;
        updateProfile(key, next);
    };
    const addListItem = (key: string) => updateProfile(key, [...(Array.isArray(profile[key]) ? profile[key] as unknown[] : []), ""]);
    const removeListItem = (key: string, index: number) => updateProfile(
        key,
        (Array.isArray(profile[key]) ? profile[key] as unknown[] : []).filter((_item, current) => current !== index),
    );

    const domains = [
        { id: "overview" as const, label: t("domains.overview"), hint: t("domains.overviewHint") },
        { id: "structure" as const, label: t("domains.structure"), hint: t("domains.structureHint") },
        { id: "continuity" as const, label: t("domains.continuity"), hint: t("domains.continuityHint") },
        { id: "consistency" as const, label: t("domains.consistency"), hint: t("domains.consistencyHint") },
        { id: "questions" as const, label: t("domains.questions"), hint: t("domains.questionsHint") },
    ];

    return (
        <div className="space-y-4">
            {!mindMapOnly && (
                <nav aria-label={t("domains.navigation")} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {domains.map(domain => (
                        <button
                            key={domain.id}
                            type="button"
                            aria-current={activeDomain === domain.id ? "page" : undefined}
                            onClick={() => setActiveDomain(domain.id)}
                            className={`min-h-16 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${activeDomain === domain.id ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/60"}`}
                        >
                            <span className="block text-xs font-semibold text-foreground">{domain.label}</span>
                            <span className="mt-1 block text-[11px] leading-4 text-text-muted">{domain.hint}</span>
                        </button>
                    ))}
                </nav>
            )}

            {!mindMapOnly && activeDomain === "overview" && <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-overview">
                <div className="mb-4">
                    <h3 id="director-story-overview" className="text-sm font-semibold text-foreground">{t("overviewTitle")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{t("overviewHint")}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {settingKeys.map(key => (
                        <TextField
                            key={key}
                            label={settingFields.includes(key) ? t(`setting.${key}`) : key}
                            value={asText(setting[key])}
                            onChange={value => updateSetting(key, value)}
                        />
                    ))}
                    {longFields.map(field => (
                        <TextField key={field} label={t(`field.${field}`)} value={asText(profile[field])} onChange={value => updateProfile(field, value)} />
                    ))}
                </div>
            </section>}

            {(mindMapOnly || activeDomain === "structure") && <DirectorStoryMapSection
                profile={profile}
                onChange={onChange}
                sourceRevision={sourceRevision}
                characters={characters}
                facts={facts}
                factLedgerRevision={factLedgerRevision}
                factsLoading={factsLoading}
                factsError={factsError}
                onReloadFacts={onReloadFacts}
                mindMapOnly={mindMapOnly}
            />}

            {!mindMapOnly && (activeDomain === "continuity" || activeDomain === "consistency" || activeDomain === "questions") && listFields.filter(field =>
                activeDomain === "continuity" ? field === "continuity_constraints" : activeDomain === "consistency" ? field === "prohibitions" : field === "unresolved_questions",
            ).map(field => {
                const items = Array.isArray(profile[field]) ? profile[field] as unknown[] : [];
                return (
                    <section key={field} className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby={`director-${field}`}>
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h3 id={`director-${field}`} className="text-sm font-semibold text-foreground">{t(`field.${field}`)}</h3>
                                <p className="mt-1 text-xs leading-5 text-text-secondary">{t(`listHint.${field}`)}</p>
                            </div>
                            <button type="button" onClick={() => addListItem(field)} className="min-h-9 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">{t("addItem")}</button>
                        </div>
                        <div className="space-y-3">
                            {items.map((value, index) => (
                                <div key={`${field}-${index}`} className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2">
                                    <div className="min-w-0 flex-1">
                                        <TextField label={t("listItem", { number: index + 1 })} value={asText(value)} onChange={next => updateListAt(field, index, next)} />
                                    </div>
                                    <button type="button" aria-label={t("delete", { item: t("listItem", { number: index + 1 }) })} onClick={() => removeListItem(field, index)} className="mt-5 rounded p-2 text-text-secondary hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70">×</button>
                                </div>
                            ))}
                            {items.length === 0 && <p className="text-sm text-text-muted">{t("noItems")}</p>}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
