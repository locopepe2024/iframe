"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

export default function UpdateChecker() {
  const t = useTranslations("settings");
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2.5 border-t border-glass-border text-[0.78125rem]">
      <span className="text-text-secondary">{t("updateLabel")}</span>
      <div className="flex items-center gap-2.5">
        <span role="status" className="text-text-muted">{t("updateInactive")}</span>
        <button type="button" disabled aria-label={t("updateCheckAria")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-glass-border text-text-muted opacity-50 cursor-not-allowed">
          <RefreshCw size={13} />{t("updateCheck")}
        </button>
      </div>
    </div>
  );
}
