'use client';

import { useState } from 'react';
import {
  ArrowUp,
  History,
  LayoutTemplate,
  Paperclip,
  SlidersHorizontal,
  WandSparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import MediaInput from './MediaInput';
import ModeSelector from './ModeSelector';
import ModelSelector from './ModelSelector';
import ParameterBar from './ParameterBar';
import PromptInput from './PromptInput';
import { getModelDisplayInfo } from './playgroundModels';
import { usePlaygroundStore } from './usePlaygroundStore';

type ComposerPanel = 'mode' | 'media' | 'settings' | null;

interface AgentComposerProps {
  canGenerate: boolean;
  batchSize: number;
  onGenerate: () => void;
}

const MODE_LABELS: Record<string, string> = {
  t2i: 'T2I', i2i: 'I2I', t2v: 'T2V', i2v: 'I2V', r2v: 'R2V', v2v: 'V2V',
};

function ToolButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active?: boolean;
  label: string;
  icon: typeof WandSparkles;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex min-h-11 max-w-[13rem] items-center gap-2 rounded-xl px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        active
          ? 'bg-primary/12 text-primary'
          : 'text-text-muted hover:bg-hover-bg hover:text-foreground',
      )}
    >
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function AgentComposer({ canGenerate, batchSize, onGenerate }: AgentComposerProps) {
  const t = useTranslations('playground');
  const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const inputMedia = usePlaygroundStore((state) => state.inputMedia);
  const setShowHistoryDrawer = usePlaygroundStore((state) => state.setShowHistoryDrawer);
  const setShowTemplateModal = usePlaygroundStore((state) => state.setShowTemplateModal);
  const model = getModelDisplayInfo(modelId);

  const togglePanel = (panel: Exclude<ComposerPanel, null>) => {
    setActivePanel((current) => current === panel ? null : panel);
  };

  const handleSubmit = () => {
    if (!canGenerate) return;
    setActivePanel(null);
    onGenerate();
  };

  return (
    <div className="shrink-0 border-t border-border-subtle bg-background/80 px-3 pb-3 pt-3 backdrop-blur-xl md:px-6 md:pb-5">
      <div className="relative z-40 mx-auto max-w-5xl rounded-[22px] border border-glass-border bg-elevated/95 shadow-2xl">
        {activePanel && (
          <div className="max-h-[46vh] overflow-y-auto border-b border-border-subtle px-4 py-4 scrollbar-thin md:px-5">
            {activePanel === 'mode' && (
              <div>
                <div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  {t('agent.modePanel')}
                </div>
                <ModeSelector />
              </div>
            )}
            {activePanel === 'media' && (
              <div>
                <div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  {t('agent.mediaPanel')}
                </div>
                {mode === 't2v'
                  ? <p className="py-3 text-sm text-text-muted">{t('agent.mediaUnavailable')}</p>
                  : <MediaInput />}
              </div>
            )}
            {activePanel === 'settings' && (
              <div>
                <div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  {t('agent.settingsPanel')}
                </div>
                <ModelSelector />
                <div className="my-4 h-px bg-border-subtle" />
                <ParameterBar />
              </div>
            )}
          </div>
        )}

        <div className="px-4 pt-3 md:px-5 md:pt-4">
          <PromptInput onSubmit={handleSubmit} />
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle px-2 py-2 md:px-3">
          <ToolButton
            active={activePanel === 'mode'}
            icon={WandSparkles}
            label={MODE_LABELS[mode] || mode}
            onClick={() => togglePanel('mode')}
          />
          <ToolButton
            active={activePanel === 'media'}
            icon={Paperclip}
            label={inputMedia.length > 0 ? t('agent.mediaCount', { count: inputMedia.length }) : t('agent.addMedia')}
            onClick={() => togglePanel('media')}
          />
          <ToolButton
            active={activePanel === 'settings'}
            icon={SlidersHorizontal}
            label={model?.displayName || modelId || t('agent.modelSettings')}
            onClick={() => togglePanel('settings')}
          />
          <ToolButton
            icon={LayoutTemplate}
            label={t('sessions.templates')}
            onClick={() => setShowTemplateModal(true)}
          />
          <ToolButton
            icon={History}
            label={t('sessions.allHistory')}
            onClick={() => setShowHistoryDrawer(true)}
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canGenerate}
            aria-label={batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}
            className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-accent shadow-[var(--glow-primary)] transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <ArrowUp size={17} aria-hidden="true" />
            <span className="hidden sm:inline">
              {batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}
            </span>
          </button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-5xl text-center font-mono text-[0.5625rem] text-text-muted">
        {t('agent.helper')} · {t('agent.shortcut')}
      </p>
    </div>
  );
}
