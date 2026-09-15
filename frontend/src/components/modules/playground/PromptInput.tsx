'use client';

import { useState } from 'react';
import { Film, ImagePlus, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore } from './usePlaygroundStore';
import PromptTemplateModal from './PromptTemplateModal';
import PromptHistoryDrawer from './PromptHistoryDrawer';

const MAX_LENGTH = 2000;

interface PromptInputProps {
  onSubmit?: () => void;
  onOpenReferences?: () => void;
}

export default function PromptInput({ onSubmit, onOpenReferences }: PromptInputProps) {
  const prompt = usePlaygroundStore((s) => s.prompt);
  const negativePrompt = usePlaygroundStore((s) => s.negativePrompt);
  const mode = usePlaygroundStore((s) => s.mode);
  const inputMedia = usePlaygroundStore((s) => s.inputMedia);
  const history = usePlaygroundStore((s) => s.history);
  const setPrompt = usePlaygroundStore((s) => s.setPrompt);
  const setNegativePrompt = usePlaygroundStore((s) => s.setNegativePrompt);
  const setInputMedia = usePlaygroundStore((s) => s.setInputMedia);
  const setMode = usePlaygroundStore((s) => s.setMode);
  const t = useTranslations('playground');

  const [showNegPrompt, setShowNegPrompt] = useState(false);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);

  const mentionStart = prompt.lastIndexOf('@');
  const mentionText = mentionStart >= 0 ? prompt.slice(mentionStart) : '';
  const mentionActive = mentionStart >= 0 && !/\s/.test(mentionText);

  const referenceCandidates = history
    .flatMap((generation) => generation.outputs.map((output) => ({
      path: output.media_path,
      mediaType: output.media_type,
      label: generation.model_id || generation.mode,
      generationId: generation.id,
    })))
    .filter((candidate, index, all) => candidate.path && all.findIndex((item) => item.path === candidate.path) === index)
    .filter((candidate) => !['t2i', 'i2i'].includes(mode) || candidate.mediaType === 'image')
    .slice(0, 12);

  const addReference = (path: string, mediaType: string, mention = false) => {
    if (!inputMedia.includes(path)) setInputMedia([...inputMedia, path]);
    if (mode === 't2i') setMode('i2i');
    if (mode === 't2v') setMode(mediaType === 'video' ? 'v2v' : 'i2v');
    if (mention) {
      const nextPrompt = mentionActive
        ? `${prompt.slice(0, mentionStart)}@参考素材 `
        : `${prompt}${prompt && !prompt.endsWith(' ') ? ' ' : ''}@参考素材 `;
      setPrompt(nextPrompt.slice(0, MAX_LENGTH));
    }
    setMentionMenuOpen(false);
  };

  const handlePromptChange = (value: string) => {
    const next = value.slice(0, MAX_LENGTH);
    setPrompt(next);
    const at = next.lastIndexOf('@');
    setMentionMenuOpen(at >= 0 && !/\s/.test(next.slice(at)) && referenceCandidates.length > 0);
  };

  return (
    <div className="relative">
      {inputMedia.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="参考素材列表">
          {inputMedia.map((path, index) => {
            const isVideo = /\.(mp4|mov|webm|avi|mkv)(?:[?#].*)?$/i.test(path);
            return (
              <div
                key={`${path}-${index}`}
                className="group relative h-12 w-12 overflow-hidden rounded-xl border border-primary/30 bg-surface-inset"
              >
                {isVideo ? (
                  <video src={getAssetUrl(path)} muted className="h-full w-full object-cover" />
                ) : (
                  <img src={getAssetUrl(path)} alt={`参考素材 ${index + 1}`} className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setInputMedia(inputMedia.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`移除参考素材 ${index + 1}`}
                  className="absolute right-0.5 top-0.5 inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={onOpenReferences}
            aria-label="添加参考素材"
            className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-border-subtle text-text-muted transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main prompt textarea */}
      <textarea
        value={prompt}
        onChange={(e) => handlePromptChange(e.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={t('prompt.placeholder')}
        className="min-h-[88px] max-h-[220px] w-full resize-y rounded-none border-0 bg-transparent p-0 text-[0.9375rem] leading-[1.65] text-foreground placeholder-text-muted focus:ring-0"
      />

      {mentionMenuOpen && (
        <div
          role="listbox"
          aria-label="选择参考素材"
          className="absolute bottom-16 left-0 z-50 max-h-64 w-[min(100%,24rem)] overflow-y-auto rounded-2xl border border-glass-border bg-elevated p-2 shadow-2xl"
        >
          <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
            @参考素材
          </div>
          {referenceCandidates.map((candidate) => (
            <button
              key={`${candidate.generationId}-${candidate.path}`}
              type="button"
              role="option"
              onClick={() => addReference(candidate.path, candidate.mediaType, true)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-inset">
                {candidate.mediaType === 'video' ? (
                  <Film size={15} className="text-text-muted" aria-hidden="true" />
                ) : (
                  <img src={getAssetUrl(candidate.path)} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{candidate.label}</span>
              <span className="text-[0.625rem] text-text-muted">@参考素材</span>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar — below the textarea, not overlapping */}
      <div className="mt-3 flex items-center gap-[6px] border-t border-border-subtle pt-2.5">
        <button
          type="button"
          onClick={onOpenReferences}
          aria-label="添加参考素材"
          title="添加参考素材"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-hover-bg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Plus size={17} aria-hidden="true" />
        </button>
        <span className="inline-flex items-center gap-1 text-[0.6875rem] text-text-muted">
          <ImagePlus size={13} aria-hidden="true" />
          输入 @ 选择历史参考素材
        </span>
        <span className="ml-auto font-mono text-[0.625rem] text-text-muted">
          {prompt.length} / {MAX_LENGTH}
        </span>
      </div>

      {/* Negative prompt toggle */}
      <div
        className="flex items-center gap-[6px] py-[6px] text-[0.6875rem] text-text-muted cursor-pointer hover:text-foreground mt-2"
        onClick={() => setShowNegPrompt((v) => !v)}
      >
        <span
          className="inline-block transition-transform duration-150"
          style={{ transform: showNegPrompt ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          &#9656;
        </span>
        <span>{t('prompt.negativeLabel')}</span>
      </div>

      {showNegPrompt && (
        <textarea
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder={t('prompt.negativePlaceholder')}
          className="w-full min-h-[60px] resize-y bg-transparent border-0 rounded-none p-0 text-text-secondary text-xs placeholder-text-muted focus:ring-0"
        />
      )}

      <PromptTemplateModal />
      <PromptHistoryDrawer />
    </div>
  );
}
