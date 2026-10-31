"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Download, Film, Image as ImageIcon, Loader2, Play, ChevronRight, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Series, Character, Scene, Prop, Project, ExtraRosterEntry } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import CharacterWorkbench from "@/components/modules/CharacterWorkbench";
import { useTranslations } from "next-intl";
import SeriesSidebar, { type SidebarItem } from "./SeriesSidebar";
import { AssemblyPlanPhase } from "@/components/modules/VideoAssembly";
import { buildDraftSeriesAssemblyPlan, hasAssemblyPlanChanges } from "@/components/modules/assemblyEditPlan";
import type { AssemblyEditPlan } from "@/lib/api";
import { extractErrorDetail, getAssetUrl } from "@/lib/utils";
import { nextCrowdCharacterName } from "@/lib/crowdNaming";
import { episodeReadableSummary, seriesReadableContext } from "./episodeReadableSummary";

const SeriesModelSettingsModal = dynamic(() => import("./SeriesModelSettingsModal"), { ssr: false });
const SeriesPromptConfigModal = dynamic(() => import("./SeriesPromptConfigModal"), { ssr: false });
const ImportAssetsDialog = dynamic(() => import("./ImportAssetsDialog"), { ssr: false });
const ImportLibraryAssetDialog = dynamic(() => import("./ImportLibraryAssetDialog"), { ssr: false });
const SeriesArtDirectionPanel = dynamic(() => import("./SeriesArtDirectionPanel"), { ssr: false });
const SeriesDirectorProfilePanel = dynamic(() => import("./SeriesDirectorProfilePanel"), { ssr: false });

interface SeriesDetailPageProps {
  seriesId: string;
}

type AssetTab = "characters" | "scenes" | "props";

