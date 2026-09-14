'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Boxes,
  Hash,
  History,
  Image as ImageIcon,
  Layers3,
  LayoutTemplate,
  Maximize2,
  Monitor,
  Paperclip,
  Video,
  Volume2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import ComposerControls, { getComposerControlState, type ComposerControl } from './ComposerControls';
import MediaInput from './MediaInput';
import { CreationMethodSelector, OutputTypeSelector } from './ModeSelector';
import ModelSelector from './ModelSelector';
import PromptInput from './PromptInput';
import { getOutputType } from './ModeSelector';
import { getModelDisplayInfo, usePlaygroundCatalogRevision } from './playgroundModels';
import { usePlaygroundStore } from './usePlaygroundStore';

type ComposerPanel = 'output' | 'model' | 'reference' | ComposerControl | null;

interface AgentComposerProps {
  canGenerate: boolean;
  batchSize: number;
  onGenerate: () => void;
}

function ToolButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active?: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={clsx(
        'inline-flex min-h-11 max-w-[16rem] items-center gap-2 rounded-xl px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        active
          ? 'bg-primary/10 text-primary'
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
  const composerRef = useRef<HTMLDivElement>(null);
  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const parameters = usePlaygroundStore((state) => state.parameters);
  usePlaygroundCatalogRevision();
  const setShowHistoryDrawer = usePlaygroundStore((state) => state.setShowHistoryDrawer);
  const setShowTemplateModal = usePlaygroundStore((state) => state.setShowTemplateModal);
  const model = getModelDisplayInfo(modelId);
  const outputType = getOutputType(mode);
  const OutputIcon = outputType === 'image' ? ImageIcon : Video;
  const outputLabel = t(outputType === 'image' ? 'mode.outputImage' : 'mode.outputVideo');
  const controls = getComposerControlState(modelId, parameters, batchSize);
  const referenceLabel = t(`mode.${mode}`);
  const resolutionLabel = [controls.resolution, controls.duration != null ? `${controls.duration}s` : null]
    .filter(Boolean)
    .join(' · ');

  const panelTitle = activePanel
    ? t(`agent.${activePanel === 'output' ? 'typePanel' : activePanel === 'model' ? 'skuPanel' : activePanel === 'reference' ? 'referencePanel' : `${activePanel}Panel`}`)
    : '';

  const togglePanel = (panel: Exclude<ComposerPanel, null>) => {
    setActivePanel((current) => current === panel ? null : panel);
  };

  useEffect(() => {
    if (!activePanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setActivePanel(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivePanel(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePanel]);

  const handleSubmit = () => {
    if (!canGenerate) return;
    setActivePanel(null);
    onGenerate();
  };

  return (
    <div className="shrink-0 border-t border-border-subtle bg-background/80 px-3 pb-3 pt-3 backdrop-blur-xl md:px-6 md:pb-5">
      <div ref={composerRef} className="relative z-40 mx-auto max-w-5xl rounded-[22px] border border-glass-border bg-elevated/95 shadow-2xl">
        {activePanel && (
          <div
            role="dialog"
            aria-label={t('agent.popoverLabel')}
            className={clsx(
              'absolute bottom-[calc(100%+0.625rem)] left-0 max-h-[56vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[18px] border border-glass-border bg-elevated p-4 shadow-2xl scrollbar-thin md:p-5',
              activePanel === 'output' && 'max-w-[360px]',
              activePanel === 'model' && 'max-w-[680px]',
              activePanel === 'reference' && 'max-w-[620px]',
              activePanel === 'resolution' && 'max-w-[520px]',
              ['ratio', 'seed', 'audio', 'batch'].includes(activePanel) && 'max-w-[360px]',
            )}
          >
            <div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
              {panelTitle}
            </div>
            {activePanel === 'output' && <OutputTypeSelector />}
            {activePanel === 'model' && <ModelSelector />}
            {activePanel === 'reference' && (
              <div className="space-y-4">
                <CreationMethodSelector />
                {!['t2i', 't2v'].includes(mode) && <MediaInput />}
              </div>
            )}
            {['resolution', 'ratio', 'seed', 'audio', 'batch'].includes(activePanel) && (
              <ComposerControls control={activePanel as ComposerControl} />
            )}
          </div>
        )}

        <div className="px-4 pt-3 md:px-5 md:pt-4">
          <PromptInput onSubmit={handleSubmit} />
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle px-2 py-2 md:px-3">
          <ToolButton
            active={activePanel === 'output'}
            icon={OutputIcon}
            label={outputLabel}
            onClick={() => togglePanel('output')}
          />
          <ToolButton
            active={activePanel === 'model'}
            icon={Boxes}
            label={model?.displayName || modelId || t('agent.selectSku')}
            onClick={() => togglePanel('model')}
          />
          <ToolButton
            active={activePanel === 'reference'}
            icon={mode === 't2i' || mode === 't2v' ? Workflow : Paperclip}
            label={referenceLabel}
            onClick={() => togglePanel('reference')}
          />
          {controls.resolution && (
            <ToolButton
              active={activePanel === 'resolution'}
              icon={Monitor}
              label={resolutionLabel}
              onClick={() => togglePanel('resolution')}
            />
          )}
          {controls.ratio && (
            <ToolButton
              active={activePanel === 'ratio'}
              icon={Maximize2}
              label={controls.ratio}
              onClick={() => togglePanel('ratio')}
            />
          )}
          {controls.supportsSeed && (
            <ToolButton
              active={activePanel === 'seed'}
              icon={Hash}
              label={controls.seed != null ? `Seed ${String(controls.seed)}` : `Seed ${t('agent.seedRandom')}`}
              onClick={() => togglePanel('seed')}
            />
          )}
          {controls.audioControl && (
            <ToolButton
              active={activePanel === 'audio'}
              icon={Volume2}
              label={t(controls.audioValue ? 'parameters.audioOn' : 'parameters.audioOff')}
              onClick={() => togglePanel('audio')}
            />
          )}
          <ToolButton
            active={activePanel === 'batch'}
            icon={Layers3}
            label={`×${batchSize}`}
            onClick={() => togglePanel('batch')}
          />
          <ToolButton
            icon={LayoutTemplate}
            label={t('sessions.templates')}
            onClick={() => {
              setActivePanel(null);
              setShowTemplateModal(true);
            }}
          />
          <ToolButton
            icon={History}
            label={t('sessions.allHistory')}
            onClick={() => {
              setActivePanel(null);
              setShowHistoryDrawer(true);
            }}
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
