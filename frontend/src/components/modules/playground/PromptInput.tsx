'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore } from './usePlaygroundStore';
import PromptTemplateModal from './PromptTemplateModal';
import PromptHistoryDrawer from './PromptHistoryDrawer';

const MAX_LENGTH = 2000;

interface PromptInputProps {
  onSubmit?: () => void;
}

export default function PromptInput({ onSubmit }: PromptInputProps) {
  const prompt = usePlaygroundStore((s) => s.prompt);
  const negativePrompt = usePlaygroundStore((s) => s.negativePrompt);
  const setPrompt = usePlaygroundStore((s) => s.setPrompt);
  const setNegativePrompt = usePlaygroundStore((s) => s.setNegativePrompt);
  const t = useTranslations('playground');

  const [showNegPrompt, setShowNegPrompt] = useState(false);

  return (
    <div>
      {/* Main prompt textarea */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={t('prompt.placeholder')}
        className="min-h-[88px] max-h-[220px] w-full resize-y rounded-none border-0 bg-transparent p-0 text-[0.9375rem] leading-[1.65] text-foreground placeholder-text-muted focus:ring-0"
      />

      {/* Toolbar — below the textarea, not overlapping */}
      <div className="mt-3 flex items-center gap-[6px] border-t border-border-subtle pt-2.5">
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