export default function SeriesDetailPage({ seriesId }: SeriesDetailPageProps) {
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<SidebarItem>({ kind: "asset", tab: "characters" });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [newEpisodeTitle, setNewEpisodeTitle] = useState("");
  const [isCreatingEpisode, setIsCreatingEpisode] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [showImportAssets, setShowImportAssets] = useState(false);
  const [showImportLibraryAssets, setShowImportLibraryAssets] = useState(false);
  const [assemblyPlan, setAssemblyPlan] = useState<AssemblyEditPlan | null>(null);

  const t = useTranslations("series");
  const tc = useTranslations("common");

  const ASSET_LABELS: Record<AssetTab, string> = {
    characters: t("characterLabel"),
    scenes: t("sceneLabel"),
    props: t("propLabel"),
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [seriesData, episodesData] = await Promise.all([
          api.getSeries(seriesId),
          api.getSeriesEpisodes(seriesId),
        ]);
        setSeries(seriesData);
        setEpisodes(episodesData);
        setAssemblyPlan(seriesData.assembly_plan ?? null);
        setEditTitle(seriesData.title);
      } catch (error) {
        console.error("Failed to fetch series data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [seriesId]);

  const handleBackToHome = () => {
    window.location.hash = "";
  };

  const handleTitleSave = async () => {
    if (!editTitle.trim() || !series) return;
    try {
      await api.updateSeries(seriesId, { title: editTitle.trim() });
      setSeries({ ...series, title: editTitle.trim() });
    } catch (error) {
      console.error("Failed to update series title:", error);
      setEditTitle(series.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") {
      setEditTitle(series?.title || "");
      setIsEditingTitle(false);
    }
  };

  const handleAddEpisode = async () => {
    if (!newEpisodeTitle.trim()) return;
    setIsCreatingEpisode(true);
    try {
      const nextEpNum = episodes.length + 1;
      const workflowMode = series?.workflow_mode || "i2v_legacy";
      await api.createEpisodeForSeries(seriesId, newEpisodeTitle.trim(), nextEpNum, workflowMode);
      const updatedEpisodes = await api.getSeriesEpisodes(seriesId);
      setEpisodes(updatedEpisodes);
      setNewEpisodeTitle("");
      setShowAddEpisode(false);
    } catch (error) {
      console.error("Failed to add episode:", error);
    } finally {
      setIsCreatingEpisode(false);
    }
  };

  const handleAddEpisodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddEpisode();
    if (e.key === "Escape") setShowAddEpisode(false);
  };

  const handleOpenEpisode = (episodeId: string) => {
    window.location.hash = `#/series/${seriesId}/episode/${episodeId}`;
  };

  const refreshSeriesData = async () => {
    try {
      const [seriesData, episodesData] = await Promise.all([
        api.getSeries(seriesId),
        api.getSeriesEpisodes(seriesId),
      ]);
      setSeries(seriesData);
      setEpisodes(episodesData);
      setAssemblyPlan(seriesData.assembly_plan ?? null);
    } catch (error) {
      console.error("Failed to refresh series data:", error);
    }
  };

  const handleDeleteAsset = async (tab: AssetTab, asset: Character | Scene | Prop) => {
    if (!window.confirm(t("confirmDeleteAsset", { name: asset.name }))) return;
    try {
      const assetType = tab.slice(0, -1) as "character" | "scene" | "prop";
      try {
        await api.deleteSeriesAsset(seriesId, assetType, asset.id);
      } catch (error) {
        const detail = (error as any)?.response?.data?.detail;
        if (detail?.error !== "series_asset_in_use" || !window.confirm(t("confirmDeleteAssetInUse"))) throw error;
        await api.deleteSeriesAsset(seriesId, assetType, asset.id, true);
      }
      await refreshSeriesData();
    } catch (error) {
      const detail = (error as any)?.response?.data?.detail;
      window.alert(detail?.error === "series_asset_in_use"
        ? t("deleteAssetInUse") : extractErrorDetail(error, t("deleteAssetFailed")));
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-text-secondary">{tc("loading")}</div>
      </div>
    );
  }

  // ── Error ──
  if (!series) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-text-secondary mb-4">{t("notFound")}</p>
          <a href="#/" className="text-primary hover:underline">{t("backToHome")}</a>
        </div>
      </div>
    );
  }

  // ── Derive content ──
  const getAssets = (tab: AssetTab): (Character | Scene | Prop)[] => {
    if (tab === "characters") return series.characters || [];
    if (tab === "scenes") return series.scenes || [];
    return series.props || [];
  };

  const selectedEpisode =
    activeItem.kind === "episode"
      ? episodes.find((ep) => ep.id === activeItem.episodeId)
      : null;

  return (
    <main className="flex h-screen w-screen bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <SeriesSidebar
        series={series}
        episodes={episodes}
        activeItem={activeItem}
        onItemChange={setActiveItem}
        onBack={handleBackToHome}
        isEditingTitle={isEditingTitle}
        editTitle={editTitle}
        onEditTitleChange={setEditTitle}
        onTitleDoubleClick={() => setIsEditingTitle(true)}
        onTitleSave={handleTitleSave}
        onTitleKeyDown={handleTitleKeyDown}
        showAddEpisode={showAddEpisode}
        newEpisodeTitle={newEpisodeTitle}
        isCreatingEpisode={isCreatingEpisode}
        onShowAddEpisode={setShowAddEpisode}
        onNewEpisodeTitleChange={setNewEpisodeTitle}
        onAddEpisode={handleAddEpisode}
        onAddEpisodeKeyDown={handleAddEpisodeKeyDown}
        onOpenModelSettings={() => setShowModelSettings(true)}
        onOpenPromptConfig={() => setShowPromptConfig(true)}
        onOpenImportAssets={() => setShowImportAssets(true)}
        onOpenImportLibraryAssets={() => setShowImportLibraryAssets(true)}
      />

      {/* ── Content Area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {activeItem.kind === "series_director" ? (
            <SeriesDirectorProfilePanel key="series-director" seriesId={seriesId} onSaved={refreshSeriesData} />
          ) : activeItem.kind === "art_direction" ? (
            <SeriesArtDirectionPanel
              key="art-direction"
              seriesId={seriesId}
              onSaved={refreshSeriesData}
            />
          ) : activeItem.kind === "assembly" ? (
            <SeriesAssemblyPanel
              key="series-assembly"
              series={series}
              episodes={episodes}
              plan={assemblyPlan}
              onChange={setAssemblyPlan}
            />
          ) : activeItem.kind === "asset" ? (
            <AssetContentPanel
              key={`asset-${activeItem.tab}`}
              tab={activeItem.tab}
              assets={getAssets(activeItem.tab)}
              label={ASSET_LABELS[activeItem.tab]}
              onDelete={asset => handleDeleteAsset(activeItem.tab, asset)}
            />
          ) : selectedEpisode ? (
            <EpisodeContentPanel
              key={`episode-${selectedEpisode.id}`}
              episode={selectedEpisode}
              series={series}
              seriesId={seriesId}
              onOpenEditor={() => handleOpenEpisode(selectedEpisode.id)}
            />
          ) : null}
        </AnimatePresence>
      </div>

      {/* ── Modals ── */}
      <SeriesModelSettingsModal
        isOpen={showModelSettings}
        onClose={() => setShowModelSettings(false)}
        seriesId={seriesId}
        onSaved={refreshSeriesData}
      />
      <SeriesPromptConfigModal
        isOpen={showPromptConfig}
        onClose={() => setShowPromptConfig(false)}
        seriesId={seriesId}
        onSaved={refreshSeriesData}
      />
      <ImportAssetsDialog
        isOpen={showImportAssets}
        onClose={() => setShowImportAssets(false)}
        seriesId={seriesId}
        onImported={refreshSeriesData}
      />
      <ImportLibraryAssetDialog
        isOpen={showImportLibraryAssets}
        onClose={() => setShowImportLibraryAssets(false)}
        seriesId={seriesId}
        onImported={refreshSeriesData}
      />
    </main>
  );
}

