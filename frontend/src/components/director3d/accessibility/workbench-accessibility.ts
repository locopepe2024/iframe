import type { ViewMode } from "../types";

export type WorkbenchShortcut = "undo" | "redo";

interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { tagName?: string; isContentEditable?: boolean };
  const tagName = candidate.tagName?.toLowerCase();
  return candidate.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function resolveWorkbenchShortcut(event: ShortcutEventLike): WorkbenchShortcut | null {
  if (isTextEntryTarget(event.target)) return null;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && key === "z") return event.shiftKey ? "redo" : "undo";
  if (event.ctrlKey && !event.metaKey && key === "y") return "redo";
  return null;
}

const VIEW_ORDER: ViewMode[] = ["director", "top", "camera"];

export function resolveViewTabKey(current: ViewMode, key: string): ViewMode | null {
  const currentIndex = VIEW_ORDER.indexOf(current);
  if (key === "Home") return VIEW_ORDER[0];
  if (key === "End") return VIEW_ORDER.at(-1) ?? current;
  if (key === "ArrowRight" || key === "ArrowDown") return VIEW_ORDER[(currentIndex + 1) % VIEW_ORDER.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return VIEW_ORDER[(currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length];
  return null;
}
