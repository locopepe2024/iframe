'use client';

import { useTranslations } from 'next-intl';
import { usePlaygroundStore, type PlaygroundMode } from './usePlaygroundStore';
import { getDefaultModelForMode, getModelCapabilities, usePlaygroundCatalogRevision } from './playgroundModels';

const IMAGE_MODES: PlaygroundMode[] = ['t2i', 'i2i'];
const VIDEO_MODES: PlaygroundMode[] = ['t2v', 'i2v', 'r2v', 'f2v'];

export type PlaygroundOutputType = 'image' | 'video';

export function getOutputType(mode: PlaygroundMode): PlaygroundOutputType {
  return IMAGE_MODES.includes(mode) ? 'image' : 'video';
}

export function getDefaultModeForOutput(output: PlaygroundOutputType): PlaygroundMode {
  return output === 'image' ? 't2i' : 't2v';
}

export function OutputTypeSelector({ agentActive = false, onAgentChange }: { agentActive?: boolean; onAgentChange?: (value: boolean) => void } = {}) {
  const t = useTranslations('playground');
  const mode = usePlaygroundStore((s) => s.mode);
  const setMode = usePlaygroundStore((s) => s.setMode);
  const setModelId = usePlaygroundStore((s) => s.setModelId);
  const modelId = usePlaygroundStore((s) => s.modelId);
  const outputType = getOutputType(mode);

  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-inset p-1 atelier-pill-tabs">
      {onAgentChange && <button type="button" aria-pressed={agentActive} onClick={() => onAgentChange(true)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${agentActive ? 'bg-surface text-foreground' : 'text-text-muted'}`}>Agent</button>}
      {(['video', 'image'] as const).map((output) => {
        const active = !agentActive && outputType === output;
        return (
          <button
            key={output}
            type="button"
            onClick={() => {
              onAgentChange?.(false);
              const nextMode = getDefaultModeForOutput(output);
              setMode(nextMode);
              if (!getModelCapabilities(modelId).includes(nextMode)) {
                setModelId(getDefaultModelForMode(nextMode));
              }
            }}
            aria-pressed={active}
            className={[
              'min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              active
                ? 'bg-surface text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.4)] atelier-pill-tab-active'
                : 'text-text-muted hover:bg-hover-bg hover:text-foreground',
            ].join(' ')}
          >
            {t(`mode.output${output === 'image' ? 'Image' : 'Video'}`)}
          </button>
        );
      })}
    </div>
  );
}

export function CreationMethodSelector() {
  const t = useTranslations('playground');
  const mode = usePlaygroundStore((s) => s.mode);
  const modelId = usePlaygroundStore((s) => s.modelId);
  const setMode = usePlaygroundStore((s) => s.setMode);
  usePlaygroundCatalogRevision();
  const outputType = getOutputType(mode);
  const modelCapabilities = getModelCapabilities(modelId);
  const outputModes = outputType === 'image' ? IMAGE_MODES : VIDEO_MODES;
  const visibleModes = outputModes.filter((candidate) => modelCapabilities.includes(candidate));
  const modes = visibleModes.length > 0 ? visibleModes : outputModes.filter((candidate) => candidate === mode);

  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-inset p-1 atelier-pill-tabs sm:flex">
      {modes.map((key) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={active}
            className={[
              'min-h-11 flex-1 cursor-pointer rounded-xl px-3 py-2 text-center text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              active
                ? 'bg-surface text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.4)] atelier-pill-tab-active'
                : 'text-text-muted hover:text-foreground hover:bg-hover-bg',
            ].join(' ')}
          >
            {t(`mode.${key}`)}
          </button>
        );
      })}
    </div>
  );
}

export default function ModeSelector() {
  return (
    <div className="space-y-4">
      <OutputTypeSelector />
      <CreationMethodSelector />
    </div>
  );
}
