'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { X, Rotate3D, Pencil, Save, Image as ImageIcon, Brush, Scan } from 'lucide-react';
import type { FilerobotImageEditorConfig } from 'react-filerobot-image-editor';
import ImageMarkingCanvas, { emptyMarking, renderMarkedImage, type Marking } from './ImageMarkingCanvas';

// Adapted from iyishow's Filerobot workbench; no canvas, API or store dependency.
const Engine = dynamic(() => import('react-filerobot-image-editor').then(m => m.default), { ssr: false });
const PanoramaViewer = dynamic(() => import('./PanoramaViewer'), { ssr: false });
type SavedImage = Parameters<NonNullable<FilerobotImageEditorConfig['onSave']>>[0];

const EDITOR_ZH_TRANSLATIONS = {
  save: '保存副本', saveAs: '另存为', cancel: '取消', apply: '应用', confirm: '确认',
  adjustTab: '调整', finetuneTab: '调色', filtersTab: '滤镜', annotateTabLabel: '标注', watermarkTab: '水印',
  resize: '尺寸', cropTool: '裁剪', rotateTool: '旋转', flipX: '水平翻转', flipY: '垂直翻转',
  undoTitle: '撤销', redoTitle: '重做', zoomInTitle: '放大', zoomOutTitle: '缩小', fitTitle: '适应画布',
  original: '原始比例', custom: '自定义', square: '正方形', landscape: '横向', portrait: '纵向',
  arrowTool: '箭头', blurTool: '模糊', brightnessTool: '亮度', contrastTool: '对比度',
  ellipseTool: '椭圆', hue: '色相', saturation: '饱和度', imageTool: '图片',
  lineTool: '直线', penTool: '画笔', polygonTool: '多边形', rectangleTool: '矩形',
  text: '文字', textTool: '文字', fontFamily: '字体', size: '大小', letterSpacing: '字间距', lineHeight: '行高',
  addWatermark: '添加水印', addTextWatermark: '添加文字水印', uploadWatermark: '上传水印',
  opacity: '不透明度', position: '位置', stroke: '描边', width: '宽度', height: '高度',
  resizeWidthTitle: '宽度（像素）', resizeHeightTitle: '高度（像素）',
  toggleRatioLockTitle: '锁定或解锁宽高比', resetSize: '恢复原始图片尺寸',
  format: '格式', quality: '质量', actualSize: '实际大小（100%）', fitSize: '适应大小',
};

export async function exportedImageFile(image: SavedImage, title: string): Promise<File> {
  const mime = image.mimeType || 'image/png';
  let blob: Blob;
  if (image.imageCanvas) {
    blob = await new Promise<Blob>((resolve, reject) => image.imageCanvas!.toBlob(value => value ? resolve(value) : reject(new Error('Image export failed')), mime));
  } else if (image.imageBase64?.startsWith('data:image/')) {
    const encoded = image.imageBase64.split(',')[1];
    blob = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: mime });
  } else throw new Error('Image export failed');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return new File([blob], `${title.replace(/\.[^.]+$/, '') || 'image'}-edited.${ext}`, { type: mime });
}

