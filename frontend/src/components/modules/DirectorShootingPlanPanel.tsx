"use client";

import { AlertCircle, Clapperboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";

const display = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value, null, 2) ?? String(value);
};

export default function DirectorShootingPlanPanel() {
    const t = useTranslations("artDirection.directorPlan");
    const profile = useProjectStore(state => state.currentProject?.art_direction?.director_profile);
    const examples = Array.isArray(profile?.sample_plan)
        ? profile.sample_plan.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[]
        : [];

    return (
        <section className="space-y-5" aria-labelledby="director-shooting-plan-title">
            <header>
                <div className="flex items-center gap-2">
                    <Clapperboard size={18} className="text-primary" aria-hidden="true" />
                    <h2 id="director-shooting-plan-title" className="text-lg font-semibold text-foreground">{t("title")}</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">{t("hint")}</p>
            </header>

            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4" role="status">
                <div className="flex items-start gap-3">
                    <AlertCircle size={17} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                    <div>
                        <h3 className="text-sm font-semibold text-amber-100">{t("notGeneratedTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">{t("notGeneratedHint")}</p>
                    </div>
                </div>
            </div>

            <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-plan-reference-title">
                <div className="mb-3">
                    <h3 id="director-plan-reference-title" className="text-sm font-semibold text-foreground">{t("referenceTitle")}</h3>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{t("referenceHint")}</p>
                </div>
                <div className="space-y-3">
                    {examples.map((example, index) => (
                        <article key={`sample-plan-${index}`} className="rounded-md border border-border bg-surface p-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-sm font-medium text-foreground">
                                    {display(example.range) || t("exampleNumber", { number: index + 1 })}
                                </h4>
                                <span className="rounded-full border border-border px-2 py-1 text-[0.6875rem] text-text-secondary">
                                    {t("referenceBadge")}
                                </span>
                            </div>
                            <dl className="grid gap-3 sm:grid-cols-2">
                                {(["purpose", "focus", "asset_need"] as const).map(field => example[field] !== undefined && (
                                    <div key={field}>
                                        <dt className="text-xs font-medium text-text-muted">{t(`fields.${field}`)}</dt>
                                        <dd className="mt-1 whitespace-pre-wrap text-sm leading-5 text-text-secondary">{display(example[field])}</dd>
                                    </div>
                                ))}
                            </dl>
                        </article>
                    ))}
                    {examples.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">{t("noExamples")}</p>}
                </div>
            </section>

            <div className="rounded-lg border border-border bg-background/40 p-4">
                <h3 className="text-sm font-semibold text-foreground">{t("targetTitle")}</h3>
                <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                    {(["scenes", "beats", "shots"] as const).map((step, index) => (
                        <li key={step} className="rounded-md border border-border bg-surface p-3">
                            <span className="text-xs font-medium text-primary">0{index + 1}</span>
                            <p className="mt-1 text-sm font-semibold text-foreground">{t(`steps.${step}`)}</p>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">{t(`stepHints.${step}`)}</p>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
