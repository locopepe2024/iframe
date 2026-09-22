"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";
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
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryIds: GlobalTab[] = ["workspace", "playground", "recreation", "director3d"];
  const primaryItems = GLOBAL_NAV_ITEMS.filter((item) => primaryIds.includes(item.id));
  const moreItems = GLOBAL_NAV_ITEMS.filter((item) => !primaryIds.includes(item.id));
  const moreActive = moreItems.some((item) => item.id === activeTab);
  const navigate = (id: GlobalTab, hash: string) => {
    setMoreOpen(false);
    onTabChange(id);
    window.location.hash = hash;
  };
  return (
    <nav
      className="md:hidden relative z-20 flex-shrink-0 grid grid-cols-5 items-stretch border-t border-glass-border bg-surface/80 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label={t("mainNavAria")}
    >
      {primaryItems.map(({ id, icon: Icon, hash }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              navigate(id, hash);
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
      <button
        type="button"
        onClick={() => setMoreOpen((open) => !open)}
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        className={clsx(
          "min-w-0 min-h-14 flex flex-col items-center justify-center gap-1 px-0.5 py-2 transition-colors",
          moreActive || moreOpen ? "text-primary" : "text-text-muted hover:text-foreground",
        )}
      >
        <MoreHorizontal size={20} strokeWidth={1.8} />
        <span className="text-[0.625rem] font-medium">{t("more")}</span>
      </button>
      {moreOpen && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] right-2 w-52 overflow-hidden rounded-lg border border-glass-border bg-elevated p-1.5 shadow-xl">
          {moreItems.map(({ id, icon: Icon, hash }) => (
            <button key={id} role="menuitem" type="button" onClick={() => navigate(id, hash)} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-foreground hover:bg-hover-bg">
              <Icon size={18} className={activeTab === id ? "text-primary" : "text-text-muted"} />
              <span>{t(id)}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
