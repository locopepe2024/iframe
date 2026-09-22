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

export default function MediaInput({ agentMode = false }: { agentMode?: boolean } = {}) {
  const mode = usePlaygroundStore((s) => s.mode);
  const modelId = usePlaygroundStore((s) => s.modelId);
  const inputMedia = usePlaygroundStore((s) => s.inputMedia);
  const setInputMedia = usePlaygroundStore((s) => s.setInputMedia);
  const t = useTranslations('playground');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const isSeedance = modelId.startsWith('seedance');
  const selectedModel = getModelsForMode(mode).find((model) => model.id === modelId);
  const catalogMixed = mode === 'r2v' && !!(selectedModel?.maxReferenceVideos || selectedModel?.maxReferenceAudios);

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
  if (config && mode === 'r2v' && modelId.startsWith('uniart/') && selectedModel) {
    config = { ...config,
      accept: ['image/*', ...(selectedModel.maxReferenceVideos ? ['video/*'] : []), ...(selectedModel.maxReferenceAudios ? ['audio/*'] : [])].join(','),
      maxFiles: selectedModel.maxReferenceImages + selectedModel.maxReferenceVideos + selectedModel.maxReferenceAudios || config.maxFiles,
    };
  }

  if (agentMode) config = { ...MODE_CONFIG.t2i!, maxFiles: Number.POSITIVE_INFINITY };
  // Uploading a reference is separate from the provider's per-model capacity checks.
  if (agentMode || mode === 'r2v') config = {
    ...config!, multiple: true, maxFiles: Math.max(config?.maxFiles || 0, 16),
    accept: 'image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.aiff,.aif,.wma,.txt,.md,.csv,.json,.srt,.vtt',
  };

  // Don't render for t2v mode (no input media needed)
  if (!config) return null;


  // -------------------------------------------------------------------------
  // Upload handler
  // -------------------------------------------------------------------------

  const handleFiles = async (files: FileList | File[]) => {
    if (uploading) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Respect max file limit
    const available = Math.max(0, config.maxFiles - usePlaygroundStore.getState().inputMedia.length);
    const toUpload = fileArray.slice(0, available);
    if (!toUpload.length) return;

    setUploading(true);
    setUploadError('');
    try {
      // Bound in-flight requests without limiting how many references can be added.
      const results: PromiseSettledResult<{ path: string }>[] = [];
      for (let index = 0; index < toUpload.length; index += 4) {
        results.push(...await Promise.allSettled(toUpload.slice(index, index + 4).map((file) => playgroundApi.uploadMedia(file))));
      }
      const newPaths: string[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          newPaths.push(result.value.path);
          usePlaygroundStore.getState().rememberMediaName(result.value.path, toUpload[index].name);
        } else {
          failed.push(toUpload[index].name);
        }
      });
      if (!agentMode && mode === 't2v' && newPaths.length) usePlaygroundStore.getState().setMode('i2v');
      if (!agentMode && mode === 't2i' && newPaths.length) usePlaygroundStore.getState().setMode('i2i');
      setInputMedia([...usePlaygroundStore.getState().inputMedia, ...newPaths].slice(0, config.maxFiles));
      if (failed.length) setUploadError(`${t('media.uploadFailed')}: ${failed.join(', ')}`);
    } catch {
      setUploadError(t('media.uploadFailed'));
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
    [inputMedia, config, uploading, agentMode, mode]
  );

  const handleAssetSelect = (path: string) => {
    if (!agentMode && mode === 't2v') usePlaygroundStore.getState().setMode('i2v');
    if (!agentMode && mode === 't2i') usePlaygroundStore.getState().setMode('i2i');
    setInputMedia([...usePlaygroundStore.getState().inputMedia, path].slice(0, config.maxFiles));
  };

  // Determine accept type for AssetPickerModal
  const acceptType: 'image' | 'video' | 'all' =
    agentMode || catalogMixed || mode === 'r2v'
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

          <span className="text-[0.6875rem] text-text-muted">{agentMode ? t('media.agentHint') : mode === 'r2v' ? t('media.omniHint') : t(`media.hints.${config.hintKey}`)}</span>
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

        {uploadError && <p role="alert" className="text-xs text-status-failed-fg">{uploadError}</p>}
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
