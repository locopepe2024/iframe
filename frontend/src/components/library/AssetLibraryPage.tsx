"use client";

import { EditingMaterialManager } from "../modules/editing/EditingPage";
import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Search, Star, ArrowDownUp, ChevronDown, Check, Plus, Trash2, Folder, ArrowLeft } from "lucide-react";
import { api, API_URL, authenticatedFetch } from "@/lib/api";
import type { Character, Scene, Prop, ImageAsset, ImageVariant } from "@/store/projectStore";
import type { AssetCoverSelectionResult, AssetReferenceIndexEntry } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { toast } from "@/store/toastStore";
import { characterImageUrl, characterVariants } from "@/lib/characterImage";
import { coverGradient, GRAIN_URL } from "@/lib/atelierCover";
import { rovingKeyDown } from "@/lib/a11y";
import RecreationMediaLibrary from "./RecreationMediaLibrary";
import AssetInspector from "./AssetInspector";
import NewLibraryAssetDialog from "./NewLibraryAssetDialog";
import AssetNameEditor from "@/components/common/AssetNameEditor";
import { useProjectStore } from "@/store/projectStore";

type AssetTab = "characters" | "scenes" | "props";
type TypeFilter = AssetTab | "all";
type SortMode = "default" | "name" | "recent" | "usage";
type ViewAxis = "type" | "source";

const SINGULAR: Record<AssetTab, string> = { characters: "character", scenes: "scene", props: "prop" };

interface AssetSource {
  id: string; // `series-X` / `project-X`（列表 key）
  rawId: string; // 裸 series/project id（调 API 用）
  name: string;
  kind: "series" | "project" | "global";
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}

/** 渲染条目：携带所属 source，使「按类型」视图也能按源显示/操作。 */
interface RenderItem {
  asset: Character | Scene | Prop;
  type: AssetTab;
  src: AssetSource;
}

/** 渲染分组：「按类型」按资产类型、「按项目」按源，统一结构（title + meta + items）。 */
interface RenderGroup {
  key: string;
  title: string;
  meta: string;
  items: RenderItem[];
}

/** 取图：character 走 characterImageUrl（reference_sheet→full_body→legacy）；scene/prop 用 image_asset。 */
function getImageUrl(asset: Character | Scene | Prop, type: AssetTab): string | undefined {
  if (type === "characters") {
    const character = asset as Character;
    const coverVariant = character.cover_variant_id
      ? [
          ...(character.reference_sheet?.image_variants ?? []),
          ...(character.full_body_asset?.variants ?? []),
          ...(character.three_view_asset?.variants ?? []),
          ...(character.headshot_asset?.variants ?? []),
        ].find((variant) => variant.id === character.cover_variant_id)
      : undefined;
    const raw = coverVariant?.url || characterImageUrl(character);
    return raw ? getAssetUrl(raw) : undefined;
  }
  const a = asset as Scene | Prop;
  const variants = a.image_asset?.variants ?? [];
  const cover = variants.find((variant) => variant.id === a.cover_variant_id);
  const selected = variants.find((variant) => variant.id === a.image_asset?.selected_id);
  const raw = cover?.url || selected?.url || variants[0]?.url || a.image_url;
  return raw ? getAssetUrl(raw) : undefined;
}

function getCoverVariantId(asset: Character | Scene | Prop, type: AssetTab): string | undefined {
  if (type === "characters") {
    const character = asset as Character;
    return character.cover_variant_id || character.reference_sheet?.selected_image_id || character.reference_sheet?.image_variants?.[0]?.id;
  }
  const item = asset as Scene | Prop;
  return item.cover_variant_id || item.image_asset?.selected_id || item.image_asset?.variants?.[0]?.id;
}

