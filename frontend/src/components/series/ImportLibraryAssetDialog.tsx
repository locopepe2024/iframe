"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, Loader2, MapPin, Package, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { Character, Prop, Scene } from "@/store/projectStore";
import { characterImageUrl } from "@/lib/characterImage";

type AssetType = "character" | "scene" | "prop";
type LibraryAsset = Character | Scene | Prop;

interface Props {
  isOpen: boolean;
  seriesId: string;
  onClose: () => void;
  onImported?: () => void;
}

function imageUrl(asset: LibraryAsset, type: AssetType) {
  if (type === "character") return characterImageUrl(asset as Character);
  const value = asset as Scene | Prop;
  if (value.image_asset?.variants?.length) {
    const selected = value.image_asset.variants.find((v) => v.id === value.image_asset?.selected_id);
    return selected?.url || value.image_asset.variants[0]?.url;
  }
  return value.image_url;
}

export default function ImportLibraryAssetDialog({ isOpen, seriesId, onClose, onImported }: Props) {
  const t = useTranslations("series");
  const tc = useTranslations("common");
  const [type, setType] = useState<AssetType>("character");
  const [assets, setAssets] = useState<Record<AssetType, LibraryAsset[]>>({ character: [], scene: [], prop: [] });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    api.listLibraryAssets()
      .then((data) => setAssets({ character: data.characters || [], scene: data.scenes || [], prop: data.props || [] }))
      .catch(() => setError(t("libraryLoadFailed")))
      .finally(() => setLoading(false));
  }, [isOpen, t]);

  const tabs = [
    { id: "character" as const, label: t("libraryCharacters"), icon: Users },
    { id: "scene" as const, label: t("libraryScenes"), icon: MapPin },
    { id: "prop" as const, label: t("libraryProps"), icon: Package },
  ];

  const handleImport = async (asset: LibraryAsset) => {
    setImporting(asset.id);
    setError(null);
    try {
      await api.importLibraryAssetToSeries(seriesId, type, asset.id);
      onImported?.();
      setAssets((current) => ({ ...current, [type]: current[type].filter((item) => item.id !== asset.id) }));
    } catch {
      setError(t("libraryImportFailed"));
    } finally {
      setImporting(null);
    }
  };

  if (!isOpen) return null;
  const currentAssets = assets[type];

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div className="bg-elevated rounded-2xl border border-glass-border w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(event) => event.stopPropagation()}>
          <div className="p-5 border-b border-glass-border flex items-center justify-between">
            <div className="flex items-center gap-3"><Download size={20} className="text-green-400" /><div><h2 className="text-lg font-bold text-foreground">{t("importLibraryTitle")}</h2><p className="text-xs text-text-secondary">{t("importLibraryHint")}</p></div></div>
            <button onClick={onClose} aria-label={tc("cancel")} className="p-2 hover:bg-hover-bg rounded-lg"><X size={20} className="text-text-secondary" /></button>
          </div>
          <div className="flex gap-2 px-5 py-3 border-b border-border-subtle">
            {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setType(id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${type === id ? "bg-primary/10 text-foreground" : "text-text-secondary hover:bg-hover-bg"}`}><Icon size={16} />{label}<span className="text-xs opacity-70">{assets[id].length}</span></button>)}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
            {loading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" /></div> : currentAssets.length === 0 ? <div className="text-center py-12 text-sm text-text-muted">{t("libraryEmpty")}</div> : <div className="space-y-2">{currentAssets.map((asset) => <div key={asset.id} className="flex items-center gap-3 p-3 rounded-xl border border-glass-border bg-glass"><div className="w-12 h-12 rounded-lg overflow-hidden bg-hover-bg flex items-center justify-center">{imageUrl(asset, type) ? <img src={imageUrl(asset, type)} alt="" className="w-full h-full object-cover" /> : <Package size={18} className="text-text-muted" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground truncate">{asset.name}</p><p className="text-xs text-text-secondary line-clamp-1">{asset.description || ""}</p></div><button onClick={() => handleImport(asset)} disabled={importing !== null} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-xs disabled:opacity-50">{importing === asset.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t("importOne")}</button></div>)}</div>}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
