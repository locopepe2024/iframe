"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
const legacySettingLabels: Record<string, [string, string]> = {
    era: ["时代背景（旧字段）", "Historical era (legacy field)"],
    session_time: ["时间补充（旧字段）", "Time detail (legacy field)"],
    scene_time: ["场景时段（旧字段）", "Scene time (legacy field)"],
    geography: ["地域背景（旧字段）", "Geography (legacy field)"],
    primary_location: ["主要地点（旧字段）", "Primary location (legacy field)"],
    sub_location: ["具体地点（旧字段）", "Specific location (legacy field)"],
    style: ["风格补充（旧字段）", "Style detail (legacy field)"],
    status: ["状态说明（旧字段）", "Status detail (legacy field)"],
};
const longFields = ["emotional_arc", "pacing", "visual_language", "performance_direction", "dialogue_direction", "sound_direction"] as const;
const listFields = ["continuity_constraints", "prohibitions", "unresolved_questions"] as const;
const asText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value, null, 2) ?? String(value);
};

function TextField({
    label,
    hint,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            {hint && <span className="block text-[11px] leading-4 text-text-muted">{hint}</span>}
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
    const locale = useLocale();
    // Some deployed bundles were built with an older message tree and rendered
    // the namespace key itself. Keep the three primary workbench domains
    // readable while those bundles are refreshed.
    const domainText = (key: "understanding" | "intent" | "questions" | "understandingHint" | "intentHint" | "questionsHint") => {
        const value = t(`domains.${key}`);
        if (!value.startsWith("artDirection.directorEditor.")) return value;
        const fallback: Record<typeof key, [string, string]> = {
            understanding: ["导演理解", "确认原作、时间线、人物关系和原文依据"],
            intent: ["导演意图", "对修订后剧本进行视觉、表演、声音和连续性加工"],
            questions: ["导演问题 / 待确认", "回答待确认问题，或提出局部/全部修订；回答会进入下一版导演设定"],
            understandingHint: ["确认原作、时间线、人物关系和原文依据", "Confirm the original, timeline, relationships and source basis"],
            intentHint: ["对修订后剧本进行视觉、表演、声音和连续性加工", "Shape visual, performance, sound and continuity treatment"],
            questionsHint: ["回答待确认问题，或提出局部/全部修订；回答会进入下一版导演设定", "Answer open questions or request a local/full revision; answers enter the next Director revision"],
        };
        return fallback[key][locale.startsWith("zh") ? 0 : 1];
    };
    const [activeDomain, setActiveDomain] = useState<"understanding" | "intent" | "questions">("understanding");
    const setting = profile.setting && typeof profile.setting === "object" && !Array.isArray(profile.setting)
        ? profile.setting as Draft
        : {};
    const extraSettingKeys = Object.keys(setting).filter(key => !settingFields.includes(key));
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
        { id: "understanding" as const, label: domainText("understanding"), hint: domainText("understandingHint") },
        { id: "intent" as const, label: domainText("intent"), hint: domainText("intentHint") },
        { id: "questions" as const, label: domainText("questions"), hint: domainText("questionsHint") },
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

            {!mindMapOnly && activeDomain === "understanding" && <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-story-overview">
                <div className="mb-4">
                    <h3 id="director-story-overview" className="text-sm font-semibold text-foreground">{t("overviewTitle")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{t("overviewHint")}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {settingFields.map(key => (
                        <TextField
                            key={key}
                            label={t(`setting.${key}`)}
                            hint={t(`settingHint.${key}`)}
                            value={asText(setting[key])}
                            onChange={value => updateSetting(key, value)}
                        />
                    ))}
                </div>
                {extraSettingKeys.length > 0 && <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer text-xs font-medium text-text-secondary">{t("legacySettingTitle", { count: extraSettingKeys.length })}</summary>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{t("legacySettingHint")}</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                        {extraSettingKeys.map(key => <TextField
                            key={key}
                            label={legacySettingLabels[key]?.[locale.startsWith("zh") ? 0 : 1] ?? key}
                            value={asText(setting[key])}
                            onChange={value => updateSetting(key, value)}
                        />)}
                    </div>
                </details>}
            </section>}

            {(mindMapOnly || activeDomain === "understanding") && <DirectorStoryMapSection
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

            {!mindMapOnly && activeDomain === "intent" && <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-intent">
                <div className="mb-4">
                    <h3 id="director-intent" className="text-sm font-semibold text-foreground">{domainText("intent")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{domainText("intentHint")}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {longFields.map(field => <TextField key={field} label={t(`field.${field}`)} value={asText(profile[field])} onChange={value => updateProfile(field, value)} />)}
                </div>
            </section>}

            {!mindMapOnly && (activeDomain === "intent" || activeDomain === "questions") && listFields.filter(field =>
                activeDomain === "intent" ? field === "continuity_constraints" || field === "prohibitions" : field === "unresolved_questions",
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
