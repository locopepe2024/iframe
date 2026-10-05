"use client";
import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

type AssetType = "character" | "scene" | "prop";
type Asset = { id: string; name: string; description?: string };
export default function ImportLibraryAssetDialog({ isOpen, onClose, seriesId, onImported }: { isOpen: boolean; onClose: () => void; seriesId: string; onImported: () => void }) {
  const t = useTranslations("series");
  const [type, setType] = useState<AssetType>("character");
  const [assets, setAssets] = useState<Record<AssetType, Asset[]>>({ character: [], scene: [], prop: [] });
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState("");
  useEffect(() => { if (!isOpen) return; void api.listLibraryAssets().then(value => setAssets({ character: value.characters ?? [], scene: value.scenes ?? [], prop: value.props ?? [] })).catch(e => setError(String(e?.message || e))); }, [isOpen]);
  if (!isOpen) return null;
  const importAsset = async (asset: Asset) => { setBusy(asset.id); setError(""); try { await api.importLibraryAssetToSeries(seriesId, type, asset.id); onImported(); } catch (e) { setError(String((e as any)?.message || e)); } finally { setBusy(null); } };
  const tabs: [AssetType, string][] = [["character", t("libraryCharacters")], ["scene", t("libraryScenes")], ["prop", t("libraryProps")]];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}><div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-elevated" onClick={e => e.stopPropagation()}><header className="flex items-center justify-between border-b border-glass-border p-5"><div><h2 className="text-base font-semibold text-foreground">{t("importLibraryTitle")}</h2><p className="mt-1 text-xs text-text-secondary">{t("importLibraryHint")}</p></div><button type="button" onClick={onClose} aria-label={t("close")}><X size={18} /></button></header><div className="flex gap-2 border-b border-glass-border p-3">{tabs.map(([id, label]) => <button type="button" key={id} onClick={() => setType(id)} className={`rounded-md px-3 py-2 text-xs ${type === id ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-hover-bg"}`}>{label} ({assets[id].length})</button>)}</div>{error && <p role="alert" className="mx-4 mt-3 rounded border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-200">{error}</p>}<div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="grid gap-2 sm:grid-cols-2">{assets[type].map(asset => <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 p-3"><div className="min-w-0"><p className="truncate text-sm text-foreground">{asset.name}</p><p className="mt-1 line-clamp-2 text-xs text-text-muted">{asset.description || "—"}</p></div><button type="button" onClick={() => importAsset(asset)} disabled={busy !== null} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-surface disabled:opacity-50">{busy === asset.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{t("import")}</button></div>)}</div>{assets[type].length === 0 && <p className="py-8 text-center text-sm text-text-muted">{t("libraryEmpty")}</p>}</div></div></div>;
}
