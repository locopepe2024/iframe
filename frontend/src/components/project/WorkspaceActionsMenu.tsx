"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";

export default function WorkspaceActionsMenu({ label, renameLabel, deleteLabel, placement = "above", onRename, onDelete }: {
  label: string;
  renameLabel: string;
  deleteLabel: string;
  placement?: "above" | "below";
  onRename?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="grid h-9 w-9 place-items-center rounded text-text-muted hover:bg-hover-bg hover:text-foreground">
        <MoreVertical size={16} />
      </button>
      {open && <div role="menu" aria-label={label}
        className={`absolute right-0 z-30 w-36 rounded-md border border-glass-border bg-elevated p-1 shadow-xl ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"}`}>
        {onRename && <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }}
          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-hover-bg">
          <Pencil size={14} />{renameLabel}
        </button>}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onDelete(); }}
          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-status-failed-fg hover:bg-hover-bg">
          <Trash2 size={14} />{deleteLabel}
        </button>
      </div>}
    </div>
  );
}
