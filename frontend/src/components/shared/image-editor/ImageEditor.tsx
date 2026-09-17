'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { FilerobotImageEditorConfig } from 'react-filerobot-image-editor';

// Adapted from iyishow's Filerobot workbench; no canvas, API or store dependency.
const Engine = dynamic(() => import('react-filerobot-image-editor').then(m => m.default), { ssr: false });
type SavedImage = Parameters<NonNullable<FilerobotImageEditorConfig['onSave']>>[0];

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
  onSave: (file: File) => Promise<void>;
  onClose: () => void;
}

export default function ImageEditor({ source, title, emptyState, onSave, onClose }: ImageEditorProps) {
  const t = useTranslations('imageEditor');
  const locale = useLocale();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (inFlight.current) return;
    if (dirty.current && !window.confirm(t('discard'))) return;
    onClose();
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
        {error && <p role="alert" className="px-4 py-2 text-status-failed-fg">{error}</p>}
        {saving && <p role="status" className="px-4 py-2 text-sm">{t('saving')}</p>}
        <div className="min-h-0 flex-1 overflow-auto">
          {source ? <fieldset disabled={saving} className="h-full min-w-0 border-0 p-0" aria-busy={saving}>
            <Engine theme={IMAGE_EDITOR_THEME} source={source} language={locale === 'zh' ? 'zh-CN' : 'en'} useBackendTranslations={false}
              translations={locale === 'zh' ? { save: '保存副本', saveAs: '另存为', cancel: '取消', apply: '应用', adjustTab: '调整', finetuneTab: '调色', filtersTab: '滤镜', annotateTabLabel: '标注', watermarkTab: '水印', resize: '尺寸', cropTool: '裁剪', rotateTool: '旋转', flipX: '水平翻转', flipY: '垂直翻转', text: '文字', pen: '画笔', undoTitle: '撤销', redoTitle: '重做' } : { save: 'Save copy' }}
              onModify={() => { dirty.current = true; }}
              onSave={async image => {
                if (inFlight.current) return;
                inFlight.current = true; setSaving(true); setError('');
                try { await onSave(await exportedImageFile(image, title)); dirty.current = false; }
                catch { setError(t('saveFailed')); }
                finally { inFlight.current = false; setSaving(false); }
              }}
              onBeforeSave={() => false} closeAfterSave={false} defaultSavedImageType="png" defaultSavedImageName="edited-image"
              avoidChangesNotSavedAlertOnLeave disableSaveIfNoChanges savingPixelRatio={1} previewPixelRatio={1}
              tabsIds={['Adjust', 'Finetune', 'Filters', 'Annotate', 'Watermark', 'Resize']}
              defaultTabId="Adjust" defaultToolId="Rotate" observePluginContainerSize />
          </fieldset> : emptyState}
        </div>
        <p className="shrink-0 border-t border-glass-border px-4 py-2 text-xs text-text-muted">{t('hint')}</p>
      </div>
    </div>, document.body);
}
