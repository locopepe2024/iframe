"use client";

import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Plus, Upload, Image as ImageIcon } from "lucide-react";
import { api, type PlatformReferenceResource } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { toast } from "@/store/toastStore";

type AssetTab = "characters" | "scenes" | "props";

// 资产类型 → 后端单数 type（/library/assets 端点用）。
const SINGULAR: Record<AssetTab, string> = { characters: "character", scenes: "scene", props: "prop" };
function dictionaryDomain(category: string) {
  if (category.startsWith("character/identity/")) return "character.identity";
  if (category.startsWith("character/look/")) return "character.look";
  if (category === "character/performance") return "character.performance";
  if (category === "character/style") return "world.style";
  return "";
}

interface NewLibraryAssetDialogProps {
  onClose: () => void;
  /** 创建成功后回调（父层刷新库以显示新资产）。 */
  onCreated: () => void;
  /** Optional existing material to register as the first asset variant. */
  initialImageUrl?: string;
  initialName?: string;
  initialDescription?: string;
  initialMediaType?: "image" | "video";
  initialImageOrigin?: "upload" | "workbench";
  initialSourceGenerationId?: string;
  initialSourceOutputId?: string;
}

interface ImportedVariant {
  image_url: string;
  reference_view_role: string;
  reference_distance: string;
}

/**
 * 资产库「新建全局资产」轻量弹窗（T6-entries）。
 * 选类型(角色/场景/道具) + 名称 + 描述 +（可选）图片（上传本地文件或填 URL）→ POST /library/assets。
 * 本地上传走 POST /library/assets/upload（multipart 字段 "file" → { image_url }），结果写入 imageUrl。
 */
