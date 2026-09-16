'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  MessageSquare,
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
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import ComposerControls, { getComposerControlState, type ComposerControl } from './ComposerControls';
import MediaInput from './MediaInput';
import { OutputTypeSelector, CreationMethodSelector } from './ModeSelector';
import ModelSelector from './ModelSelector';
import PromptInput from './PromptInput';
import { getOutputType } from './ModeSelector';
import { getModelDisplayInfo, usePlaygroundCatalogRevision } from './playgroundModels';
import { usePlaygroundStore } from './usePlaygroundStore';

type ComposerPanel = 'output' | 'model' | 'method' | 'reference' | ComposerControl | null;

interface AgentComposerProps {
  canGenerate: boolean;
  batchSize: number;
  onGenerate: () => void;
  agent?: { active: boolean; model: string; models: { api_model_id: string; display_name: string }[]; setModel: (value: string) => void; modelsLoading?: boolean; modelsError?: string; reloadModels?: () => void };
  onAgentChange?: (active: boolean) => void;
}

function shortSku(value: string): string { return value.length > 10 ? `${value.slice(0, 10)}...` : value; }

function ToolButton({
  active,
  label,
  icon: Icon,
  onClick,
  shorten = false,
}: {
  active?: boolean;
  shorten?: boolean;
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
      <span className="truncate" title={label}>{shorten ? shortSku(label) : label}</span>
    </button>
  );
}

export default function AgentComposer({ canGenerate, batchSize, onGenerate, agent, onAgentChange }: AgentComposerProps) {
  const t = useTranslations('playground');
  const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const mode = usePlaygroundStore((state) => state.mode);
  const modelId = usePlaygroundStore((state) => state.modelId);
  const parameters = usePlaygroundStore((state) => state.parameters);
  const prompt = usePlaygroundStore((state) => state.prompt);
  usePlaygroundCatalogRevision();
  const setShowHistoryDrawer = usePlaygroundStore((state) => state.setShowHistoryDrawer);
  const setShowTemplateModal = usePlaygroundStore((state) => state.setShowTemplateModal);
  const model = getModelDisplayInfo(modelId);
  const outputType = getOutputType(mode);
  const OutputIcon = agent?.active ? MessageSquare : outputType === 'image' ? ImageIcon : Video;
  const outputLabel = agent?.active ? 'Agent' : t(outputType === 'image' ? 'mode.outputImage' : 'mode.outputVideo');
  const controls = getComposerControlState(modelId, parameters, batchSize);
  const referenceLabel = t(`mode.${mode}`);
  const resolutionLabel = [controls.resolution, controls.duration != null ? `${controls.duration}s` : null]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => { setActivePanel(null); }, [agent?.active]);

  const panelTitle = activePanel
    ? activePanel === 'quality' ? t('parameters.quality') : activePanel === 'method' ? referenceLabel : t(`agent.${activePanel === 'output' ? 'typePanel' : activePanel === 'model' ? 'skuPanel' : activePanel === 'reference' ? 'referencePanel' : `${activePanel}Panel`}`)
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
              ['ratio', 'quality', 'method', 'seed', 'audio', 'batch'].includes(activePanel) && 'max-w-[360px]',
            )}
          >
            <div className="mb-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-secondary">
              {panelTitle}
            </div>
            {activePanel === 'output' && <OutputTypeSelector agentActive={agent?.active} onAgentChange={onAgentChange} />}
            {activePanel === 'model' && (agent?.active ? <div className="grid gap-2 sm:grid-cols-2">{agent.models.map(model => <button key={model.api_model_id} type="button" aria-pressed={agent.model === model.api_model_id} onClick={() => { agent.setModel(model.api_model_id); setActivePanel(null); }} className="rounded-xl border border-border-subtle p-3 text-left text-sm">{model.display_name}</button>)}{agent.modelsLoading ? <p role="status" className="text-sm text-text-muted">正在加载 Chat 模型…</p> : agent.modelsError ? <div role="alert" className="text-sm text-text-muted">{agent.modelsError}<button type="button" onClick={agent.reloadModels} className="ml-2 text-primary">重新加载模型</button></div> : !agent.models.length && <p className="text-sm text-text-muted">请在原设置入口获取并勾选 Chat 模型。</p>}</div> : <ModelSelector />)}
            {activePanel === 'method' && <CreationMethodSelector />}
            {activePanel === 'reference' && (
              <MediaInput agentMode={agent?.active} />
            )}
            {['resolution', 'ratio', 'quality', 'seed', 'audio', 'batch'].includes(activePanel) && (
              <ComposerControls control={activePanel as ComposerControl} />
            )}
          </div>
        )}

        <div className="px-4 pt-3 md:px-5 md:pt-4">
          <PromptInput
            onSubmit={handleSubmit}
            onOpenReferences={() => togglePanel('reference')}
          />
        </div>

        <div className="flex flex-nowrap items-center gap-1 overflow-x-auto border-t border-border-subtle px-2 py-2 md:px-3">
          <ToolButton
            active={activePanel === 'output'}
            icon={OutputIcon}
            label={outputLabel}
            onClick={() => togglePanel('output')}
          />
          <ToolButton
            shorten
            active={activePanel === 'model'}
            icon={Boxes}
            label={agent?.active ? (agent.models.find(m => m.api_model_id === agent.model)?.display_name || (agent.modelsLoading ? '加载模型中…' : agent.modelsError ? '模型加载失败' : t('agent.selectSku'))) : model?.displayName || modelId || t('agent.selectSku')}
            onClick={() => togglePanel('model')}
          />
          {!agent?.active && <>
          <ToolButton
            active={activePanel === 'method'}
            icon={mode === 't2i' || mode === 't2v' ? Workflow : Paperclip}
            label={referenceLabel}
            onClick={() => togglePanel('method')}
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
          {controls.quality && (
            <ToolButton active={activePanel === 'quality'} icon={SlidersHorizontal}
              label={controls.quality} onClick={() => togglePanel('quality')} />
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
          </>}
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

          <span aria-label="字数统计" className="ml-auto whitespace-nowrap font-mono text-[0.625rem] text-text-muted">{prompt.length} 字</span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canGenerate}
            aria-label={agent?.active ? '发送' : batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}
            className="inline-flex shrink-0 min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-accent shadow-[var(--glow-primary)] transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <ArrowUp size={17} aria-hidden="true" />
            <span className="hidden sm:inline">
              {agent?.active ? '发送' : batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}
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
