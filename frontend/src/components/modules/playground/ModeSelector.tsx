'use client';

import { useTranslations } from 'next-intl';
import { usePlaygroundStore, type PlaygroundMode } from './usePlaygroundStore';

const IMAGE_MODES: PlaygroundMode[] = ['t2i', 'i2i'];
const VIDEO_MODES: PlaygroundMode[] = ['t2v', 'i2v', 'r2v', 'v2v'];

export type PlaygroundOutputType = 'image' | 'video';

export function getOutputType(mode: PlaygroundMode): PlaygroundOutputType {
  return IMAGE_MODES.includes(mode) ? 'image' : 'video';
}

export function getDefaultModeForOutput(output: PlaygroundOutputType): PlaygroundMode {
  return output === 'image' ? 't2i' : 't2v';
}

export default function ModeSelector() {
  const t = useTranslations('playground');
  const mode = usePlaygroundStore((s) => s.mode);
  const setMode = usePlaygroundStore((s) => s.setMode);
  const outputType = getOutputType(mode);
  const visibleModes = outputType === 'image' ? IMAGE_MODES : VIDEO_MODES;

  const renderPill = (key: PlaygroundMode) => {
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
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-text-muted">
          {t('mode.outputType')}
        </legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-inset p-1 atelier-pill-tabs">
          {(['image', 'video'] as const).map((output) => {
            const active = outputType === output;
            return (
              <button
                key={output}
                type="button"
                onClick={() => setMode(getDefaultModeForOutput(output))}
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
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-text-muted">
          {t('mode.creationMethod')}
        </legend>
        <div className="flex gap-1 rounded-xl bg-surface-inset p-1 atelier-pill-tabs">
          {visibleModes.map(renderPill)}
        </div>
      </fieldset>
    </div>
  );
}
