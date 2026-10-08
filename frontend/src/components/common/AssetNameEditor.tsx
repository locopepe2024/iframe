"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, X } from "lucide-react";

export default function AssetNameEditor({ name, onRename, className = "" }: {
  name: string;
  onRename?: (name: string) => Promise<void>;
  className?: string;
}) {
  const t = useTranslations("library");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cancel = () => {
    setDraft(name);
    setEditing(false);
    setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next || !onRename || saving) return;
    if (next === name) {
      cancel();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onRename(next);
      setEditing(false);
    } catch {
      setError(t("renameFailed"));
    } finally {
      setSaving(false);
    }
  };

  return <div className="min-w-0">
    {editing ? <form onSubmit={(event) => void save(event)} className="flex min-w-0 items-center gap-1.5">
      <input autoFocus aria-label={t("assetName")} value={draft} maxLength={200}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } }}
        className="min-w-0 flex-1 rounded border border-primary bg-input-bg px-2 py-1 text-sm text-foreground focus:outline-none" />
      <button type="submit" title={t("saveName")} aria-label={t("saveName")} disabled={!draft.trim() || saving}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-primary hover:bg-hover-bg disabled:opacity-40"><Check size={16} /></button>
      <button type="button" title={t("cancelRename")} aria-label={t("cancelRename")} onClick={cancel} disabled={saving}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-hover-bg disabled:opacity-40"><X size={16} /></button>
    </form> : <div className="flex min-w-0 items-center gap-1">
      <span className={`min-w-0 truncate ${className}`} title={name}>{name}</span>
      {onRename && <button type="button" title={t("renameAsset")} aria-label={t("renameAsset")}
        onClick={() => { setDraft(name); setError(""); setEditing(true); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-muted hover:bg-hover-bg hover:text-foreground"><Pencil size={15} /></button>}
    </div>}
    {error && <p role="alert" className="mt-1 text-xs text-status-failed-fg">{error}</p>}
  </div>;
}
