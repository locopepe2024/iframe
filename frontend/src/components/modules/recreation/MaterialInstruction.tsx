"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RecreationMedia } from "@/lib/recreation";
import { API_URL } from "@/lib/api";

export default function MaterialInstruction({ value, onChange, materials }: {
  value: string; onChange: (text: string) => void; materials: { role: string; media: RecreationMedia }[];
}) {
  const t = useTranslations("shotReferences");
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const insert = (id: string) => {
    const input = field.current!;
    const start = at ?? input.selectionStart;
    const end = at === null ? input.selectionEnd : at + 1;
    const token = `@{${id}}`;
    const text = value.slice(0, start) + token + value.slice(end);
    if (text.length > 4000) return;
    onChange(text); setOpen(false); setAt(null);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + token.length, start + token.length); });
  };
  const preview = value.replace(/@\{([a-f0-9]{32})\}/g, (_, id) => {
    const entry = materials.find(item => item.media.media_id === id);
    return entry ? `@${t(entry.role)}「${entry.media.display_name}」` : t("unresolvedMention");
  });
  return <div className="space-y-2">
    <label className="block text-sm">{t("instruction")}<textarea ref={field} className="glass-input block w-full mt-2" rows={3} maxLength={4000} value={value} onChange={e => {
      const text = e.target.value, caret = e.target.selectionStart;
      onChange(text);
      const typedAt = text[caret - 1] === "@";
      setOpen(typedAt); setAt(typedAt ? caret - 1 : null);
    }} /></label>
    <button type="button" className="glass-button" aria-expanded={open} onClick={() => { setAt(null); setOpen(!open); }}>{t("insertMention")}</button>
    {open && <div className="flex flex-wrap gap-2" aria-label={t("insertMention")}>
      {!materials.length && <p>{t("selectMaterialFirst")}</p>}
      {materials.map(({ role, media }) => <button key={role} type="button" className="glass-button flex items-center gap-2 max-w-full" onClick={() => insert(media.media_id)}>
        <img alt="" className="w-12 h-10 object-contain" src={media.storage_path.startsWith("/") ? API_URL + media.storage_path : media.storage_path} />
        <span className="min-w-0 break-all">@{t(role)} · {media.display_name}</span>
      </button>)}
    </div>}
    {value.includes("@") && <p className="text-sm break-words" aria-label={t("mentionPreview")}>{preview}</p>}
  </div>;
}
