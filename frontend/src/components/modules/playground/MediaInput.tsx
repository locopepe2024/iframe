'use client';

import { useRef, useState, useCallback } from 'react';
import { ImagePlus, Film } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { playgroundApi } from '@/lib/api';
import { usePlaygroundStore, type PlaygroundMode } from './usePlaygroundStore';
import { getModelsForMode } from './playgroundModels';
import AssetPickerModal from './AssetPickerModal';

// ---------------------------------------------------------------------------
// Mode config
// ---------------------------------------------------------------------------

interface ModeConfig {
  labelKey: string;
  accept: string;
  hintKey: string;
  multiple: boolean;
  maxFiles: number;
  icon: 'image' | 'video';
}

const MODE_CONFIG: Partial<Record<PlaygroundMode, ModeConfig>> = {
  t2i: {
    labelKey: 'media.labelReferenceOptional',
    accept: 'image/*',
    hintKey: 't2i',
    multiple: true,
    maxFiles: 9,
    icon: 'image',
  },
  i2i: {
    labelKey: 'compose.mediaReference',
    accept: 'image/*',
    hintKey: 'i2i',
    multiple: true,
    maxFiles: 9,
    icon: 'image',
  },
  i2v: {
    labelKey: 'compose.mediaFirstFrame',
    accept: 'image/*',
    hintKey: 'i2v',
    multiple: false,
    maxFiles: 1,
    icon: 'image',
  },
  r2v: {
    labelKey: 'compose.mediaReference',
    accept: 'image/*',
    hintKey: 'r2v',
    multiple: true,
    maxFiles: 9,
    icon: 'image',
  },
  f2v: {
    labelKey: 'compose.mediaFirstLastFrame',
    accept: 'image/*',
    hintKey: 'f2v',
    multiple: true,
    maxFiles: 2,
    icon: 'image',
  },
  v2v: {
    labelKey: 'compose.mediaSourceVideo',
    accept: 'video/*',
    hintKey: 'v2v',
    multiple: false,
    maxFiles: 1,
    icon: 'video',
  },
};

// ---------------------------------------------------------------------------
// Shared style tokens (Line B — semantic tokens only, theme-safe)
// ---------------------------------------------------------------------------

// Neutral glass action button (本地上传 / 从资产库选取). Replaces the
// old `border-primary/30 text-primary` accent so the panel reads quiet in Line B.
const ACTION_BTN_CLASS =
  'flex-1 px-3 py-1.5 rounded-full text-xs border border-border-subtle ' +
  'text-foreground/80 hover:bg-hover-bg hover:text-foreground ' +
  'transition-colors disabled:opacity-40';

export default function MediaInput() {
  const mode = usePlaygroundStore((s) => s.mode);
  const modelId = usePlaygroundStore((s) => s.modelId);
  const inputMedia = usePlaygroundStore((s) => s.inputMedia);
  const setInputMedia = usePlaygroundStore((s) => s.setInputMedia);
  const t = useTranslations('playground');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const isSeedance = modelId.startsWith('seedance');

  let config = MODE_CONFIG[mode === 't2v' ? 'i2v' : mode];

  const imageLimit = getModelsForMode(mode).find((model) => model.id === modelId)?.maxReferenceImages;
  if (config && (mode === 't2i' || mode === 'i2i') && imageLimit && imageLimit > 0) {
    config = { ...config, multiple: imageLimit > 1, maxFiles: imageLimit };
  }

  // Override r2v config when Seedance is selected
  if (config && mode === 'r2v' && isSeedance) {
    config = {
      ...config,
      labelKey: 'media.labelRefMaterialAV',
      accept: 'image/*,video/*,audio/*',
      hintKey: 'r2vSeedance',
    };
  }

  // Don't render for t2v mode (no input media needed)
  if (!config) return null;


  // -------------------------------------------------------------------------
  // Upload handler
  // -------------------------------------------------------------------------

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Respect max file limit
    const available = Math.max(0, config.maxFiles - usePlaygroundStore.getState().inputMedia.length);
    const toUpload = fileArray.slice(0, available);
    if (!toUpload.length) return;

    setUploading(true);
    try {
      const results = await Promise.all(
        toUpload.map((file) => playgroundApi.uploadMedia(file))
      );
      const newPaths = results.map((r) => r.path);
      if (mode === 't2v' && newPaths.length) usePlaygroundStore.getState().setMode('i2v');
      results.forEach((result, index) => {
        usePlaygroundStore.getState().rememberMediaName(result.path, toUpload[index].name);
      });

      setInputMedia([...usePlaygroundStore.getState().inputMedia, ...newPaths].slice(0, config.maxFiles));
    } catch (err) {
      console.error('[MediaInput] upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  const atLimit = inputMedia.length >= config.maxFiles;
  const handleClick = () => {
    if (atLimit || uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    // Reset so re-selecting the same file works
    e.target.value = '';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [inputMedia, config]
  );

  const handleAssetSelect = (path: string) => {
    if (mode === 't2v') usePlaygroundStore.getState().setMode('i2v');
    setInputMedia([...usePlaygroundStore.getState().inputMedia, path].slice(0, config.maxFiles));
  };

  // Determine accept type for AssetPickerModal
  const acceptType: 'image' | 'video' | 'all' =
    mode === 'r2v' && isSeedance
      ? 'all'
      : config.icon === 'video'
        ? 'video'
        : 'image';

  // -------------------------------------------------------------------------
  // Render: hidden file input
  // -------------------------------------------------------------------------

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept={config.accept}
      multiple={config.multiple}
      onChange={handleFileChange}
      className="hidden"
    />
  );

  // -------------------------------------------------------------------------
  // Render: empty state — Line B reference slot (recessed drop target)
  //
  // The section label is provided by the parent SectionCard (PlaygroundPage),
  // so this component renders only the slot + actions to avoid a double header.
  // -------------------------------------------------------------------------

  {
    return (
      <div className="space-y-2">
        <div
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border border-dashed rounded-[14px] p-6 bg-input-bg
            flex flex-col items-center gap-3 text-center cursor-pointer
            transition-colors
            ${
              dragOver
                ? 'border-primary/60 bg-primary/8 shadow-[var(--glow-primary)]'
                : 'border-border-subtle hover:border-foreground/30 hover:bg-hover-bg'
            }
            ${uploading ? 'pointer-events-none opacity-60' : ''}
          `}
        >
          {config.icon === 'video' ? (
            <Film className="w-8 h-8 text-text-muted" />
          ) : (
            <ImagePlus className="w-8 h-8 text-text-muted" />
          )}

          <span className="text-xs text-text-secondary">
            {atLimit ? t('media.limitReached', { count: config.maxFiles }) : uploading ? t('media.uploading') : t('media.dragOrClick')}
          </span>

          <span className="text-[0.6875rem] text-text-muted">{t(`media.hints.${config.hintKey}`)}</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClick}
            disabled={uploading || atLimit}
            className={ACTION_BTN_CLASS}
          >
            {t('media.localUpload')}
          </button>
          <button
            type="button"
            onClick={() => setShowAssetPicker(true)}
            disabled={uploading || atLimit}
            className={ACTION_BTN_CLASS}
          >
            {t('media.pickFromLibrary')}
          </button>
        </div>

        {fileInput}

        <AssetPickerModal
          isOpen={showAssetPicker}
          onClose={() => setShowAssetPicker(false)}
          onSelect={handleAssetSelect}
          accept={acceptType}
        />
      </div>
    );
  }

}
