"use client";

import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Plus, Upload, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { toast } from "@/store/toastStore";

type AssetTab = "characters" | "scenes" | "props";

// 资产类型 → 后端单数 type（/library/assets 端点用）。
const SINGULAR: Record<AssetTab, string> = { characters: "character", scenes: "scene", props: "prop" };

interface NewLibraryAssetDialogProps {
  onClose: () => void;
  /** 创建成功后回调（父层刷新库以显示新资产）。 */
  onCreated: () => void;
  /** Optional existing material to register as the first asset variant. */
  initialImageUrl?: string;
  initialName?: string;
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
export default function NewLibraryAssetDialog({ onClose, onCreated, initialImageUrl = "", initialName = "", initialImageOrigin, initialSourceGenerationId, initialSourceOutputId }: NewLibraryAssetDialogProps) {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const [assetType, setAssetType] = useState<AssetTab>("characters");
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
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
        aria-label={t("newAssetTitle")}
        className="relative z-[1] w-full max-w-[440px] glass-panel border border-glass-border rounded-2xl shadow-2xl atelier-reveal overflow-hidden"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-glass-border">
          <div>
            <div className="font-display atelier-display text-lg font-semibold text-foreground tracking-tight">
              {t("newAssetTitle")}
            </div>
            <div className="text-[0.75rem] text-text-muted mt-0.5">{t("newAssetSubtitle")}</div>
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
          {/* 类型选择 */}
          <div>
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
          </div>

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
              {t("descLabel")}
            </label>
            <textarea
              id="lib-asset-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descPlaceholder")}
              rows={3}
              className="mt-2 w-full bg-surface-inset border border-glass-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-foreground placeholder-text-muted focus:outline-none focus:border-primary/60 resize-none"
            />
          </div>

          {/* 图片（可选）— 上传本地图片，或填图片 URL（备选） */}
          <div>
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
          </div>

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
              disabled={submitting || uploading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-accent text-sm font-semibold hover:bg-primary-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {submitting ? t("creating") : tc("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
