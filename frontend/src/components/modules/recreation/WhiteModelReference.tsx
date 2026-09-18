"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import WhiteModelViewer from "@/components/shared/WhiteModelViewer";

export default function WhiteModelReference() {
  const t = useTranslations("recreation");
  const [open, setOpen] = useState(false);
  return <details className="border-t border-border py-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">{t("whiteModel")}</summary>
    {open && <div className="mt-4 space-y-3">
      <p className="max-w-3xl text-sm text-text-secondary">{t("whiteModelDescription")}</p>
      <WhiteModelViewer labels={{
        reset: t("whiteModelReset"),
        wireframe: t("whiteModelWireframe"),
        solid: t("whiteModelSolid"),
        loading: t("whiteModelLoading"),
        unavailable: t("whiteModelUnavailable"),
        failed: t("whiteModelFailed"),
      }} />
      <p className="text-xs text-text-muted">
        {t("whiteModelSource")} {" "}
        <a className="underline underline-offset-2" href="https://github.com/makehumancommunity/makehuman" target="_blank" rel="noreferrer">
          MakeHuman · CC0
        </a>
      </p>
    </div>}
  </details>;
}
