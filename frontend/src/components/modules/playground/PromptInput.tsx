'use client';

import { useState } from 'react';
import { Film, Plus, X, FileText, Music } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore } from './usePlaygroundStore';
import { referenceKey, referenceName } from './referenceMedia';
import FullNameHints from './FullNameHints';
import ReferencePromptEditor from './ReferencePromptEditor';
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
    <FullNameHints className="relative">
        <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="参考素材列表">
          {referenceCandidates.map(({ path, label, mediaType }, index) => {
            const isVideo = mediaType === 'video';
            return (
              <div
                key={`${path}-${index}`}
                data-full-name={label}
                className="group relative h-12 w-12 overflow-hidden rounded-xl border border-primary/30 bg-surface-inset"
              >
                {/\.(mp3|wav)(?:[?#].*)?$/i.test(path) ? <Music aria-label="音频参考" className="m-3 h-6 w-6 text-primary" /> : /\.(txt|md|csv|json|srt|vtt)(?:[?#].*)?$/i.test(path) ? <FileText aria-label="文本参考" className="m-3 h-6 w-6 text-primary" /> : isVideo ? (
                  <video src={getAssetUrl(path)} muted className="h-full w-full object-cover" />
                ) : (
                  <img src={getAssetUrl(path)} alt={label} className="h-full w-full object-cover" />
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
          <button type="button" onClick={onOpenReferences} aria-label="添加参考素材" title="添加参考素材"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 text-primary/70 transition-colors hover:border-primary hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>

      {/* Main prompt textarea */}
      <div className="flex items-start gap-3">
      <ReferencePromptEditor value={prompt} labels={[...referenceCandidates.map((candidate) => candidate.label), ...Object.values(mediaNames)]}
        onChange={handlePromptChange} onSubmit={onSubmit} placeholder={t('prompt.placeholder')} />
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
          className="w-full min-h-[60px] resize-y bg-transparent border-0 rounded-none p-0 text-text-secondary text-xs placeholder-text-muted focus:outline-none focus:ring-0"
        />
      )}

      <PromptTemplateModal />
      <PromptHistoryDrawer />
    </FullNameHints>
  );
}
