'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { agentRequest, agentTranscribe, type AssemblyClip } from '@/lib/api';
import { editing } from '@/lib/editing';
import { extractErrorDetail } from '@/lib/utils';
import { transcriptDraft, type TranscriptCue } from './transcriptDraft';

export default function EditingTranscriptionDialog({ clip, onClose, onApply }: {
  clip: AssemblyClip; onClose: () => void; onApply: (cues: TranscriptCue[]) => void;
}) {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const sourceStart = clip.source_start_ms ?? 0;
  const sourceEnd = clip.source_end_ms ?? sourceStart + clip.timeline_end_ms - clip.timeline_start_ms;
  useEffect(() => {
    let active = true;
    agentRequest<{ available: boolean }>('/transcription-capability')
      .then(result => { if (active) setAvailable(result.available); })
      .catch(() => { if (active) setAvailable(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const transcribe = async () => {
    if (!clip.source_media_id || !available) return;
    setBusy(true); setError('');
    try {
      const audio = await editing.transcriptionAudio(clip.source_media_id, sourceStart, sourceEnd);
      const result = await agentTranscribe(new File([audio], 'source.wav', { type: 'audio/wav' }));
      const next = transcriptDraft(result.text, clip.timeline_start_ms, clip.timeline_end_ms);
      if (!next.length) throw new Error(t('未获得可用的字幕文字', 'No usable caption text was returned'));
      setCues(next);
    } catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  const update = (index: number, patch: Partial<TranscriptCue>) => setCues(items => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const valid = cues.length > 0 && cues.every((cue, index) => cue.text.trim().length > 0 && cue.text.length <= 2000
    && Number.isInteger(cue.start_ms) && Number.isInteger(cue.end_ms)
    && cue.start_ms >= clip.timeline_start_ms && cue.end_ms <= clip.timeline_end_ms
    && cue.end_ms > cue.start_ms && (index === 0 || cue.start_ms >= cues[index - 1].end_ms));
  return <div role="dialog" aria-modal="true" aria-label={t('原声转字幕', 'Source audio to captions')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg border border-glass-border bg-surface p-4 text-foreground">
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{t('原声转字幕', 'Source audio to captions')}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={t('关闭', 'Close')}>×</button></div>
      <p className="mb-3 text-xs text-text-secondary">{t('识别结果的分段时间是估计值。请逐条校对文字和时间，再加入新字幕轨。', 'Segment times are estimates. Review every line and time before adding a new caption track.')}</p>
      <button type="button" className="glass-button px-3 py-2" disabled={checking || !available || busy || sourceEnd - sourceStart > 60_000} onClick={() => void transcribe()}>{busy ? t('正在识别…', 'Transcribing…') : t('识别所选片段原声', 'Transcribe selected clip')}</button>
      {!checking && !available && <p role="status" className="mt-2 text-xs text-text-secondary">{t('当前用户未开放语音识别服务。', 'Speech recognition is unavailable for this account.')}</p>}
      {sourceEnd - sourceStart > 60_000 && <p role="status" className="mt-2 text-xs text-text-secondary">{t('请先把片段裁到 60 秒以内。', 'Trim this clip to 60 seconds or less first.')}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-4 space-y-2">{cues.map((cue, index) => <div key={index} className="flex flex-wrap items-start gap-2 border-b border-glass-border pb-2">
        <input aria-label={`${t('起点', 'Start')} ${index + 1}`} className="glass-input w-24 px-2 py-1" type="number" min={clip.timeline_start_ms / 1000} max={clip.timeline_end_ms / 1000} step="0.001" value={cue.start_ms / 1000} onChange={event => update(index, { start_ms: Math.round(Number(event.target.value) * 1000) })} />
        <input aria-label={`${t('终点', 'End')} ${index + 1}`} className="glass-input w-24 px-2 py-1" type="number" min={clip.timeline_start_ms / 1000} max={clip.timeline_end_ms / 1000} step="0.001" value={cue.end_ms / 1000} onChange={event => update(index, { end_ms: Math.round(Number(event.target.value) * 1000) })} />
        <textarea aria-label={`${t('字幕', 'Caption')} ${index + 1}`} className="glass-input min-w-40 flex-1 px-2 py-1" rows={2} maxLength={2000} value={cue.text} onChange={event => update(index, { text: event.target.value })} />
        <button type="button" aria-label={`${t('删除字幕', 'Remove caption')} ${index + 1}`} onClick={() => setCues(items => items.filter((_, i) => i !== index))}>×</button>
      </div>)}</div>
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="glass-button px-3 py-2" disabled={!valid || busy} onClick={() => onApply(cues)}>{t('加入字幕轨', 'Add caption track')}</button></div>
    </div>
  </div>;
}