export function ExtraRosterPanel({ series, seriesId, onSaved }: { series: Series; seriesId: string; onSaved: () => Promise<void> }) {
  const [entries, setEntries] = useState<ExtraRosterEntry[]>(series.extra_roster ?? []);
  const [saving, setSaving] = useState(false);
  const [brief, setBrief] = useState("");
  const [proposals, setProposals] = useState<ExtraRosterEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedProposals, setSelectedProposals] = useState<string[]>([]);
  const [creatingVisualAsset, setCreatingVisualAsset] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterAsset, setEditingCharacterAsset] = useState<Character | null>(null);
  const [error, setError] = useState("");
  useEffect(() => setEntries(series.extra_roster ?? []), [series.extra_roster]);
  const selected = entries.find(item => item.extra_id === selectedId) ?? entries[0];
  const linkedCharacter = editingCharacterAsset ?? series.characters?.find(item => item.id === editingCharacterId);
  const add = (kind: ExtraRosterEntry["kind"]) => {
    const extra_id = "extra-" + crypto.randomUUID();
    setEntries(items => [...items, { extra_id, label: kind === "fixed_extra" ? "新固定群演" : "新人群模板", kind }]);
    setSelectedId(extra_id);
  };
  const save = async () => { setSaving(true); setError(""); try { await api.updateSeries(seriesId, { extra_roster: entries }); await onSaved(); } catch (cause) { setError(extractErrorDetail(cause, "保存群演库失败")); } finally { setSaving(false); } };
  const bindCharacter = async (entry: ExtraRosterEntry, characterId: string) => {
    const next = entries.map(item => item.extra_id === entry.extra_id ? { ...item, visual_asset_id: characterId || null } : item);
    setSaving(true); setError("");
    try {
      await api.updateSeries(seriesId, { extra_roster: next });
      setEntries(next);
      await onSaved();
    } catch (cause) { setError(extractErrorDetail(cause, "关联角色失败")); }
    finally { setSaving(false); }
  };
  const generate = async () => {
    if (!brief.trim()) return;
    setGenerating(true);
    try {
      const result = await api.generateExtraRosterProposals(seriesId, brief.trim(), 6);
      setProposals(result.proposals);
      setSelectedProposals(result.proposals.map(item => item.extra_id));
    } finally { setGenerating(false); }
  };
  const adopt = () => {
    const existing = new Set(entries.map(item => item.extra_id));
    setEntries(items => [...items, ...proposals.filter(item => selectedProposals.includes(item.extra_id) && !existing.has(item.extra_id))]);
    setProposals([]);
    setSelectedProposals([]);
  };
  const createVisualAsset = async (entry: ExtraRosterEntry) => {
    if (entry.kind !== "fixed_extra" || entry.visual_asset_id) return;
    setCreatingVisualAsset(entry.extra_id);
    try {
      const character = await api.createSeriesCharacter(seriesId, {
        name: nextCrowdCharacterName(entry.label, (series.characters ?? []).map(item => item.name)),
        persona: entry.label,
        description: [entry.height, entry.body_build, entry.wardrobe, entry.palette, ...(entry.props ?? [])]
          .filter(Boolean).join("；"),
      });
      await bindCharacter(entry, character.id);
      setEditingCharacterAsset(character);
      setEditingCharacterId(character.id);
    } catch (cause) { setError(extractErrorDetail(cause, "创建角色失败")); }
    finally { setCreatingVisualAsset(null); }
  };
  return <div className="flex-1 overflow-auto p-8">
    <h2 className="text-xl font-display font-bold text-foreground">群演资产库</h2>
    <p className="mt-1 text-xs text-text-muted">先确认固定群演或人群模板，再在分镜中明确绑定。这里不会自动生成图片。</p>
    <div className="mt-5 max-w-3xl rounded border border-primary/30 bg-primary/5 p-4">
      <h3 className="text-sm font-medium text-foreground">AI 生成候选</h3>
      <textarea value={brief} onChange={e => setBrief(e.target.value)} placeholder="例如：古代长街黄昏，近景需要两名可辨认商贩，中远景使用退让百姓模板" className="mt-2 min-h-20 w-full bg-input-bg border border-glass-border p-2 text-sm" />
      <button type="button" disabled={generating || !brief.trim()} onClick={generate} className="mt-2 rounded bg-primary px-3 py-2 text-xs text-white">{generating ? "生成中…" : "生成候选群演"}</button>
      {proposals.length > 0 && <div className="mt-4 space-y-2">
        {proposals.map(item => <label key={item.extra_id} className="flex gap-2 rounded border border-glass-border p-2 text-xs">
          <input type="checkbox" checked={selectedProposals.includes(item.extra_id)} onChange={() => setSelectedProposals(items => items.includes(item.extra_id) ? items.filter(id => id !== item.extra_id) : [...items, item.extra_id])} />
          <span><strong className="text-foreground">{item.label}</strong> · {item.kind === "fixed_extra" ? "固定群演" : "人群模板"}<br />{item.wardrobe || item.body_build || item.palette || "待补外观描述"}</span>
        </label>)}
        <button type="button" disabled={!selectedProposals.length} onClick={adopt} className="rounded border border-primary px-3 py-2 text-xs text-primary">采用选中候选</button>
      </div>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-5 flex max-w-5xl flex-col gap-4 md:flex-row">
      <div className="w-full shrink-0 space-y-1 md:w-56" aria-label="群演条目">
        {entries.map(entry => <button key={entry.extra_id} type="button" onClick={() => setSelectedId(entry.extra_id)}
          className={`block w-full rounded border px-3 py-2 text-left text-sm ${selected?.extra_id === entry.extra_id ? "border-primary text-foreground" : "border-glass-border text-text-secondary"}`}>
          <span className="block truncate">{entry.label}</span><span className="text-xs text-text-muted">{entry.kind === "fixed_extra" ? "固定群演" : "人群模板"}</span>
        </button>)}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
      {selected && (() => { const entry = selected; const index = entries.findIndex(item => item.extra_id === entry.extra_id); return <div key={entry.extra_id} className="grid gap-2 rounded border border-glass-border p-3 sm:grid-cols-2">
        {entry.kind === "fixed_extra" && series.characters?.find(character => character.id === entry.visual_asset_id) &&
          <div className="max-w-48 sm:col-span-2"><AssetCard asset={series.characters.find(character => character.id === entry.visual_asset_id)!} type="characters" /></div>}
        <input aria-label="群演名称" value={entry.label} onChange={e => setEntries(items => items.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} className="bg-input-bg border border-glass-border p-2 text-sm" />
        <select aria-label="群演类型" value={entry.kind} onChange={e => setEntries(items => items.map((item, i) => i === index ? { ...item, kind: e.target.value as ExtraRosterEntry["kind"] } : item))} className="bg-input-bg border border-glass-border p-2 text-sm">
          <option value="fixed_extra">固定群演</option><option value="extra_template">人群模板</option>
        </select>
        <input aria-label="群演外观" value={entry.wardrobe ?? ""} placeholder="服装、体态、色彩与识别锚点" onChange={e => setEntries(items => items.map((item, i) => i === index ? { ...item, wardrobe: e.target.value } : item))} className="bg-input-bg border border-glass-border p-2 text-sm sm:col-span-2" />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          {entry.kind === "fixed_extra" && (
            <>
            <select aria-label="关联角色资产" value={entry.visual_asset_id ?? ""} disabled={saving} onChange={e => void bindCharacter(entry, e.target.value)} className="min-w-0 flex-1 bg-input-bg border border-glass-border p-2 text-sm">
              <option value="">未关联角色</option>
              {(series.characters ?? []).map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
              {entry.visual_asset_id && !series.characters?.some(character => character.id === entry.visual_asset_id) && <option value={entry.visual_asset_id}>原角色已失效</option>}
            </select>
            {entry.visual_asset_id && series.characters?.some(character => character.id === entry.visual_asset_id) && <button type="button" onClick={() => { setEditingCharacterAsset(null); setEditingCharacterId(entry.visual_asset_id!); }} className="rounded border border-primary px-2 py-1 text-xs text-primary">设计角色 / 生成资产</button>}
            <button type="button" disabled={Boolean(entry.visual_asset_id) || creatingVisualAsset === entry.extra_id || saving}
              onClick={() => void createVisualAsset(entry)}
              className="whitespace-nowrap rounded border border-primary px-2 py-1 text-[11px] text-primary">
              {creatingVisualAsset === entry.extra_id ? "创建中…" : "新建角色"}
            </button>
            </>
          )}
          <button type="button" className="ml-auto text-danger" onClick={() => { setEntries(items => items.filter((_, i) => i !== index)); setSelectedId(null); }}>删除</button>
        </div>
      </div>; })()}
      <div className="flex gap-2">
        <button type="button" onClick={() => add("fixed_extra")} className="rounded border border-glass-border px-3 py-2 text-xs">添加固定群演</button>
        <button type="button" onClick={() => add("extra_template")} className="rounded border border-glass-border px-3 py-2 text-xs">添加人群模板</button>
        <button type="button" disabled={saving} onClick={save} className="rounded bg-primary px-3 py-2 text-xs text-white">{saving ? "保存中…" : "保存群演库"}</button>
      </div>
      </div>
    </div>
    {linkedCharacter && <CharacterWorkbench asset={linkedCharacter} seriesId={seriesId} onClose={() => { setEditingCharacterId(null); setEditingCharacterAsset(null); }}
      onUpdateDescription={async description => { await api.updateSeriesAssetAttributes(seriesId, linkedCharacter.id, "character", { description }); await onSaved(); }}
      onUpdateAttributes={async attributes => { await api.updateSeriesAssetAttributes(seriesId, linkedCharacter.id, "character", attributes); await onSaved(); }}
      onRename={async name => { await api.updateSeriesAssetAttributes(seriesId, linkedCharacter.id, "character", { name }); await onSaved(); }}
      onGenerate={async (type, prompt, applyStyle, negativePrompt, batchSize, references = [], imageGenerationMode = "text", reviewFingerprint) => {
        try {
          const derived = type === "three_view" || type === "headshot";
          const result = await api.generateSeriesCharacter(seriesId, { asset_id: linkedCharacter.id, asset_type: "character", style_preset: "realistic", generation_type: type, prompt, apply_style: applyStyle, negative_prompt: negativePrompt, batch_size: batchSize, ...(derived ? { reference: references[0] } : { references }), image_generation_mode: imageGenerationMode, preserve_prompt: true, expected_review_fingerprint: reviewFingerprint });
          if (result._task_id) {
            const poll = async () => {
              const task = await api.getTaskStatus(result._task_id);
              if (task.status === "completed" || task.status === "failed") { await onSaved(); return; }
              window.setTimeout(() => void poll(), 2500);
            };
            void poll();
          } else await onSaved();
        } catch (cause) { setError(extractErrorDetail(cause, "生成角色图片失败")); }
      }} generatingTypes={[]} />}
  </div>;
}

function SeriesAssemblyPanel({
  series,
  episodes,
  plan,
  onChange,
}: {
  series: Series;
  episodes: Project[];
  plan: AssemblyEditPlan | null;
  onChange: (plan: AssemblyEditPlan | null) => void;
}) {
  const t = useTranslations("series");
  const [draft, setDraft] = useState<AssemblyEditPlan | null>(plan);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(series.merged_video_url ?? null);

  useEffect(() => {
    setDraft(plan);
  }, [plan]);

  useEffect(() => {
    setRenderedUrl(series.merged_video_url ?? null);
  }, [series.merged_video_url]);

  const hasUnsavedChanges = hasAssemblyPlanChanges(draft, plan);

  const readyCount = episodes.reduce((total, episode) => {
    const tasks = episode.video_tasks ?? [];
    return total + (episode.frames ?? []).filter((frame: any) => {
      const selected = frame.selected_video_id
        ? tasks.find((task: any) => task.id === frame.selected_video_id)
        : tasks.find((task: any) => task.frame_id === frame.id && task.status === "completed" && task.video_url);
      return Boolean(frame.dubbed_video_url || (selected?.status === "completed" && selected?.video_url));
    }).length;
  }, 0);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveAssemblyPlan("series", series.id, draft);
      setDraft(saved);
      onChange(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Series Assembly save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRender = async () => {
    if (!draft || hasUnsavedChanges) return;
    setRendering(true);
    setRenderError(null);
    try {
      const rendered = await api.renderAssemblyPlan("series", series.id);
      setRenderedUrl(rendered.url);
    } catch (renderFailure) {
      setRenderError(extractErrorDetail(renderFailure, "Series Assembly render failed"));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-6 pb-2">
        <h2 className="text-xl font-display font-bold text-foreground">{t("assemblyTitle")}</h2>
        <p className="mt-1 text-xs text-text-muted">{t("assemblySubtitle")}</p>
      </div>
      <AssemblyPlanPhase
        project={null}
        plan={draft}
        isSaving={saving}
        error={error}
        readyCountOverride={readyCount}
        onCreate={() => setDraft(buildDraftSeriesAssemblyPlan(series.id, episodes))}
        onChange={setDraft}
        onSave={handleSave}
      />
      {draft && (
        <section className="shrink-0 border-t border-glass-border bg-surface px-8 py-4" aria-labelledby="series-assembly-render-title">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 id="series-assembly-render-title" className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Film size={15} className="text-primary" aria-hidden="true" />
                {t("assemblyRenderTitle")}
              </h3>
              <p className="mt-1 text-xs text-text-muted">
                {hasUnsavedChanges ? t("assemblySaveBeforeRender") : t("assemblyRenderHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {renderedUrl && (
                <a
                  href={getAssetUrl(renderedUrl)}
                  download
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-glass-border bg-glass px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-hover-bg"
                >
                  <Download size={14} aria-hidden="true" />
                  {t("assemblyDownload")}
                </a>
              )}
              <button
                type="button"
                onClick={handleRender}
                disabled={rendering || hasUnsavedChanges}
                aria-busy={rendering}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {rendering ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Film size={14} aria-hidden="true" />}
                {rendering ? t("assemblyRendering") : t("assemblyRender")}
              </button>
            </div>
          </div>
          {renderError && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{renderError}</span>
            </div>
          )}
          {renderedUrl && (
            <video
              src={getAssetUrl(renderedUrl)}
              controls
              className="mt-4 aspect-video max-h-64 w-full rounded-md bg-black object-contain"
            />
          )}
        </section>
      )}
    </div>
  );
}

// ── Shared animation config ──

const contentTransition = {
  duration: 0.25,
  ease: [0.25, 1, 0.5, 1] as const, // ease-out-quart
};

// ── Asset Content Panel ──

function AssetContentPanel({
  tab,
  assets,
  label,
  onDelete,
}: {
  tab: AssetTab;
  assets: (Character | Scene | Prop)[];
  label: string;
  onDelete: (asset: Character | Scene | Prop) => void;
}) {
  const t = useTranslations("series");

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4">
        <h2 className="text-xl font-display font-bold text-foreground">
          {label}
          <span className="text-sm font-normal text-text-secondary ml-2">
            {t("itemCount", { count: assets.length })}
          </span>
        </h2>
        <p className="text-xs text-text-muted mt-1">
          {t("sharedAssetsEditHint")}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 rounded-2xl bg-glass border border-glass-border flex items-center justify-center mb-4"
            >
              <ImageIcon size={28} className="text-text-muted" />
            </motion.div>
            <p className="text-sm font-medium">{t("noAssets", { label })}</p>
            <p className="text-xs text-text-muted mt-1">{t("assetsSharedHint")}</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {assets.map((asset) => (
              <motion.div
                key={asset.id}
                variants={{
                  hidden: { opacity: 0, y: 16, scale: 0.97 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { duration: 0.3, ease: [0.25, 1, 0.5, 1] },
                  },
                }}
              >
                <div className="relative">
                  <AssetCard asset={asset} type={tab} />
                  <button type="button" onClick={() => onDelete(asset)}
                    aria-label={t("deleteAsset", { name: asset.name })}
                    title={t("deleteAsset", { name: asset.name })}
                    className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-text-secondary hover:text-red-500">
                    <Trash2 size={15} />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Episode Content Panel ──

function EpisodeContentPanel({
  episode,
  series,
  seriesId,
  onOpenEditor,
}: {
  episode: Project;
  series: Series | null;
  seriesId: string;
  onOpenEditor: () => void;
}) {
  const t = useTranslations("series");

  const frames = episode.frames || [];
  const characters = episode.characters || [];
  const scenes = episode.scenes || [];
  const seriesDirector = series?.art_direction?.director_profile;
  const episodeDirector = episode.art_direction?.director_profile;
  const handoff = episode.episode_understanding;
  const handoffCurrent = !!handoff && handoff.status !== "stale"
    && handoff.source_revision === episode.source_revision
    && handoff.series_director_revision === (seriesDirector?.revision ?? null)
    && handoff.episode_director_revision === (episodeDirector?.revision ?? null);
  const episodeSummary = handoffCurrent && handoff?.status === "confirmed"
    && handoff.episode_summary && !handoff.episode_summary.includes('CURRENT_DIRECTOR_EDITS:')
    ? handoff.episode_summary || ''
    : episodeReadableSummary(episodeDirector);
  const contextParagraphs = seriesReadableContext(seriesDirector);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4 flex items-start justify-between border-b border-glass-border">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-lg font-mono font-bold">
              EP{episode.episode_number || "?"}
            </span>
            <h2 className="text-xl font-display font-bold text-foreground">
              {episode.title}
            </h2>
          </div>
          <p className="text-xs text-text-secondary">
            {episode.workflow_mode === "r2v" ? "R2V" : "I2V Legacy"} · {t("frameCount", { count: frames.length })}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onOpenEditor}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-primary/20 hover:shadow-primary/30"
        >
          <Play size={14} />
          {t("enterEditor")}
          <ChevronRight size={14} />
        </motion.button>
      </div>

      {/* Episode Overview */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Director understanding handoff. The source text remains in the editor. */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-glass-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{t("seriesContext")}</h3>
              <span className="text-[0.6875rem] text-text-muted">{handoffCurrent && handoff?.incoming_handoff && Object.keys(handoff.incoming_handoff).length > 0 ? t("handoffReady") : seriesDirector ? `r${seriesDirector.revision}` : t("understandingNotReady")}</span>
            </div>
            {contextParagraphs.length ? contextParagraphs.map((paragraph, index) => (
              <p key={index} className="text-xs leading-relaxed text-text-secondary">{paragraph}</p>
            )) : <p className="text-xs leading-relaxed text-text-secondary">{seriesDirector ? t("seriesContextReadableNotReady") : t("seriesContextNotReady")}</p>}
            {handoffCurrent && handoff?.incoming_handoff && Object.keys(handoff.incoming_handoff).length > 0 && (
              <p className="text-[0.6875rem] leading-5 text-text-muted">{JSON.stringify(handoff.incoming_handoff)}</p>
            )}
          </div>
          <div className="space-y-2 rounded-lg border border-glass-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{t("episodeSummary")}</h3>
              <span className="text-[0.6875rem] text-text-muted">{handoff && !handoffCurrent ? t("understandingStale") : handoff?.status === "confirmed" ? t("understandingConfirmed") : episodeDirector ? t("understandingCompatibility") : t("understandingNotReady")}</span>
            </div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {episodeSummary || t("episodeSummaryNotReady")}
            </p>
            {handoffCurrent && handoff?.outgoing_handoff && Object.keys(handoff.outgoing_handoff).length > 0 && (
              <p className="text-[0.6875rem] leading-5 text-text-muted">{JSON.stringify(handoff.outgoing_handoff)}</p>
            )}
          </div>
        </div>

        {/* Storyboard Overview */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("storyboardOverview")}</h3>
          {frames.length === 0 ? (
            <div className="flex items-center gap-3 bg-surface rounded-lg p-4 border border-glass-border">
              <div className="w-10 h-10 rounded-lg bg-glass border border-glass-border flex items-center justify-center">
                <Play size={16} className="text-text-muted" />
              </div>
              <div>
                <p className="text-xs font-medium text-text-secondary">{t("noFrames")}</p>
                <p className="text-[0.6875rem] text-text-muted">{t("startCreating")}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 lg:grid-cols-6 gap-2">
              {frames.slice(0, 12).map((frame, i) => (
                <div
                  key={frame.id}
                  className="aspect-video bg-surface rounded-lg border border-glass-border overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={onOpenEditor}
                >
                  {(frame.cover_url || frame.rendered_image_url) ? (
                    <img
                      src={getAssetUrl(frame.cover_url || frame.rendered_image_url)}
                      alt={`#${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[0.625rem] text-text-muted font-mono">
                      #{i + 1}
                    </div>
                  )}
                </div>
              ))}
              {frames.length > 12 && (
                <div className="aspect-video bg-surface rounded-lg border border-glass-border flex items-center justify-center text-xs text-text-muted">
                  +{frames.length - 12}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Characters & Scenes count */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{characters.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("characters")}</p>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{scenes.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("scenes")}</p>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-glass-border text-center">
            <p className="text-lg font-bold text-foreground">{frames.length}</p>
            <p className="text-[0.6875rem] text-text-muted">{t("storyboardFrames")}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