export default function NewLibraryAssetDialog({ onClose, onCreated, initialImageUrl = "", initialName = "", initialDescription = "", initialMediaType = "image", initialImageOrigin, initialSourceGenerationId, initialSourceOutputId }: NewLibraryAssetDialogProps) {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const [assetType, setAssetType] = useState<AssetTab>("characters");
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [targetScope, setTargetScope] = useState<"asset" | "platform">(initialMediaType === "video" ? "platform" : "asset");
  const [platformKind, setPlatformKind] = useState<"image" | "video" | "prompt_preset">(initialMediaType);
  const [platformCategory, setPlatformCategory] = useState("character/reference");
  const [dictionaryEntryType, setDictionaryEntryType] = useState<"" | "term" | "pattern" | "case">("");
  const [dictionaryTerms, setDictionaryTerms] = useState<PlatformReferenceResource[]>([]);
  const [dictionaryMembers, setDictionaryMembers] = useState<PlatformReferenceResource[]>([]);
  const [dictionaryLoadError, setDictionaryLoadError] = useState("");
  const [platformCategories, setPlatformCategories] = useState<{ id: string; label: string }[]>([]);
  const [platformSuggestedTags, setPlatformSuggestedTags] = useState<string[]>([]);
  const [platformTagsText, setPlatformTagsText] = useState("");
  const [platformError, setPlatformError] = useState("");
  const [publisher, setPublisher] = useState<{ profile_id: string; authorized: boolean } | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageOrigin, setImageOrigin] = useState<"upload" | "workbench" | undefined>(initialImageOrigin);
  const [initialVariants, setInitialVariants] = useState<ImportedVariant[]>([]);

  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!initialSourceGenerationId) return;
    let active = true;
    void api.getPlatformPublisher().then((result) => { if (active) setPublisher(result); }).catch(() => { if (active) setPlatformError("无法读取平台录入权限，请刷新后重试。"); });
    void api.getPlatformReferenceCategories().then((result) => {
      if (!active) return;
      setPlatformCategories(result.categories);
      setPlatformSuggestedTags(result.suggested_tags ?? []);
      setPlatformCategory((current) => result.categories.some((item) => item.id === current) ? current : result.categories[0]?.id ?? "");
      if (!result.categories.length) setPlatformError("平台类别暂不可用，请联系管理员。");
    }).catch(() => { if (active) setPlatformError("无法读取平台类别，请刷新后重试。"); });
    return () => { active = false; };
  }, [initialSourceGenerationId]);
  useEffect(() => {
    if (targetScope !== "platform" || dictionaryEntryType !== "pattern") return;
    let active = true;
    setDictionaryLoadError("");
    void api.getPlatformReferenceLibrary().then((catalog) => {
      if (active) setDictionaryTerms(catalog.resources.filter((resource) =>
        resource.status === "active" && resource.dictionary?.entry_type === "term" && resource.kind === "prompt_preset"
        && !!resource.payload?.structured_prompt?.content?.trim()
      ));
    }).catch(() => { if (active) setDictionaryLoadError("平台词条读取失败，请重试打开组合方案。"); });
    return () => { active = false; };
  }, [targetScope, dictionaryEntryType]);
  // a11y：打开时聚焦名称、Escape 关闭、关闭后还原焦点。
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    nameRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevFocused?.focus?.();
    };
  }, []);

  const typeOptions: { id: AssetTab; label: string }[] = [
    { id: "characters", label: t("characterLabel") },
    { id: "scenes", label: t("sceneLabel") },
    { id: "props", label: t("propLabel") },
  ];

  // 上传本地图片 → 后端返回 image_url，写入 imageUrl 作为创建用图。
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // reset so re-selecting the same file fires onChange again
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.slice(0, 8).map(async (file, index) => {
        const { image_url } = await api.uploadLibraryImage(file);
        return { image_url, reference_view_role: index === 0 ? "front" : "additional", reference_distance: index === 0 ? "full" : "medium" };
      }));
      setInitialVariants((current) => [...current, ...uploaded].slice(0, 8));
      if (!imageUrl && uploaded[0]) { setImageUrl(uploaded[0].image_url); setImageOrigin("upload"); }
      toast.success(t("uploadSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(t("uploadFailed"), msg ? { body: msg } : undefined);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || uploading) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("nameRequired"));
      nameRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      if (targetScope === "platform") {
        if (!publisher?.authorized || !initialSourceGenerationId || !platformCategory || !rightsConfirmed) {
          throw new Error("请先确认平台录入权限、类别和内容发布权。");
        }
        const tags = Array.from(new Set(platformTagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)));
        if (tags.length > 12 || tags.some((tag) => tag.length > 32)) {
          throw new Error("最多填写 12 个标签，每个不超过 32 字。");
        }
        if (dictionaryEntryType === "pattern" && (dictionaryMembers.length < 2 || dictionaryMembers.length > 12)) {
          throw new Error("组合方案须选择 2–12 个同领域已发布词条。");
        }
        if (dictionaryEntryType === "term" && (description.trim().length > 500 || description.includes("\n"))) {
          throw new Error("原子描述词须是单行、最多 500 字；完整 Prompt 请发布为普通参考。");
        }
        await api.submitPlatformCandidate({
          source_generation_id: initialSourceGenerationId,
          source_output_id: platformKind === "prompt_preset" ? undefined : initialSourceOutputId,
          kind: platformKind,
          category_path: platformCategory,
          ...(dictionaryEntryType ? { dictionary_entry_type: dictionaryEntryType } : {}),
          ...(dictionaryEntryType === "pattern" ? { dictionary_members: dictionaryMembers.map((resource, index) => ({
            platform_resource_id: resource.platform_resource_id, revision: resource.revision, role: `part_${index + 1}`,
          })) } : {}),
          tags,
          title: trimmed,
          description: description.trim(),
          rights_confirmed: rightsConfirmed,
        });
        toast.success("已提交平台参考库审核", { body: trimmed });
        onCreated();
        onClose();
        return;
      }
      const payload = {
        name: trimmed,
        description: description.trim() || undefined,
        image_url: initialVariants.length ? undefined : imageUrl.trim() || undefined,
        image_origin: initialVariants.length ? undefined : imageUrl.trim() ? imageOrigin : undefined,
        source_generation_id: initialVariants.length ? undefined : imageOrigin === "workbench" ? initialSourceGenerationId : undefined,
        source_output_id: initialVariants.length ? undefined : imageOrigin === "workbench" ? initialSourceOutputId : undefined,
        ...(initialVariants.length ? { initial_variants: initialVariants } : {}),
      };
      await api.createLibraryAsset(SINGULAR[assetType], payload);
      toast.success(t("createSuccess"), { body: trimmed });
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("createFailed");
      toast.error(t("createFailed"), { body: msg });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={(event) => event.stopPropagation()}>
      {/* 点外关闭遮罩 */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initialSourceGenerationId ? "录入生成结果" : t("newAssetTitle")}
        className="relative z-[1] w-full max-w-[440px] glass-panel border border-glass-border rounded-2xl shadow-2xl atelier-reveal overflow-hidden"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-glass-border">
          <div>
            <div className="font-display atelier-display text-lg font-semibold text-foreground tracking-tight">
              {initialSourceGenerationId ? "录入生成结果" : t("newAssetTitle")}
            </div>
            <div className="text-[0.75rem] text-text-muted mt-0.5">{targetScope === "platform" ? "提交平台参考库审核；审核发布后所有用户可检索。" : initialSourceGenerationId ? "保存到当前账户的跨项目资产库。" : t("newAssetSubtitle")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            className="w-8 h-8 rounded-full grid place-items-center text-text-muted hover:text-foreground hover:bg-surface-inset transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          {initialSourceGenerationId && <div>
            <label htmlFor="library-target-scope" className="font-mono text-[0.625rem] font-semibold uppercase text-text-secondary">录入目标</label>
            <select id="library-target-scope" value={targetScope} onChange={(event) => setTargetScope(event.target.value as "asset" | "platform")}
              className="mt-2 w-full rounded-lg border border-glass-border bg-surface-inset px-3 py-2 text-sm text-foreground">
              {initialMediaType === "image" && <option value="asset">当前账户跨项目资产库</option>}
              <option value="platform" disabled={!publisher?.authorized}>平台参考库 · 提交审核</option>
            </select>
            {publisher && !publisher.authorized && <p className="mt-2 break-all text-xs text-text-muted">当前账户无平台录入权限。账户身份：{publisher.profile_id}</p>}
            {platformError && <p role="alert" className="mt-2 text-xs text-red-400">{platformError}</p>}
          </div>}
          {/* 类型选择 */}
          {targetScope === "asset" && <div>
            <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary">
              {t("assetTypeAria")}
            </span>
            <div
              className="mt-2 inline-flex p-[3px] rounded-full bg-surface-inset atelier-pill-tabs"
              role="group"
              aria-label={t("assetTypeAria")}
            >
              {typeOptions.map((opt) => {
                const on = assetType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAssetType(opt.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold transition-colors ${
                      on
                        ? "text-foreground atelier-pill-tab-active bg-surface shadow-sm"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>}

          {targetScope === "platform" && <div className="grid gap-3">
            <label className="text-xs text-text-secondary">平台类别
              <select aria-label="平台类别" value={platformCategory} onChange={(event) => { setPlatformCategory(event.target.value); setDictionaryEntryType(""); setDictionaryMembers([]); }}
                className="mt-2 w-full rounded-lg border border-glass-border bg-surface-inset px-3 py-2 text-sm text-foreground">
                {platformCategories.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
              </select>
            </label>
            <div>
              <label htmlFor="platform-character-tags" className="text-xs text-text-secondary">角色标签</label>
              <input id="platform-character-tags" value={platformTagsText} onChange={(event) => setPlatformTagsText(event.target.value)}
                placeholder="如：角色设定稿，转面三视图，配色卡" className="mt-2 w-full rounded-lg border border-glass-border bg-surface-inset px-3 py-2 text-sm text-foreground" />
              <p className="mt-1 text-xs text-text-muted">逗号分隔，最多 12 个；仅用于检索，不会加入生成提示词。</p>
              {!!platformSuggestedTags.length && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="建议角色标签">
                {platformSuggestedTags.map((tag) => {
                  const selected = platformTagsText.split(/[,，]/).some((value) => value.trim() === tag);
                  return <button key={tag} type="button" aria-pressed={selected} onClick={() => {
                    const current = platformTagsText.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
                    setPlatformTagsText((selected ? current.filter((value) => value !== tag) : [...current, tag]).join("，"));
                  }} className={`rounded-full border px-2 py-1 text-xs ${selected ? "border-primary text-primary" : "border-glass-border text-text-secondary hover:text-foreground"}`}>{tag}</button>;
                })}
              </div>}
            </div>
            <label className="text-xs text-text-secondary">发布内容
              <select aria-label="发布内容" value={platformKind} onChange={(event) => { setPlatformKind(event.target.value as typeof platformKind); setDictionaryEntryType(""); setDictionaryMembers([]); }}
                className="mt-2 w-full rounded-lg border border-glass-border bg-surface-inset px-3 py-2 text-sm text-foreground">
                <option value={initialMediaType}>{initialMediaType === "video" ? "视频与提示词" : "图片与提示词"}</option>
                <option value="prompt_preset">仅提示词</option>
              </select>
            </label>
            {platformCategory !== "character/reference" && <label className="text-xs text-text-secondary">词典归类
              <select aria-label="词典归类" value={dictionaryEntryType} onChange={(event) => { setDictionaryEntryType(event.target.value as typeof dictionaryEntryType); setDictionaryMembers([]); }}
                className="mt-2 w-full rounded-lg border border-glass-border bg-surface-inset px-3 py-2 text-sm text-foreground">
                <option value="">普通参考素材</option>
                {platformKind === "prompt_preset"
                  ? <><option value="term">原子描述词 · 供检索引用</option><option value="pattern">组合方案 · 选择已发布词条</option></>
                  : <option value="case">效果案例 · 媒体与 Prompt</option>}
              </select>
              <span className="mt-1 block text-xs text-text-muted">仅供检索与审核；不会自动加入模型请求。组合方案需单独建立成员引用。</span>
            </label>}
            {dictionaryEntryType === "term" && <p className="text-xs text-text-muted">词条使用下方可编辑描述，限单行 500 字；原始完整生成 Prompt 仍保存在审核记录。</p>}
            {dictionaryEntryType === "pattern" && <div className="rounded-md border border-glass-border p-2 text-xs text-text-secondary">
              <p className="font-medium text-foreground">按点击顺序选择 2–12 个词条</p>
              {dictionaryLoadError && <p role="alert" className="mt-1 text-status-failed-fg">{dictionaryLoadError}</p>}
              <div className="mt-2 max-h-40 overflow-y-auto">
                {dictionaryTerms.filter((resource) => resource.dictionary?.semantic_domain === dictionaryDomain(platformCategory)).map((resource) => {
                  const index = dictionaryMembers.findIndex((member) => member.platform_resource_id === resource.platform_resource_id);
                  return <button key={resource.platform_resource_id} type="button" aria-pressed={index >= 0}
                    onClick={() => setDictionaryMembers((current) => index >= 0
                      ? current.filter((member) => member.platform_resource_id !== resource.platform_resource_id)
                      : current.length < 12 ? [...current, resource] : current)}
                    className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <span className="w-5 text-primary">{index >= 0 ? index + 1 : "·"}</span><span>{resource.title} · r{resource.revision}</span>
                  </button>;
                })}
              </div>
              <p className="mt-1">已选 {dictionaryMembers.length} 项；保存固定版本引用。提交前可调整。</p>
            </div>}
            <p className="text-xs text-text-muted">描述可编辑；审核记录会另存实际生成提示词、模型、参数与来源结果。</p>
          </div>}

          {/* 名称 */}
          <div>
            <label
              htmlFor="lib-asset-name"
              className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary"
            >
              {t("nameLabel")}
            </label>
            <input
              id="lib-asset-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="mt-2 w-full bg-surface-inset border border-glass-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-foreground placeholder-text-muted focus:outline-none focus:border-primary/60"
            />
          </div>

          {/* 描述 */}
          <div>
            <label
              htmlFor="lib-asset-desc"
              className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary"
            >
              {targetScope === "platform" ? "配套 Prompt（可编辑）" : t("descLabel")}
            </label>
            <textarea
              id="lib-asset-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={targetScope === "platform" ? "输入与图片配套的完整 Prompt；可修改角色、版式和细节。" : t("descPlaceholder")}
              rows={targetScope === "platform" ? 8 : 3}
              maxLength={targetScope === "platform" ? 20000 : undefined}
              className="mt-2 w-full bg-surface-inset border border-glass-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-foreground placeholder-text-muted focus:outline-none focus:border-primary/60 resize-none"
            />
          </div>

          {/* 图片（可选）— 上传本地图片，或填图片 URL（备选） */}
          {targetScope === "asset" && <div>
            <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary">
              {t("imageLabel")}
            </span>

            {/* 上传本地图片 + 预览缩略图 */}
            <div className="mt-2 flex items-center gap-3">
              {imageUrl ? (
                <img
                  src={getAssetUrl(imageUrl)}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover border border-glass-border bg-surface-inset shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg grid place-items-center border border-glass-border bg-surface-inset text-text-muted shrink-0">
                  <ImageIcon size={16} aria-hidden="true" />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-inset border border-glass-border text-text-secondary text-[0.8125rem] font-medium hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? t("uploading") : t("uploadImageButton")}
              </button>
            </div>
            {initialVariants.length > 0 && (
              <div className="mt-3 space-y-2" aria-label="已导入参考变体">
                <div className="text-xs text-text-secondary">已导入 {initialVariants.length} 张参考图</div>
                {initialVariants.map((variant, index) => (
                  <div key={`${variant.image_url}-${index}`} className="flex items-center gap-2 rounded-lg border border-glass-border bg-surface-inset p-2">
                    <img src={getAssetUrl(variant.image_url)} alt="" className="h-9 w-9 rounded object-cover" />
                    <select aria-label={`第 ${index + 1} 张参考职责`} value={variant.reference_view_role} onChange={(event) => setInitialVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reference_view_role: event.target.value } : item))} className="min-w-0 flex-1 rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                      <option value="front">正面 / 主视角</option>
                      <option value="profile">侧面 / 侧视角</option>
                      <option value="three_quarter">三分之四视角</option>
                      <option value="detail">细节 / 材质</option>
                      <option value="additional">补充视角</option>
                    </select>
                    <select aria-label={`第 ${index + 1} 张参考距离`} value={variant.reference_distance} onChange={(event) => setInitialVariants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reference_distance: event.target.value } : item))} className="w-24 rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                      <option value="full">全身 / 远景</option>
                      <option value="medium">中景</option>
                      <option value="close">近景</option>
                      <option value="macro">细节</option>
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* 备选：直接填图片 URL */}
            <label
              htmlFor="lib-asset-image"
              className="block mt-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary"
            >
              {t("imageUrlLabel")}
            </label>
            <input
              id="lib-asset-image"
              type="text"
              value={imageUrl}
              onChange={(e) => { setImageUrl(e.target.value); setImageOrigin(undefined); }}
              placeholder={t("imageUrlPlaceholder")}
              className="mt-2 w-full bg-surface-inset border border-glass-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-foreground placeholder-text-muted focus:outline-none focus:border-primary/60"
            />
            <div className="text-[0.6875rem] text-text-muted mt-1.5">{t("imageUrlHint")}</div>
          </div>}

          {targetScope === "platform" && <>
            {platformKind !== "prompt_preset" && imageUrl && (initialMediaType === "video"
              ? <video src={getAssetUrl(imageUrl)} controls className="max-h-28 w-full rounded-lg object-contain" />
              : <img src={getAssetUrl(imageUrl)} alt="待审核图片" className="max-h-28 w-full rounded-lg object-contain" />)}
            <label className="flex items-start gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
              我确认拥有将此内容提交平台审核的权利
            </label>
          </>}

          {/* actions */}
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface-inset border border-glass-border text-text-secondary text-sm font-medium hover:text-foreground transition-colors"
            >
              {tc("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || uploading || (targetScope === "platform" && (!publisher?.authorized || !platformCategories.length || !description.trim() || !rightsConfirmed))}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-accent text-sm font-semibold hover:bg-primary-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {submitting ? t("creating") : targetScope === "platform" ? "提交平台审核" : tc("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