const IMAGE_EDITOR_THEME: NonNullable<FilerobotImageEditorConfig["theme"]> = {
  palette: {
    "txt-primary": "#f8fafc",
    "txt-secondary": "#cbd5e1",
    "txt-secondary-invert": "#e2e8f0",
    "txt-placeholder": "#64748b",
    "accent-primary-disabled": "#334155",
    "accent-primary-active": "#f8fafc",
    "accent-secondary-disabled": "#1f2937",
    "bg-grey": "#111827",
    "bg-stateless": "#111827",
    "bg-active": "#1f2937",
    "bg-base-light": "#1f2937",
    "bg-base-medium": "#1f2937",
    "bg-primary": "#111827",
    "bg-primary-light": "#111827",
    "bg-primary-hover": "#1f2937",
    "bg-primary-active": "#273244",
    "bg-primary-stateless": "#1f2937",
    "bg-primary-0-5-opacity": "rgb(17 24 39 / 50%)",
    "bg-secondary": "#111827",
    "bg-hover": "#1f2937",
    "bg-green": "#13251f",
    "bg-green-medium": "#173126",
    "bg-blue": "#172033",
    "bg-red": "#2a171b",
    "bg-red-light": "#2a171b",
    "background-red-medium": "#351b20",
    "bg-orange": "#2b2116",
    "bg-tooltip": "#273244",
    "icon-primary": "#cbd5e1",
    "icons-secondary": "#94a3b8",
    "icons-placeholder": "#64748b",
    "icons-invert": "#f8fafc",
    "icons-muted": "#64748b",
    "icons-primary-hover": "#f8fafc",
    "icons-secondary-hover": "#cbd5e1",
    "btn-secondary-text": "#e2e8f0",
    "link-primary": "#cbd5e1",
    "link-stateless": "#cbd5e1",
    "link-hover": "#f8fafc",
    "link-active": "#f8fafc",
    "borders-primary": "#334155",
    "borders-primary-hover": "#64748b",
    "borders-secondary": "#273244",
    "borders-strong": "#475569",
    "borders-invert": "#475569",
    "borders-item": "#273244",
    "active-secondary": "#1f2937",
    "gradient-right": "linear-gradient(270deg, #111827 30%, rgb(17 24 39 / 0%) 100%)",
    "gradient-right-active": "linear-gradient(270deg, #1f2937 30%, rgb(31 41 55 / 0%) 100%)",
    "gradient-right-hover": "linear-gradient(270deg, #1f2937 30%, rgb(31 41 55 / 0%) 100%)",
    "white-0-7-8-overlay": "rgb(17 24 39 / 78%)",
  },
};

export interface ImageEditorProps {
  source?: string;
  title: string;
  emptyState?: ReactNode;
  leftPanel?: ReactNode;
  toolPanel?: ReactNode;
  canvasStatus?: ReactNode;
  initialView?: 'preview' | 'edit' | 'panorama';
  onModified?: () => void;
  onDiscard?: () => void;
  onSavePanoramaSource?: () => Promise<void>;
  onMaskChange?: (marking: Marking) => void;
  maskMarking?: Marking;
  sourceDimensions?: { width: number; height: number };
  panoramaEligible?: boolean;
  panoramaSaveEligible?: boolean;
  panoramaCandidate?: boolean;
  panoramaQualityStatus?: 'pass' | 'review' | 'fail';
  onSave: (file: File) => Promise<void>;
  onClose: () => void;
}

