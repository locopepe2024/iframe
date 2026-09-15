'use client';

import { useState } from 'react';
import { Film, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore } from './usePlaygroundStore';
import { referenceKey, referenceName } from './referenceMedia';
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
  const inputMedia = usePlaygroundStore((s) => s.inputMedia);
  const history = usePlaygroundStore((s) => s.history);
  const mediaNames = usePlaygroundStore((s) => s.mediaNames);
  const setPrompt = usePlaygroundStore((s) => s.setPrompt);
  const setNegativePrompt = usePlaygroundStore((s) => s.setNegativePrompt);
  const setInputMedia = usePlaygroundStore((s) => s.setInputMedia);
  const t = useTranslations('playground');

  const [showNegPrompt, setShowNegPrompt] = useState(false);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);

  const mentionStart = prompt.lastIndexOf('@');
  const mentionText = mentionStart >= 0 ? prompt.slice(mentionStart) : '';
  const mentionActive = mentionStart >= 0 && !/\s/.test(mentionText);

  const referenceCandidates = inputMedia.map((path, index) => ({
    path,
    index,
    label: referenceName(path, mediaNames, history),
    source: path.includes('/input-media/') ? '上传文件' : path.includes('/studio/media/') ? '素材库' : '历史生成',
    mediaType: history.flatMap((generation) => generation.outputs)
      .find((output) => referenceKey(output.media_path) === referenceKey(path))?.media_type
      || (/\.(mp4|mov|webm|avi|mkv)(?:[?#].*)?$/i.test(path) ? 'video' : 'image'),
  }));

  const insertReference = (label: string) => {
    const nextPrompt = mentionActive
      ? `${prompt.slice(0, mentionStart)}@${label} `
      : `${prompt}${prompt && !prompt.endsWith(' ') ? ' ' : ''}@${label} `;
    setPrompt(nextPrompt.slice(0, MAX_LENGTH));
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
          {referenceCandidates.map(({ path, label }, index) => {
            const isVideo = /\.(mp4|mov|webm|avi|mkv)(?:[?#].*)?$/i.test(path);
            return (
              <div
                key={`${path}-${index}`}
                className="group relative h-12 w-12 overflow-hidden rounded-xl border border-primary/30 bg-surface-inset"
              >
                {isVideo ? (
                  <video src={getAssetUrl(path)} muted className="h-full w-full object-cover" />
                ) : (
                  <img src={getAssetUrl(path)} alt={label} title={label} className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setInputMedia(inputMedia.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`移除 ${label}`}
                  className="absolute right-0.5 top-0.5 inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main prompt textarea */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpenReferences} aria-label="添加参考素材" title="添加参考素材"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
          <Plus size={18} aria-hidden="true" />
        </button>
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
        className="min-h-[120px] max-h-[260px] min-w-0 w-full resize-y rounded-none border-0 bg-transparent p-0 text-[0.9375rem] leading-[1.65] text-foreground placeholder-text-muted focus:ring-0"
      />
      </div>

      {mentionMenuOpen && mentionActive && referenceCandidates.length > 0 && (
        <div
          role="listbox"
          aria-label="选择参考素材"
          className="absolute bottom-16 left-0 z-50 max-h-64 w-[min(100%,24rem)] overflow-y-auto rounded-2xl border border-glass-border bg-elevated p-2 shadow-2xl"
        >
          <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
            参考素材
          </div>
          {referenceCandidates.map((candidate) => (
            <button
              key={`${candidate.index}-${candidate.path}`}
              type="button"
              role="option"
              onClick={() => insertReference(candidate.label)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-inset">
                {candidate.mediaType === 'video' ? (
                  <Film size={15} className="text-text-muted" aria-hidden="true" />
                ) : (
                  <img src={getAssetUrl(candidate.path)} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-xs">
                <span className="block truncate text-foreground" title={candidate.label}>{candidate.label}</span>
                <span className="block text-text-muted">{candidate.source}</span>
              </span>
            </button>
          ))}
        </div>
      )}

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
