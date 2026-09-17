"use client";

import { useTranslations } from "next-intl";
import clsx from "clsx";
import { GLOBAL_NAV_ITEMS, type GlobalTab } from "./GlobalSidebar";

/**
 * Mobile global navigation — a bottom tab bar shown only below md.
 * At md+ the GlobalSidebar (hidden md:flex) takes over. Mirrors the sidebar's
 * nav model + hash routing so the two never drift (single source: GLOBAL_NAV_ITEMS).
 */
export default function BottomTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
}) {
  const t = useTranslations("nav");
  return (
    <nav
      className="md:hidden relative z-20 flex-shrink-0 grid grid-cols-6 items-stretch border-t border-glass-border bg-surface/80 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label={t("mainNavAria")}
    >
      {GLOBAL_NAV_ITEMS.map(({ id, icon: Icon, hash }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              onTabChange(id);
              window.location.hash = hash;
            }}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "min-w-0 min-h-14 flex flex-col items-center justify-center gap-1 px-0.5 py-2 transition-colors",
              active ? "text-primary" : "text-text-muted hover:text-foreground"
            )}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="max-w-full break-words text-center text-[0.625rem] font-medium leading-tight">{t(id)}</span>
          </button>
        );
      })}
    </nav>
  );
}