function AssetCover({ asset, type, source, url }: { asset: Character | Scene | Prop; type: AssetTab; source: AssetSource; url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [displayUrl, setDisplayUrl] = useState<string>();
  const variantId = getCoverVariantId(asset, type);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    if (!variantId) {
      setDisplayUrl(url);
      return;
    }
    const params = new URLSearchParams({
      scope: source.kind,
      container_id: source.kind === "global" ? "" : source.rawId,
      asset_type: SINGULAR[type],
      asset_id: asset.id,
      variant_id: variantId,
    });
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setDisplayUrl(undefined);
    authenticatedFetch(`${API_URL}/asset-index/preview?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Asset preview unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setDisplayUrl(objectUrl);
      })
      .catch(() => { if (!controller.signal.aborted) setDisplayUrl(undefined); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [nearViewport, url, variantId, source.kind, source.rawId, type, asset.id]);

  return <div ref={ref} className="absolute inset-0">
    {displayUrl && (type === "characters" ? <>
      <img src={displayUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40" />
      <img src={displayUrl} alt={asset.name} loading="lazy" decoding="async" className="relative w-full h-full object-contain transition-transform group-hover:scale-105" />
    </> : <img src={displayUrl} alt={asset.name} loading="lazy" decoding="async" className="w-full h-full object-contain transition-transform group-hover:scale-105" />)}
  </div>;
}

function variantCount(asset: Character | Scene | Prop, type: AssetTab): number {
  if (type === "characters") return characterVariants(asset as Character).length;
  return (asset as Scene | Prop).image_asset?.variants?.length ?? 0;
}

/** 「最近」排序用：派生资产的最新图片时间戳（秒，time.time）。
 *  character 取 full_body/three_view/headshot updated_at + reference_sheet 变体 created_at 的最大值；
 *  scene/prop 取 image_asset 的 created_at/image_updated_at + 变体 created_at 的最大值。
 *  全无时间戳 → 0（降序时排最后）。纯前端派生。 */
function recencyOf(asset: Character | Scene | Prop, type: AssetTab): number {
  const ts: number[] = [];
  if (type === "characters") {
    const c = asset as Character;
    if (c.full_body_updated_at) ts.push(c.full_body_updated_at);
    if (c.three_view_updated_at) ts.push(c.three_view_updated_at);
    if (c.headshot_updated_at) ts.push(c.headshot_updated_at);
    for (const v of c.reference_sheet?.image_variants ?? []) if (v.created_at) ts.push(v.created_at);
  } else {
    const a = asset as Scene | Prop;
    // ImageAsset 的 TS 类型未声明 created_at/image_updated_at，但后端确实下发（time.time 秒）；
    // 防御性读取后端字段，并以变体 created_at 兜底。
    const ia = a.image_asset as (ImageAsset & { created_at?: number; image_updated_at?: number }) | undefined;
    if (ia?.created_at) ts.push(ia.created_at);
    if (ia?.image_updated_at) ts.push(ia.image_updated_at);
    for (const v of ia?.variants ?? []) if (v.created_at) ts.push(v.created_at);
  }
  return ts.length ? Math.max(...ts) : 0;
}

export default function AssetLibraryPage() {
  const t = useTranslations("recreationMedia");
  const tl = useTranslations("library");
  const [section, setSection] = useState("assets");
  const [reviewer, setReviewer] = useState(false);
  useEffect(() => {
    void api.getPlatformReferenceReviewer?.().then((result) => setReviewer(!!result.authorized)).catch(() => setReviewer(false));
  }, []);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap gap-2 px-4 pt-3 md:px-7" role="group" aria-label={t("sections")}>
      {["assets", "platform", "templates", "media", "editing"].map(value => <button key={value} type="button" aria-pressed={section === value}
        className="glass-button px-4 py-2 aria-pressed:text-primary" onClick={() => setSection(value)}>{value === "editing" ? "剪辑素材" : value === "platform" ? tl("platform") : value === "templates" ? "工作台模板" : t(value)}</button>)}
    </div>
    {section === "assets" ? <SemanticAssetLibrary /> : section === "platform" ? <PlatformReferenceReviewQueue /> : section === "templates" ? <WorkbenchTemplateLibrary /> : section === "editing" ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><EditingMaterialManager /></div> : <RecreationMediaLibrary />}
  </div>;
}

function WorkbenchTemplateLibrary() {
  const [templates, setTemplates] = useState<import("@/lib/api").WorkbenchTemplate[]>([]);
  const [station, setStation] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.getWorkbenchTemplates(station, query).then((result) => {
      if (active) { setTemplates(result.templates); setError(""); }
    }).catch(() => { if (active) { setTemplates([]); setError("模板目录读取失败"); } });
    return () => { active = false; };
  }, [station, query]);
  return <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 md:px-7">
    <h1 className="text-2xl font-display font-semibold text-foreground">工作台模板</h1>
    <p className="mt-1 text-sm text-text-secondary">任务模板只说明用途和所需输入；没有参考图，也不会自动写入提示词。</p>
    <div className="my-4 flex flex-wrap gap-2">
      <input aria-label="搜索工作台模板" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或任务重点"
        className="glass-input min-w-52 flex-1 px-3 py-2 text-sm" />
      <select aria-label="筛选模板工位" value={station} onChange={(event) => setStation(event.target.value)} className="glass-input px-3 py-2 text-sm">
        <option value="">全部工位</option><option value="character">角色</option><option value="scene">场景</option><option value="prop">道具</option><option value="shot">分镜</option>
      </select>
    </div>
    {error ? <p role="alert" className="text-sm text-status-failed-fg">{error}</p> : null}
    {!error && templates.length === 0 ? <p className="text-sm text-text-secondary">没有匹配的任务模板。</p> : null}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((item) => <article key={item.template_id} className="glass-panel rounded-xl border border-glass-border p-4">
        <h2 className="font-semibold text-foreground">{item.title}</h2>
        <p className="mt-1 text-xs text-text-muted">{item.station} · {item.kind} · v{item.revision}</p>
        <p className="mt-3 text-sm text-text-secondary">{item.focus}</p>
        <p className="mt-3 text-xs text-text-muted">输入：{item.input_slots.map((slot) => `${slot.label}${slot.required ? "（必填）" : "（可选）"}`).join("、")}</p>
        <p className="mt-3 text-xs text-text-muted">来源：{item.source.repository} · {item.source.commit.slice(0, 8)} · {item.source.license}</p>
      </article>)}
    </div>
  </div>;
}

function PlatformCandidatePreview({ resourceId, kind }: { resourceId: string; kind: string }) {
  const [url, setUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    void authenticatedFetch(`${API_URL}/platform-reference-library/${encodeURIComponent(resourceId)}/media?preview=true`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        objectUrl = URL.createObjectURL(await response.blob());
        setUrl(objectUrl);
      }).catch(() => setUrl(""));
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [resourceId]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  const showVideo = async () => {
    setVideoLoading(true);
    try {
      const response = await authenticatedFetch(`${API_URL}/platform-reference-library/${encodeURIComponent(resourceId)}/media`);
      if (!response.ok) throw new Error("video unavailable");
      setVideoUrl(URL.createObjectURL(await response.blob()));
    } catch { toast.error("视频预览暂不可用"); }
    finally { setVideoLoading(false); }
  };
  return <div className="mt-3">
    {url ? <img src={url} alt="平台候选预览" className="max-h-44 rounded-md object-contain" /> : <p className="text-xs text-text-muted">预览暂不可用</p>}
    {kind === "video" && (videoUrl
      ? <video src={videoUrl} controls className="mt-2 max-h-44 w-full rounded-md object-contain" />
      : <button type="button" disabled={videoLoading} onClick={() => void showVideo()} className="mt-2 glass-button px-2 py-1 text-xs disabled:opacity-50">{videoLoading ? "正在读取视频…" : "查看原视频"}</button>)}
  </div>;
}

function PlatformReferenceReviewQueue() {
  const t = useTranslations("library");
  const [catalog, setCatalog] = useState<import("@/lib/api").PlatformReferenceCatalog | null>(null);
  const [activeCatalog, setActiveCatalog] = useState<import("@/lib/api").PlatformReferenceCatalog | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publisherGrants, setPublisherGrants] = useState<string[]>([]);
  const [publisherProfileId, setPublisherProfileId] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [platformSearch, setPlatformSearch] = useState("");
  const [platformTag, setPlatformTag] = useState("");
  const [platformDomain, setPlatformDomain] = useState("");
  const [platformEntryType, setPlatformEntryType] = useState("");
  const activeTags = Array.from(new Set((activeCatalog?.resources ?? []).flatMap((resource) => resource.tags ?? []))).sort();
  const visibleActive = (activeCatalog?.resources ?? []).filter((resource) => {
    if (platformTag && !resource.tags?.includes(platformTag)) return false;
    if (platformDomain && resource.dictionary?.semantic_domain !== platformDomain) return false;
    if (platformEntryType && resource.dictionary?.entry_type !== platformEntryType) return false;
    const needle = platformSearch.trim().toLocaleLowerCase();
    return !needle || [resource.title, resource.summary ?? "", ...(resource.tags ?? [])].join(" ").toLocaleLowerCase().includes(needle);
  });
  const load = async () => {
    setLoading(true);
    try {
      setActiveCatalog(await api.getPlatformReferenceLibrary());
      const reviewer = await api.getPlatformReferenceReviewer();
      setCanReview(!!reviewer.authorized);
      setCatalog(reviewer.authorized ? await api.getPlatformReferenceReviewQueue() : null);
      setPublisherGrants(reviewer.authorized ? (await api.getPlatformPublisherGrants()).profile_ids : []);
    }
    catch { toast.error(t("reviewLoadFailed")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const promote = async (resource: import("@/lib/api").PlatformReferenceResource) => {
    setPublishing(resource.platform_resource_id);
    try {
      await api.promotePlatformReferenceResource(resource.platform_resource_id, resource.provenance.content_sha256);
      toast.success(t("reviewPromoted"));
      await load();
    } catch { toast.error(t("reviewPromoteFailed")); }
    finally { setPublishing(null); }
  };
  const changePublisherGrant = async (profileId: string, enabled: boolean) => {
    setGrantBusy(true);
    try {
      const result = await api.setPlatformPublisherGrant(profileId.trim(), enabled);
      setPublisherGrants(result.profile_ids);
      setPublisherProfileId("");
    } catch { toast.error("平台发布者授权失败，请核对账户身份"); }
    finally { setGrantBusy(false); }
  };
  return <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 md:px-7">
    <div className="mb-5">
      <div className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-text-muted">PLATFORM REFERENCE LIBRARY</div>
      <h1 className="text-2xl font-display font-semibold text-foreground mt-1">{t("reviewTitle")}</h1>
      <p className="text-sm text-text-secondary mt-1">{t("reviewDescription")}</p>
    </div>
    {loading ? <div className="py-12 text-text-secondary">{t("reviewLoading")}</div> : <>
      {canReview && <>
        <section className="mb-7 rounded-xl border border-glass-border bg-surface-inset p-4" aria-label="平台候选发布者">
          <h2 className="text-sm font-semibold text-foreground">平台候选发布者</h2>
          <p className="mt-1 text-xs text-text-muted">目标账户在创作台录入窗口可看到自己的账户身份。授权只允许提交候选，仍需管理员审核。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input aria-label="发布者账户身份" value={publisherProfileId} onChange={(event) => setPublisherProfileId(event.target.value)}
              placeholder="apikey-…" className="glass-input min-w-56 flex-1 px-3 py-2 text-xs" />
            <button type="button" disabled={grantBusy || !publisherProfileId.trim()} onClick={() => void changePublisherGrant(publisherProfileId, true)} className="glass-button px-3 py-2 text-xs disabled:opacity-50">授权提交候选</button>
          </div>
          {publisherGrants.map((profileId) => <div key={profileId} className="mt-2 flex items-center justify-between gap-3 text-xs text-text-secondary">
            <span className="min-w-0 break-all">{profileId}</span>
            <button type="button" disabled={grantBusy} onClick={() => void changePublisherGrant(profileId, false)} className="glass-button shrink-0 px-2 py-1 disabled:opacity-50">撤销</button>
          </div>)}
        </section>
        <h2 className="text-lg font-semibold text-foreground mb-3">{t("reviewPendingTitle")}</h2>
        {!catalog?.resources.length ? <div className="glass-panel rounded-xl p-5 text-text-secondary mb-7">{t("reviewEmpty")}</div> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {catalog.resources.map((resource) => <article key={resource.platform_resource_id} className="glass-panel rounded-xl border border-glass-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-semibold text-foreground">{resource.title}</h2><div className="text-xs text-text-muted mt-1">{resource.kind} · v{resource.revision} · {resource.status}</div></div>
            <span className="text-[0.625rem] rounded-full bg-amber-500/15 text-amber-700 px-2 py-1">{t("reviewPending")}</span>
          </div>
          {resource.summary && <p className="text-sm text-text-secondary mt-3">{resource.summary}</p>}
          {resource.category_path && <p className="mt-2 text-xs text-text-muted">类别：{resource.category_path}</p>}
          {resource.dictionary && <p className="mt-1 text-xs text-text-muted">词典：{resource.dictionary.semantic_domain} · {resource.dictionary.entry_type}</p>}
          {!!resource.dictionary?.members?.length && <ol className="mt-2 list-inside list-decimal text-xs text-text-muted" aria-label="组合成员固定引用">{resource.dictionary.members.map((member) => <li key={`${member.platform_resource_id}@${member.revision}`}>{member.role} · {member.platform_resource_id} · r{member.revision}</li>)}</ol>}
          {!!resource.payload && typeof resource.payload === "object" && <details className="mt-3 text-xs text-text-secondary">
            <summary>提示词与生成来源</summary>
            {typeof resource.payload.prompt_used === "string" && <div className="mt-2"><strong>模型原始提示词</strong><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{resource.payload.prompt_used}</pre></div>}
            {typeof resource.payload.structured_prompt === "object" && resource.payload.structured_prompt !== null && <div className="mt-2"><strong>用户编辑描述</strong><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{String((resource.payload.structured_prompt as { content?: unknown }).content ?? "")}</pre></div>}
            <div className="mt-2"><strong>完整生成记录</strong><pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(resource.payload, null, 2)}</pre></div>
          </details>}
          {!!resource.payload && typeof resource.payload === "object" && !!(resource.payload as { media_file?: string }).media_file && <PlatformCandidatePreview resourceId={resource.platform_resource_id} kind={resource.kind} />}
          {!!resource.tags?.length && <div className="flex flex-wrap gap-1 mt-3">{resource.tags.map((tag) => <span key={tag} className="text-xs rounded bg-surface-inset px-2 py-1 text-text-muted">{tag}</span>)}</div>}
          <dl className="mt-4 space-y-1 text-xs text-text-muted"><div><dt className="inline font-medium">{t("reviewSource")}：</dt> <dd className="inline">{resource.provenance.source || "—"}</dd></div><div><dt className="inline font-medium">{t("reviewLicense")}：</dt> <dd className="inline">{resource.provenance.license}</dd></div><div><dt className="inline font-medium">发布权声明：</dt> <dd className="inline">{resource.provenance.rights_confirmed ? "已确认，待审核" : "未提供"}</dd></div></dl>
          <button type="button" disabled={publishing === resource.platform_resource_id} onClick={() => void promote(resource)} className="mt-4 w-full glass-button font-semibold disabled:opacity-50">{publishing === resource.platform_resource_id ? t("reviewPublishing") : t("reviewPublish")}</button>
        </article>)}
        </div>}
      </>}
      <h2 className="text-lg font-semibold text-foreground mb-3">{t("publishedTitle")}</h2>
      {!!activeCatalog?.resources.length && <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="搜索平台参考" value={platformSearch} onChange={(event) => setPlatformSearch(event.target.value)} placeholder="搜索名称、描述或标签"
          className="glass-input min-w-48 flex-1 px-3 py-2 text-sm" />
        <select aria-label="筛选平台标签" value={platformTag} onChange={(event) => setPlatformTag(event.target.value)} className="glass-input px-3 py-2 text-sm">
          <option value="">全部标签</option>
          {activeTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <select aria-label="筛选词典领域" value={platformDomain} onChange={(event) => setPlatformDomain(event.target.value)} className="glass-input px-3 py-2 text-sm">
          <option value="">全部语义层</option>
          <option value="character.identity">身份</option><option value="character.look">造型</option>
          <option value="character.performance">表演</option><option value="world.style">风格</option>
        </select>
        <select aria-label="筛选词典类型" value={platformEntryType} onChange={(event) => setPlatformEntryType(event.target.value)} className="glass-input px-3 py-2 text-sm">
          <option value="">全部内容</option><option value="term">原子词条</option><option value="case">效果案例</option>
        </select>
      </div>}
      {!activeCatalog?.resources.length ? <div className="glass-panel rounded-xl p-8 text-text-secondary">{t("publishedEmpty")}</div> : !visibleActive.length ? <div className="glass-panel rounded-xl p-8 text-text-secondary">没有匹配的已发布资源</div> :
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleActive.map((resource) => <article key={resource.platform_resource_id} className="glass-panel rounded-xl border border-glass-border p-4">
          <h2 className="font-semibold text-foreground">{resource.title}</h2>
          <div className="text-xs text-text-muted mt-1">{resource.kind} · v{resource.revision}</div>
          {resource.dictionary && <div className="mt-1 text-xs text-text-muted">词典：{resource.dictionary.semantic_domain} · {resource.dictionary.entry_type}</div>}
          {!!resource.dictionary?.members?.length && <p className="mt-1 text-xs text-text-muted">固定成员 {resource.dictionary.members.length} 项</p>}
          {!!resource.payload?.media_file && <PlatformCandidatePreview resourceId={resource.platform_resource_id} kind={resource.kind} />}
          {(resource.payload?.structured_prompt?.content || resource.summary) && <details className="mt-3 text-sm text-text-secondary">
            <summary>查看配套 Prompt</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{resource.payload?.structured_prompt?.content || resource.summary}</pre>
          </details>}
          {!!resource.tags?.length && <div className="flex flex-wrap gap-1 mt-3">{resource.tags.map((tag) => <span key={tag} className="text-xs rounded bg-surface-inset px-2 py-1 text-text-muted">{tag}</span>)}</div>}
          <div className="mt-4 text-xs text-text-muted">{t("reviewSource")}：{resource.provenance.source || "—"} · {t("reviewLicense")}：{resource.provenance.license}</div>
        </article>)}
      </div>}
    </>}
  </div>;
}

function SemanticAssetLibrary() {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const updateProject = useProjectStore((state) => state.updateProject);
  const [sources, setSources] = useState<AssetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<TypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sortOpen, setSortOpen] = useState(false);
  const [viewAxis, setViewAxis] = useState<ViewAxis>("source");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [selected, setSelected] = useState<{ sourceId: string; assetId: string; type: AssetTab } | null>(null);
  const [newAssetOpen, setNewAssetOpen] = useState(false);

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const index = await api.getAssetLibraryIndex();
      const grouped = new Map<string, AssetSource>();
      const toAsset = (entry: AssetReferenceIndexEntry): Character | Scene | Prop => {
        const variants = entry.variants || [];
        const imageAsset = { selected_id: entry.selected_variant_id || variants[0]?.id, variants };
        const coverVariantId = entry.cover_variant_id || imageAsset.selected_id;
        if (entry.asset_type === "character") {
          return { id: entry.asset_id, name: entry.name, description: entry.description, starred: entry.starred, cover_variant_id: coverVariantId, reference_sheet: { selected_image_id: imageAsset.selected_id, image_variants: variants } } as Character;
        }
        return { id: entry.asset_id, name: entry.name, description: entry.description, starred: entry.starred, cover_variant_id: coverVariantId, image_asset: imageAsset } as Scene | Prop;
      };
      for (const entry of index.assets) {
        // Crowd entries are metadata-first roster records. They are consumed
        // by Cast/Storyboard pickers and are not image-library assets; keep
        // them out of this three-type renderer instead of indexing
        // `source.crowds` (which would crash the library at runtime).
        if (entry.asset_type === "crowd") continue;
        const key = entry.source_scope === "global" ? "global" : `${entry.source_scope}-${entry.source_container_id}`;
        const kind = entry.source_scope === "global" ? "global" : entry.source_scope === "series" ? "series" : "project";
        const source = grouped.get(key) || { id: key, rawId: entry.source_container_id || "global", name: entry.source_name || t("globalGroup"), kind, characters: [], scenes: [], props: [] };
        const asset = toAsset(entry);
        source[`${entry.asset_type}s` as "characters" | "scenes" | "props"].push(asset as never);
        grouped.set(key, source);
      }
      setSources(Array.from(grouped.values()));
    } catch (error) {
      console.error("Failed to load asset library:", error);
      toast.error(t("loadFailed"), { body: t("loadFailedBody") });
    } finally {
      setLoading(false);
    }
  };

  const updateCoverSelection = (sourceId: string, type: AssetTab, result: AssetCoverSelectionResult) => {
    const returnedVariant = result.variant as ImageVariant;
    setSources((current) => current.map((source) => {
      if (source.id !== sourceId) return source;
      const withCover = (asset: Character | Scene | Prop) => {
        if (asset.id !== result.asset_id) return asset;
        if (type === "characters") {
          const character = asset as Character;
          const sheet = character.reference_sheet ?? { selected_image_id: null, image_variants: [] };
          const variants = sheet.image_variants.some((variant) => variant.id === returnedVariant.id)
            ? sheet.image_variants
            : [...sheet.image_variants, returnedVariant];
          return { ...character, cover_variant_id: result.cover_variant_id, reference_sheet: { ...sheet, image_variants: variants } };
        }
        const target = asset as Scene | Prop;
        const imageAsset = target.image_asset ?? { selected_id: null, variants: [] };
        const variants = imageAsset.variants.some((variant) => variant.id === returnedVariant.id)
          ? imageAsset.variants
          : [...imageAsset.variants, returnedVariant];
        return { ...target, cover_variant_id: result.cover_variant_id, image_asset: { ...imageAsset, variants } };
      };
      if (type === "characters") return { ...source, characters: source.characters.map(withCover) as Character[] };
      if (type === "scenes") return { ...source, scenes: source.scenes.map(withCover) as Scene[] };
      return { ...source, props: source.props.map(withCover) as Prop[] };
    }));
  };

  const [deleting, setDeleting] = useState<string | null>(null);
  const deleteAsset = async (assetId: string, type: AssetTab) => {
    if (deleting) return;
    setDeleting(assetId);
    try {
      await api.deleteLibraryAsset(SINGULAR[type], assetId);
      setSelected((current) => current?.assetId === assetId ? null : current);
      await loadAssets();
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      toast.error(status === 409 ? t("deleteInUse") : t("deleteFailed"));
    } finally { setDeleting(null); }
  };

  const renameAsset = async (source: AssetSource, type: AssetTab, assetId: string, name: string) => {
    const assetType = SINGULAR[type];
    if (source.kind === "global") {
      await api.updateLibraryAsset(assetType, assetId, { name });
    } else if (source.kind === "series") {
      await api.updateSeriesAssetAttributes(source.rawId, assetId, assetType, { name });
    } else {
      const updatedProject = await api.updateAssetAttributes(source.rawId, assetId, assetType, { name });
      updateProject(source.rawId, updatedProject);
    }
    await loadAssets();
  };

  // 全局计数（facet 总览；不受搜索/星标过滤影响，与分组标题里的计数互补）。
  const counts = useMemo(() => {
    let ch = 0,
      sc = 0,
      pr = 0,
      st = 0;
    for (const s of sources) {
      ch += s.characters.length;
      sc += s.scenes.length;
      pr += s.props.length;
      st +=
        s.characters.filter((a) => a.starred).length +
        s.scenes.filter((a) => a.starred).length +
        s.props.filter((a) => a.starred).length;
    }
    return { characters: ch, scenes: sc, props: pr, all: ch + sc + pr, starred: st };
  }, [sources]);

  const typePills: { id: TypeFilter; label: string; count: number }[] = [
    { id: "all", label: t("allLabel"), count: counts.all },
    { id: "characters", label: t("characterLabel"), count: counts.characters },
    { id: "scenes", label: t("sceneLabel"), count: counts.scenes },
    { id: "props", label: t("propLabel"), count: counts.props },
  ];

  const TYPE_LABEL: Record<AssetTab, string> = {
    characters: t("characterLabel"),
    scenes: t("sceneLabel"),
    props: t("propLabel"),
  };

  // 排序选项（usage 禁用：需后端使用频次统计）+ 触发按钮当前态文案。
  const sortOptions: { id: SortMode; label: string; disabled?: boolean }[] = [
    { id: "default", label: t("sortDefault") },
    { id: "name", label: t("sortName") },
    { id: "recent", label: t("sortRecent") },
    { id: "usage", label: t("sortUsage"), disabled: true },
  ];
  const sortLabelMap: Record<SortMode, string> = {
    default: t("sortDefault"),
    name: t("sortName"),
    recent: t("sortRecent"),
    usage: t("sortUsage"),
  };

  // 渲染模型：两种轴。
  //  - "type"（默认）：按资产类型分 3 组（角色/场景/道具），每组含所有 source 的该类型资产，
  //    卡片副标题显示所属 source 名。
  //  - "source"：按 source 分组（系列/项目/全局），保持原行为。
  // 两者都受 activeType pill + 搜索 + 星标过滤，并按 sortMode 排序。
  const groups = useMemo<RenderGroup[]>(() => {
    const scopedTypes: AssetTab[] = activeType === "all" ? ["characters", "scenes", "props"] : [activeType];
    const q = searchQuery.trim().toLowerCase();
    const match = (a: Character | Scene | Prop) =>
      (!starredOnly || !!a.starred) &&
      (!q || a.name.toLowerCase().includes(q) || (a.description?.toLowerCase().includes(q) ?? false));
    const sortItems = (items: RenderItem[]) => {
      if (sortMode === "name") items.sort((x, y) => x.asset.name.localeCompare(y.asset.name, "zh"));
      else if (sortMode === "recent") items.sort((x, y) => recencyOf(y.asset, y.type) - recencyOf(x.asset, x.type));
      // "default" / "usage"（禁用）：保持插入顺序。
      return items;
    };
    const typeLabel = (ty: AssetTab) =>
      ty === "characters" ? t("characterLabel") : ty === "scenes" ? t("sceneLabel") : t("propLabel");

    if (viewAxis === "type") {
      return scopedTypes
        .map((ty): RenderGroup => {
          const items: RenderItem[] = [];
          for (const src of sources)
            for (const a of src[ty] as (Character | Scene | Prop)[]) if (match(a)) items.push({ asset: a, type: ty, src });
          sortItems(items);
          return { key: `type-${ty}`, title: typeLabel(ty), meta: String(items.length), items };
        })
        .filter((grp) => grp.items.length > 0);
    }

    const kindLabel = (k: AssetSource["kind"]) =>
      k === "series" ? t("series") : k === "global" ? t("globalGroup") : t("project");
    return sources
      .map((src): RenderGroup => {
        const items: RenderItem[] = [];
        for (const ty of scopedTypes)
          for (const a of src[ty] as (Character | Scene | Prop)[]) if (match(a)) items.push({ asset: a, type: ty, src });
        sortItems(items);
        return { key: src.id, title: src.name, meta: `${kindLabel(src.kind)} · ${items.length}`, items };
      })
      .filter((grp) => grp.items.length > 0);
  }, [sources, activeType, searchQuery, starredOnly, sortMode, viewAxis, t]);

  const visibleCount = groups.reduce((acc, g) => acc + g.items.length, 0);
  const openSource = sources.find((source) => source.id === openSourceId);
  const displayedGroups = viewAxis === "source" && openSourceId
    ? groups.filter((group) => group.key === openSourceId)
    : groups;

  useEffect(() => {
    if (openSourceId && !sources.some((source) => source.id === openSourceId)) setOpenSourceId(null);
  }, [openSourceId, sources]);

  // 选中的资产被筛掉后自动关 inspector（避免残留指向已隐藏资产）。
  useEffect(() => {
    if (!selected) return;
    const stillVisible = displayedGroups.some((grp) =>
      grp.items.some(
        (it) => it.src.id === selected.sourceId && it.asset.id === selected.assetId && it.type === selected.type
      )
    );
    if (!stillVisible) setSelected(null);
  }, [displayedGroups, selected]);

  const toggleStar = async (sourceId: string, assetId: string, type: AssetTab) => {
    const src = sources.find((s) => s.id === sourceId);
    if (!src) return;
    const cur = (src[type] as (Character | Scene | Prop)[]).find((a) => a.id === assetId);
    const prevStarred = !!cur?.starred;
    const setStarredTo = (val: boolean) => (prev: AssetSource[]) =>
      prev.map((s) =>
        s.id !== sourceId
          ? s
          : { ...s, [type]: (s[type] as (Character | Scene | Prop)[]).map((a) => (a.id === assetId ? { ...a, starred: val } : a)) }
      );
    setSources(setStarredTo(!prevStarred)); // 乐观更新
    try {
      if (src.kind === "series") await api.toggleSeriesAssetStarred(src.rawId, assetId, SINGULAR[type]);
      else if (src.kind === "global") await api.updateLibraryAsset(SINGULAR[type], assetId, { starred: !prevStarred });
      else await api.toggleAssetStarred(src.rawId, assetId, SINGULAR[type]);
    } catch (e) {
      console.error("toggle star failed", e);
      setSources(setStarredTo(prevStarred)); // 失败:精确还原到原值（不靠再翻一次，避免并发下双翻 desync）
    }
  };

  // 选中资产的实时引用（以 sources 为单一数据源，保证星标等变更同步到 inspector）。
  const selectedSource = selected ? sources.find((s) => s.id === selected.sourceId) : undefined;
  const selectedAsset =
    selected && selectedSource
      ? (selectedSource[selected.type] as (Character | Scene | Prop)[]).find((a) => a.id === selected.assetId)
      : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <header className="px-4 md:px-7 pt-5 md:pt-6 pb-3 flex items-end gap-5">
        <div className="flex-1 min-w-0">
          {viewAxis === "source" && openSource && <button type="button" onClick={() => { setOpenSourceId(null); setSelected(null); }}
            className="mb-2 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft size={16} /> {t("allFolders")}
          </button>}
          <div className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.2em] text-text-muted">
            ASSET LIBRARY · <span className="text-primary font-semibold">{t("gallery") || "画廊"}</span>
          </div>
          <h1 className="text-[1.625rem] md:text-[2.125rem] font-display atelier-display font-semibold text-foreground leading-tight tracking-tight mt-1">
            {openSource && viewAxis === "source" ? openSource.name : t("title")}
          </h1>
        </div>
        <div className="flex items-center gap-2.5 pb-1">
          <span className="font-mono text-[0.6875rem] text-text-muted tracking-[0.1em] uppercase">
            {t("assetCount", { count: visibleCount })}
          </span>
          <button
            type="button"
            onClick={() => setNewAssetOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-on-accent text-[0.875rem] font-semibold hover:bg-primary-hover transition-colors"
          >
            <Plus size={14} />
            {t("newAsset")}
          </button>
        </div>
      </header>

      {/* Toolbar: 视图切换 + 类型 pills（带计数）+ ★ + 搜索 + 排序 */}
      <div className="px-4 md:px-7 pb-2 flex flex-wrap items-center gap-3">
        {/* 视图切换：按类型 ↔ 按项目 */}
        <div
          className="inline-flex p-[3px] rounded-full bg-surface-inset atelier-pill-tabs"
          role="group"
          aria-label={t("viewLabel")}
        >
          {([
            { id: "type", label: t("viewByType") },
            { id: "source", label: t("viewByProject") },
          ] as { id: ViewAxis; label: string }[]).map((v) => {
            const on = viewAxis === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                onClick={() => { setViewAxis(v.id); setOpenSourceId(null); setSelected(null); }}
                className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold transition-colors ${
                  on ? "text-foreground atelier-pill-tab-active bg-surface shadow-sm" : "text-text-muted hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <div className="inline-flex p-[3px] rounded-full bg-surface-inset atelier-pill-tabs" role="tablist" aria-label={t("assetTypeAria")} onKeyDown={rovingKeyDown}>
          {typePills.map((pill) => {
            const on = activeType === pill.id;
            return (
              <button
                key={pill.id}
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setActiveType(pill.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold transition-colors ${
                  on ? "text-foreground atelier-pill-tab-active bg-surface shadow-sm" : "text-text-muted hover:text-foreground"
                }`}
              >
                {pill.label}
                <span className={`font-mono text-[0.59375rem] ${on ? "text-text-secondary" : "text-text-muted"}`}>{pill.count}</span>
              </button>
            );
          })}
        </div>

        {/* ★ 加星过滤 */}
        <button
          type="button"
          aria-pressed={starredOnly}
          aria-label={t("starredOnlyAria")}
          onClick={() => setStarredOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-colors ${
            starredOnly
              ? "text-status-starred-fg bg-status-starred-bg border-status-starred-border"
              : "text-text-muted border-glass-border hover:text-foreground"
          }`}
        >
          <Star size={12} className={starredOnly ? "fill-current" : ""} />
          {counts.starred}
        </button>

        <div className="relative flex-1 min-w-[200px] max-w-[340px] bg-surface-inset border border-glass-border rounded-full atelier-search-input">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="w-full bg-transparent border-0 rounded-full py-2 pl-9 pr-4 text-[0.8125rem] text-foreground placeholder-text-muted focus:outline-none"
          />
        </div>

        {/* 排序下拉：默认 / 名称 / 最近（真实）/ 使用频次（禁用，需后端） */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            aria-label={t("sortLabel")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.6875rem] font-medium text-text-muted border border-glass-border hover:text-foreground transition-colors"
          >
            <ArrowDownUp size={12} />
            {sortLabelMap[sortMode]}
            <ChevronDown size={12} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`} />
          </button>
          {sortOpen && (
            <>
              {/* 点外关闭遮罩 */}
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setSortOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="listbox"
                aria-label={t("sortLabel")}
                className="absolute right-0 top-full mt-1.5 z-50 min-w-[180px] glass-panel border border-glass-border rounded-xl p-1.5 shadow-xl"
              >
                {sortOptions.map((opt) => {
                  const on = sortMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      disabled={opt.disabled}
                      title={opt.disabled ? t("sortUsageHint") : undefined}
                      onClick={() => {
                        if (opt.disabled) return;
                        setSortMode(opt.id);
                        setSortOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-[0.75rem] font-medium text-left transition-colors ${
                        opt.disabled
                          ? "text-text-muted opacity-60 cursor-not-allowed"
                          : on
                            ? "text-primary bg-surface-inset"
                            : "text-text-secondary hover:text-foreground hover:bg-surface-inset"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {opt.label}
                        {opt.disabled && (
                          <span className="font-mono text-[0.53125rem] uppercase tracking-[0.06em] text-text-muted px-1.5 py-0.5 rounded-full bg-surface-inset border border-glass-border">
                            {t("sortUsageHint")}
                          </span>
                        )}
                      </span>
                      {on && !opt.disabled && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body: 网格（按系列分组）+ 右侧 inspector */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-3">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-text-secondary text-[0.8125rem]">{tc("loading")}</div>
            </div>
          ) : counts.all === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="glass-panel atelier-card p-10 rounded-2xl border border-glass-border text-center max-w-[620px] w-full relative overflow-hidden">
                <div className="relative z-[1] flex flex-col items-center gap-4">
                  <div className="font-mono text-[0.625rem] uppercase tracking-[0.22em] text-text-muted">
                    CAST · SCENES · PROPS
                  </div>
                  <p className="text-[2.125rem] font-display atelier-display font-medium italic leading-[1.25] tracking-tight text-foreground">
                    {t("emptyQuote")}
                  </p>
                  <p className="text-[0.9375rem] text-text-secondary max-w-[440px]">{t("noAssetsHint")}</p>
                </div>
              </div>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted">
              <Search size={48} className="mb-3 opacity-60" />
              <p className="text-[0.9375rem] font-display atelier-display text-foreground">{t("noMatchTitle")}</p>
              <p className="text-[0.75rem] text-text-muted mt-1">{tc("noMatchHint")}</p>
              <button
                type="button"
                onClick={() => { setActiveType("all"); setSearchQuery(""); setStarredOnly(false); }}
                className="mt-4 glass-button text-[0.8125rem] font-semibold"
              >
                {tc("clearFilters")}
              </button>
            </div>
          ) : viewAxis === "source" && !openSourceId ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {groups.map((group) => <button key={group.key} type="button"
                onClick={() => { setOpenSourceId(group.key); setSelected(null); }}
                className="flex min-h-24 items-center gap-4 rounded-md border border-glass-border bg-surface-inset p-4 text-left hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <Folder size={26} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{group.title}</span>
                  <span className="block text-xs text-text-muted">{group.meta}</span>
                </span>
                <ChevronDown size={16} className="-rotate-90 text-text-muted" aria-hidden="true" />
              </button>)}
            </div>
          ) : (
            <div className="space-y-6">
              {displayedGroups.map((grp) => (
                <div key={grp.key}>
                  {/* 分组标题 + 尾线 + 计数 */}
                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="text-[1.5rem] font-display atelier-display font-semibold text-foreground tracking-tight">{grp.title}</span>
                    <span className="font-mono text-[0.625rem] text-text-muted tracking-wide uppercase">{grp.meta}</span>
                    <span className="atelier-group-line flex-1 h-px bg-border-subtle" />
                  </div>

                  {/* 卡片网格（库专用富卡片） */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {grp.items.map(({ asset, type, src }, i) => {
                      const url = getImageUrl(asset, type);
                      const vc = variantCount(asset, type);
                      const isSel = selected?.sourceId === src.id && selected?.assetId === asset.id && selected?.type === type;
                      const isStar = !!asset.starred;
                      const isChar = type === "characters";
                      return (
                        <div
                          key={`${src.id}-${type}-${asset.id}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelected({ sourceId: src.id, assetId: asset.id, type })}
                          onKeyDown={(e) => {
                            // 仅当卡片自身获得焦点时才响应；避免嵌套的 star <button> 在 Enter/Space 时双触发
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected({ sourceId: src.id, assetId: asset.id, type });
                            }
                          }}
                          aria-current={isSel ? "true" : undefined}
                          className={`atelier-asset-card atelier-reveal group relative text-left rounded-xl overflow-hidden border transition-all cursor-pointer ${
                            isSel ? "border-primary/60 ring-1 ring-primary/40" : "border-glass-border hover:-translate-y-1"
                          }`}
                          style={{ animationDelay: `${Math.min(i * 50, 250)}ms` }}
                        >
                          <div className={`${isChar ? "aspect-[4/3]" : "aspect-square"} bg-surface-inset overflow-hidden relative`}>
                            {url ? (
                              <AssetCover asset={asset} type={type} source={src} url={url} />
                            ) : (
                              // 无图：atelier 文字/渐变封面（取代发灰占位图标）— 确定性渐变 + 颗粒 + 首字母
                              <div
                                className="absolute inset-0 grid place-items-center overflow-hidden"
                                style={{ background: coverGradient(asset.id || asset.name) }}
                                aria-hidden="true"
                              >
                                <div
                                  className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-50"
                                  style={{ backgroundImage: GRAIN_URL }}
                                />
                                <span className="relative font-display atelier-display font-semibold leading-none select-none text-foreground/90 text-[clamp(1.75rem,4.5vw,2.75rem)]">
                                  {(Array.from(asset.name.trim())[0] || "?").toUpperCase()}
                                </span>
                              </div>
                            )}
                            {isStar && (
                              <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_44px_-8px_var(--color-status-starred-bg)]" aria-hidden="true" />
                            )}
                            {/* top row: star chip + variant chip */}
                            <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                              <button
                                type="button"
                                aria-label={isStar ? t("unstar") : t("star")}
                                aria-pressed={isStar}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleStar(src.id, asset.id, type);
                                }}
                                onKeyDown={(e) => e.stopPropagation()}
                                className={`w-7 h-7 rounded-full grid place-items-center backdrop-blur-md transition-colors cursor-pointer ${
                                  isStar ? "text-status-starred-fg bg-status-starred-bg" : "text-white bg-black/45 hover:text-status-starred-fg"
                                }`}
                              >
                                <Star size={13} className={isStar ? "fill-current" : ""} />
                              </button>
                              {vc > 0 && (
                                <span className="px-2 py-[3px] rounded-full font-mono text-[0.5625rem] font-semibold text-white bg-black/55 backdrop-blur-md tracking-wide">
                                  {t("variantCount", { count: vc })}
                                </span>
                              )}
                            </div>
                            {/* kind chip（仅「按项目」视图 + 「全部」类型下显示，告知卡片类型） */}
                            {viewAxis === "source" && activeType === "all" && (
                              <span className="absolute bottom-2 left-2 px-2 py-[3px] rounded-full font-mono text-[0.53125rem] font-semibold uppercase tracking-[0.06em] text-white bg-black/55 backdrop-blur-md">
                                {TYPE_LABEL[type]}
                              </span>
                            )}
                          </div>
                          <div className="p-3">
                            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                              <AssetNameEditor key={`${src.id}-${asset.id}`} name={asset.name}
                                onRename={(name) => renameAsset(src, type, asset.id, name)}
                                className="text-sm font-medium text-foreground" />
                            </div>
                            {viewAxis === "type" || src.kind === "global" ? (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[0.6875rem] text-text-muted truncate">{src.name}</span>
                                {src.kind === "global" && <button type="button" aria-label={t("deleteNamed", { name: asset.name })}
                                  disabled={deleting !== null} onClick={(event) => { event.stopPropagation(); void deleteAsset(asset.id, type); }}
                                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-muted hover:text-status-failed-fg hover:bg-hover-bg disabled:opacity-40">
                                  <Trash2 size={14} />
                                </button>}
                              </div>
                            ) : (
                              asset.description && <div className="text-[0.6875rem] text-text-muted truncate mt-0.5">{asset.description}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧 inspector（选中才出现） */}
        {selected && selectedAsset && selectedSource && (
          <AssetInspector
            asset={selectedAsset}
            type={selected.type}
            sourceName={selectedSource.name}
            sourceId={selected.sourceId}
            sourceKind={selectedSource.kind}
            starred={!!selectedAsset.starred}
            onClose={() => setSelected(null)}
            onToggleStar={() => toggleStar(selected.sourceId, selected.assetId, selected.type)}
            onCoverUpdated={(result) => updateCoverSelection(selected.sourceId, selected.type, result)}
            onPromoted={loadAssets}
            onRevisionUpdated={loadAssets}
            onRename={(name) => renameAsset(selectedSource, selected.type, selected.assetId, name)}
          />
        )}
      </div>

      {/* 新建全局资产弹窗（T6-entries） */}
      {newAssetOpen && (
        <NewLibraryAssetDialog onClose={() => setNewAssetOpen(false)} onCreated={loadAssets} />
      )}
    </div>
  );
}