export default function ImageEditor({ source, title, emptyState, leftPanel, toolPanel, canvasStatus, initialView = 'edit', onModified, onDiscard, onSavePanoramaSource, onMaskChange, maskMarking, sourceDimensions, panoramaEligible = false, panoramaSaveEligible, panoramaCandidate = false, panoramaQualityStatus, onSave, onClose }: ImageEditorProps) {
  const t = useTranslations('imageEditor');
  const locale = useLocale();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'preview' | 'edit' | 'panorama' | 'annotate' | 'mask'>(initialView);
  const [annotations, setAnnotations] = useState<Marking>(emptyMarking);
  const canSavePanorama = (panoramaSaveEligible ?? panoramaEligible) && panoramaQualityStatus !== 'review' && panoramaQualityStatus !== 'fail';
  useEffect(() => { setView(initialView); setAnnotations(emptyMarking()); dirty.current = false; }, [source, initialView]);
  const close = () => {
    if (inFlight.current) return;
    if (dirty.current && !window.confirm(t('discard'))) return;
    onClose();
  };
  const changeView = (next: 'preview' | 'edit' | 'panorama' | 'annotate' | 'mask') => {
    if (inFlight.current || next === view) return;
    if ((view === 'edit' || view === 'annotate') && dirty.current) {
      if (!window.confirm(t('discard'))) return;
      dirty.current = false;
      onDiscard?.();
      if (view === 'annotate') setAnnotations(emptyMarking());
    }
    setView(next);
  };
  const saveAnnotations = async () => {
    if (!source || !sourceDimensions || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const blob = await renderMarkedImage(source, annotations, sourceDimensions.width, sourceDimensions.height, false);
      await onSave(new File([blob], `${title.replace(/\.[^.]+$/, '') || 'image'}-annotated.png`, { type: 'image/png' }));
      dirty.current = false;
    } catch { setError(t('saveFailed')); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const savePanoramaSource = async () => {
    if (inFlight.current || !onSavePanoramaSource) return;
    inFlight.current = true; setSaving(true); setError('');
    try { await onSavePanoramaSource(); dirty.current = false; }
    catch { setError(t('saveFailed')); }
    finally { inFlight.current = false; setSaving(false); }
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current!;
    // Engine menus/modals portal into body. Native showModal makes them inert.
    const background = Array.from(document.body.children).filter(node => node !== root) as HTMLElement[];
    const priorInert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const externalDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .find(node => node !== root && !root.contains(node) && node.getClientRects().length > 0);
      if (event.key === 'Escape' && !externalDialog) { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const scope = externalDialog || document.body;
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
        .filter(node => node.tabIndex >= 0 && !node.closest('[inert]') && !node.matches(':disabled') && node.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); closeButton.current?.focus(); return; }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      background.forEach((node, index) => { node.inert = priorInert[index]; });
      document.body.style.overflow = overflow;
      previous?.focus();
    };
    // Lifecycle isolation; close reads mutable dirty/in-flight refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="image-editor-title"
      className="fixed z-[1000] inset-0 m-auto h-[100dvh] max-h-none w-screen max-w-none border-0 bg-surface p-0 text-foreground shadow-[0_0_0_100vmax_rgba(0,0,0,0.7)] sm:h-[94dvh] sm:w-[96vw] sm:rounded-xl">
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-glass-border px-4 py-2">
          <div className="min-w-0"><h2 id="image-editor-title" className="font-semibold">{t('title')}</h2><p className="truncate text-sm text-text-muted">{title}</p></div>
          <button ref={closeButton} type="button" disabled={saving} onClick={close} aria-label={t('close')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X size={20} /></button>
        </header>
        {source && canSavePanorama && onSavePanoramaSource && <div className="border-b border-glass-border px-4 py-2 text-sm">
          <button type="button" disabled={saving} onClick={() => void savePanoramaSource()} className="inline-flex min-h-10 items-center gap-2 rounded border border-glass-border px-3 hover:bg-hover-bg"><Save size={16}/>{t('savePanoramaSource')}</button>
        </div>}
        {panoramaCandidate && <p role="status" className={`border-b border-glass-border px-4 py-2 text-xs ${canSavePanorama ? 'text-text-secondary' : 'text-status-failed-fg'}`}>
          {panoramaQualityStatus === 'review' || panoramaQualityStatus === 'fail'
            ? t('panoramaQualityWarning')
            : t(canSavePanorama ? 'panoramaCandidatePreview' : 'panoramaCandidateRatioWarning')}
        </p>}
        {error && <p role="alert" className="px-4 py-2 text-status-failed-fg">{error}</p>}
        {saving && <p role="status" className="px-4 py-2 text-sm">{t('saving')}</p>}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-auto border-b border-glass-border bg-surface px-2 py-2 text-sm lg:w-44 lg:flex-col lg:border-b-0 lg:border-r" aria-label={t('editorFunctions')}>
            <button type="button" aria-current={view === 'preview' ? 'page' : undefined} onClick={() => changeView('preview')} className={`flex min-h-10 shrink-0 items-center gap-2 rounded px-3 text-left ${view === 'preview' ? 'bg-hover-bg text-primary' : 'hover:bg-hover-bg'}`}><ImageIcon size={16}/>{t('canvasPreview')}</button>
            <button type="button" disabled={!source} aria-current={view === 'edit' ? 'page' : undefined} onClick={() => changeView('edit')} className={`flex min-h-10 shrink-0 items-center gap-2 rounded px-3 text-left disabled:opacity-40 ${view === 'edit' ? 'bg-hover-bg text-primary' : 'hover:bg-hover-bg'}`}><Pencil size={16}/>{t('edit')}</button>
            <button type="button" disabled={!source} aria-current={view === 'annotate' ? 'page' : undefined} onClick={() => changeView('annotate')} className={`flex min-h-10 shrink-0 items-center gap-2 rounded px-3 text-left disabled:opacity-40 ${view === 'annotate' ? 'bg-hover-bg text-primary' : 'hover:bg-hover-bg'}`}><Brush size={16}/>{t('annotate')}</button>
            <button type="button" disabled={!source || !onMaskChange} aria-current={view === 'mask' ? 'page' : undefined} onClick={() => changeView('mask')} className={`flex min-h-10 shrink-0 items-center gap-2 rounded px-3 text-left disabled:opacity-40 ${view === 'mask' ? 'bg-hover-bg text-primary' : 'hover:bg-hover-bg'}`}><Scan size={16}/>{t('mask')}</button>
            <button type="button" disabled={!source || !panoramaEligible} aria-current={view === 'panorama' ? 'page' : undefined} onClick={() => changeView('panorama')} className={`flex min-h-10 shrink-0 items-center gap-2 rounded px-3 text-left disabled:opacity-40 ${view === 'panorama' ? 'bg-hover-bg text-primary' : 'hover:bg-hover-bg'}`}><Rotate3D size={16}/>{t('browsePanorama')}</button>
            {leftPanel && <>
              <details className="min-w-32 lg:hidden"><summary className="flex min-h-10 cursor-pointer items-center px-3">{t('copies')}</summary><div className="max-h-40 overflow-auto border-t border-glass-border pt-2">{leftPanel}</div></details>
              <div className="hidden min-h-0 overflow-auto border-t border-glass-border pt-3 lg:block">{leftPanel}</div>
            </>}
          </nav>
          <main className={`relative min-h-[280px] min-w-0 flex-1 bg-[#101418] ${source ? 'overflow-hidden' : 'overflow-auto'}`} aria-label={t('canvasPreview')}>
          {source && view === 'panorama' ? <PanoramaViewer src={source} label={t('browsePanorama')} /> : source && view === 'annotate' ? <div className="flex h-full min-h-0 flex-col"><ImageMarkingCanvas source={source} marking={annotations} mode="annotate" onChange={next => { setAnnotations(next); dirty.current = true; onModified?.(); }}/><button type="button" disabled={saving || (!annotations.strokes.length && !annotations.rect)} onClick={() => void saveAnnotations()} className="m-2 min-h-10 shrink-0 rounded bg-primary px-3 text-primary-foreground disabled:opacity-40">{t('saveAnnotations')}</button></div> : source && view === 'mask' && maskMarking && onMaskChange ? <ImageMarkingCanvas source={source} marking={maskMarking} mode="mask" onChange={onMaskChange}/> : source && view === 'edit' ? <fieldset disabled={saving} className="h-full min-w-0 border-0 p-0" aria-busy={saving}>
            <Engine key={source} theme={IMAGE_EDITOR_THEME} source={source} language={locale === 'zh' ? 'zh-CN' : 'en'} useBackendTranslations={false}
              translations={locale === 'zh' ? EDITOR_ZH_TRANSLATIONS : { save: 'Save copy' }}
              onModify={() => { dirty.current = true; onModified?.(); }}
              onSave={async image => {
                if (inFlight.current) return;
                inFlight.current = true; setSaving(true); setError('');
                try { await onSave(await exportedImageFile(image, title)); dirty.current = false; }
                catch { setError(t('saveFailed')); }
                finally { inFlight.current = false; setSaving(false); }
              }}
              onBeforeSave={() => false} closeAfterSave={false} defaultSavedImageType="png" defaultSavedImageName="edited-image"
              avoidChangesNotSavedAlertOnLeave disableSaveIfNoChanges savingPixelRatio={1} previewPixelRatio={1}
              tabsIds={['Adjust', 'Finetune', 'Filters', 'Watermark', 'Resize']}
              defaultTabId="Adjust" defaultToolId="Crop" annotationsCommon={{ fill: '#ff4d4f', stroke: '#ff4d4f' }} Pen={{ stroke: '#ff4d4f', strokeWidth: 4, lineCap: 'round' }} observePluginContainerSize />
          </fieldset> : source ? <div className="grid h-full min-h-[280px] place-items-center p-3">
            <div className="grid min-h-0 min-w-0 place-items-center overflow-hidden p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source} alt={title} className="max-h-full max-w-full object-contain" />
            </div>
          </div> : emptyState}
          {canvasStatus && <div className="absolute bottom-3 left-3 right-3 rounded bg-black/75 px-3 py-2 text-sm text-white" role="status">{canvasStatus}</div>}
          </main>
          {toolPanel && <aside className="max-h-[38vh] w-full shrink-0 overflow-auto border-t border-glass-border bg-surface px-3 py-3 lg:max-h-none lg:w-[300px] lg:border-l lg:border-t-0" aria-label={t('tools')}>{toolPanel}</aside>}
        </div>
        <p className="shrink-0 border-t border-glass-border px-4 py-2 text-xs text-text-muted">{t('hint')}</p>
      </div>
    </div>, document.body);
}
