"use client";

import { useTranslations } from "next-intl";
import type { DirectorProfileProgress } from "@/lib/directorProfile";

export default function DirectorProfileGenerationProgress({ progress }: { progress: DirectorProfileProgress }) {
    const t = useTranslations("artDirection.directorStatus");
    return <span className="mt-1 block text-text-secondary">
        {progress.stage && <span className="mr-2">{t(`stages.${progress.stage}`)}</span>}
        {t("stepProgress", { completed: progress.completed, total: progress.total })}
    </span>;
}
