"use client";

import { LayoutGrid, Layers, Wand2, Settings, FileText, Film, Box, ImagePlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import IFrameBranding from "./IFrameBranding";
import { isTauri } from "@/lib/transport";
import PlaygroundSessionSubnav from "@/components/modules/playground/PlaygroundSessionSubnav";
import { APP_VERSION_LABEL } from "@/generated/appVersion";

export type GlobalTab = "workspace" | "library" | "editor" | "playground" | "imageEditor" | "recreation" | "editing" | "director3d" | "settings";

interface GlobalSidebarProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
}

// Shared global nav model (workspace/library/playground + settings). Reused by
// the desktop GlobalSidebar (below) and the mobile BottomTabBar (md:hidden).
export const GLOBAL_NAV_ITEMS: { id: GlobalTab; icon: typeof LayoutGrid; hash: string }[] = [
  { id: "workspace", icon: LayoutGrid, hash: "#/" },
  { id: "library", icon: Layers, hash: "#/library" },
  { id: "editor", icon: FileText, hash: "#/studio/editor" },
  { id: "playground", icon: Wand2, hash: "#/playground" },
  { id: "imageEditor", icon: ImagePlus, hash: "#/image-editor" },
  { id: "recreation", icon: Film, hash: "#/recreation" },
  { id: "editing", icon: Film, hash: "#/editing" },
  { id: "director3d", icon: Box, hash: "#/director" },
  { id: "settings", icon: Settings, hash: "#/settings" },
];

function NavButton({
  active,
  label,
  icon: Icon,
  onClick,
  collapsed,
}: {
  active: boolean;
  label: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
  collapsed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={clsx(
        "group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors",
        active
          ? "bg-primary/10 text-foreground font-semibold"
          : "text-text-secondary hover:bg-hover-bg hover:text-foreground font-medium"
      )}
    >
      {/* Active accent bar */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[18px] w-[3px] rounded-r bg-primary" />
      )}
      <Icon
        size={18}
        strokeWidth={1.8}
        className={clsx(
          "flex-shrink-0 transition-colors",
          active ? "text-primary" : "text-text-muted group-hover:text-foreground"
        )}
      />
      <span className={clsx("text-base", collapsed && "sr-only")}>{label}</span>
    </button>
  );
}

export default function GlobalSidebar({ activeTab, onTabChange }: GlobalSidebarProps) {
  const t = useTranslations("nav");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(window.localStorage.getItem("iframe-sidebar-collapsed") === "1"); } catch { /* Storage may be disabled in embedded browsers. */ } }, []);
  const toggleCollapsed = () => setCollapsed(value => { const next = !value; try { window.localStorage.setItem("iframe-sidebar-collapsed", next ? "1" : "0"); } catch { /* Keep the toggle usable without storage. */ } return next; });

  const handleNav = (id: GlobalTab, hash: string) => {
    onTabChange(id);
    window.location.hash = hash;
  };

  return (
    <aside
      className={clsx("flex-shrink-0 h-full hidden md:flex flex-col border-r border-glass-border bg-surface/60 backdrop-blur-xl transition-[width] duration-200 motion-reduce:transition-none", collapsed ? "w-[4.25rem]" : "w-52")}
      data-tauri-drag-region
    >
      {/* Traffic Light inset for Tauri desktop */}
      {isTauri() && <div className="tauri-titlebar-inset" />}
      {/* Brand lockup — Logo + LUMENX + Slogan, click → workspace */}
      <button
        type="button"
        onClick={() => handleNav("workspace", "#/")}
        aria-label={t("workspaceAria")}
        className={clsx("text-left pt-5 pb-4 border-b border-glass-border hover:opacity-90 transition-opacity", collapsed ? "px-2" : "px-4")}
      >
        <div className={clsx(collapsed && "flex justify-center")}>{collapsed ? <img src="iframe-logo.png" alt="iFrame" className="h-9 w-9 object-contain" /> : <IFrameBranding size="md" showSlogan={false} />}</div>
        {!collapsed && <p className="font-display atelier-display text-[0.75rem] italic text-text-muted tracking-wide leading-snug mt-2.5">Powered by Lumenx & Uniart</p>}
      </button>

      {/* Primary navigation */}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5 scrollbar-thin" aria-label={t("mainNavAria")}>
        {GLOBAL_NAV_ITEMS.filter(item => item.id !== "settings").map((item) => (
          <div key={item.id}>
            <NavButton
              active={activeTab === item.id}
              label={t(item.id)}
              icon={item.icon}
              onClick={() => handleNav(item.id, item.hash)}
              collapsed={collapsed}
            />
            {item.id === "playground" && activeTab === "playground" && !collapsed && <PlaygroundSessionSubnav />}
          </div>
        ))}
      </nav>

      {/* Settings pinned bottom + version */}
      <div className="p-2.5 border-t border-glass-border">
        <NavButton
          active={activeTab === "settings"}
          label={t("settings")}
          icon={Settings}
          onClick={() => handleNav("settings", "#/settings")}
          collapsed={collapsed}
        />
        <button type="button" className="group mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-text-secondary hover:bg-hover-bg hover:text-foreground" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")} title={t(collapsed ? "expandSidebar" : "collapseSidebar")}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span className={clsx("text-sm", collapsed && "sr-only")}>{t(collapsed ? "expandSidebar" : "collapseSidebar")}</span>
        </button>
        {!collapsed && <div className="px-3 pt-1 font-mono text-[0.6875rem] tracking-wide text-text-muted">{APP_VERSION_LABEL}</div>}
      </div>
    </aside>
  );
}
