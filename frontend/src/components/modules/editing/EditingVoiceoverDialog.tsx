'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial, type EditVoiceClone } from '@/lib/editing';
import { extractErrorDetail, getAssetUrl } from '@/lib/utils';
import VoicePickerModal from '../cast/VoicePickerModal';
import { EditingProjectDialog } from './EditingProjectControls';

export default function EditingVoiceoverDialog({ onClose, targetDurationMs, onCreated }: {
  onClose: () => void; targetDurationMs: number; onCreated: (material: EditMaterial, startMs: number, trimTail: boolean) => void;
}) {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [text, setText] = useState('');
  const [voice, setVoice] = useState({ id: '', name: '' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<EditMaterial | null>(null);
  const [startSeconds, setStartSeconds] = useState('0');
  const [trimConfirmed, setTrimConfirmed] = useState(false);
  const [clones, setClones] = useState<EditVoiceClone[]>([]);
  const [sample, setSample] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    let active = true;
    editing.voiceClones().then(items => { if (active) setClones(items); })
      .catch(cause => { if (active) setError(extractErrorDetail(cause)); });
    return () => { active = false; };
  }, []);
  const clone = async () => {
    if (!sample || !cloneName.trim() || !consent || busy) return;
    setBusy(true); setError('');
    try {
      const item = await editing.cloneVoice(sample, cloneName.trim(), consent);
      setClones(items => [item, ...items]); setVoice({ id: item.id, name: item.name }); invalidateGenerated();
      setSample(null); setCloneName(''); setConsent(false);
    } catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!text.trim() || !voice.id || busy) return;
    setBusy(true); setError('');
    try { setGenerated(await editing.synthesizeVoice(text.trim(), voice.id, speed)); setTrimConfirmed(false); }
    catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  const parsedStartSeconds = startSeconds.trim() === '' ? Number.NaN : Number(startSeconds);
  const startMs = Math.round(parsedStartSeconds * 1000);
  const availableMs = Math.max(0, targetDurationMs - startMs);
  const trimMs = generated ? Math.max(0, generated.duration_ms - availableMs) : 0;
  const canPlace = Boolean(generated && Number.isFinite(parsedStartSeconds) && Number.isFinite(startMs) && startMs >= 0 && startMs < targetDurationMs && (!trimMs || trimConfirmed));
  const changePlacement = (value: string) => { setStartSeconds(value); setTrimConfirmed(false); };
  const invalidateGenerated = () => { setGenerated(null); setTrimConfirmed(false); };
  return <EditingProjectDialog title={t('生成配音', 'Generate voiceover')} closeLabel={t('关闭', 'Close')} busy={busy} initialFocus="textarea" size="lg" onClose={() => { if (pickerOpen) setPickerOpen(false); else onClose(); }}>
      <label className="block text-sm">{t('配音文本', 'Voiceover text')}<textarea className="glass-input mt-1 block w-full p-2 disabled:opacity-50" rows={5} maxLength={2000} disabled={busy} value={text} onChange={event => { setText(event.target.value); invalidateGenerated(); }} /></label>
      <div className="flex items-center gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={() => setPickerOpen(true)}>{t('选择音色', 'Choose voice')}</button><span className="min-w-0 truncate text-sm text-text-secondary">{voice.name || t('未选择音色', 'No voice selected')}</span></div>
      {clones.length > 0 && <label className="block text-sm">{t('我的复刻音色', 'My cloned voices')}<select className="glass-input mt-1 block w-full p-2" value={clones.some(item => item.id === voice.id) ? voice.id : ''} disabled={busy} onChange={event => { const item = clones.find(row => row.id === event.target.value); if (item) { setVoice({ id: item.id, name: item.name }); invalidateGenerated(); } }}><option value="">{t('选择复刻音色', 'Choose cloned voice')}</option>{clones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="space-y-2 border-t border-glass-border pt-3">
        <h3 className="text-sm font-medium">{t('复刻音色', 'Clone a voice')}</h3>
        <input className="glass-input w-full p-2 text-sm" aria-label={t('音色名称', 'Voice name')} placeholder={t('音色名称', 'Voice name')} maxLength={80} disabled={busy} value={cloneName} onChange={event => setCloneName(event.target.value)} />
        <input type="file" className="block w-full text-sm" aria-label={t('录音样本', 'Recording sample')} accept=".mp3,.m4a,.wav" disabled={busy} onChange={event => setSample(event.target.files?.[0] || null)} />
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{t('我已获得录音中说话人的音色复刻授权', 'I have permission from the speaker to clone this voice')}</span></label>
        <button type="button" className="glass-button px-3 py-2 text-sm" disabled={busy || !sample || sample.size > 20 * 1024 * 1024 || !cloneName.trim() || !consent} onClick={() => void clone()}>{busy ? t('处理中…', 'Processing…') : t('创建复刻音色', 'Create cloned voice')}</button>
      </div>
      <label className="block text-sm">{t('语速', 'Speed')} · {speed.toFixed(1)}<input className="mt-1 block w-full" type="range" min="0.5" max="2" step="0.1" disabled={busy} value={speed} onChange={event => { setSpeed(Number(event.target.value)); invalidateGenerated(); }} /></label>
      {generated && <div className="space-y-2 rounded border border-glass-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{t('生成结果试听', 'Preview generated voiceover')}</span><span className="text-text-secondary">{(generated.duration_ms / 1000).toFixed(2)}s</span></div>
        <audio controls preload="metadata" src={getAssetUrl(generated.url)} aria-label={t('生成配音试听', 'Generated voiceover preview')} className="h-9 w-full" />
        <label className="block text-sm">{t('放置起点（秒）', 'Placement start (seconds)')}<input className="glass-input mt-1 h-10 w-full px-2" type="number" min="0" max={Math.max(0, (targetDurationMs - 1) / 1000)} step="0.01" value={startSeconds} onChange={event => changePlacement(event.target.value)} /></label>
        {trimMs > 0 && <div className="space-y-2 text-sm text-amber-200">
          <p>{t(`从该起点到成片结尾仅剩 ${(availableMs / 1000).toFixed(2)} 秒，将裁掉配音尾部 ${(trimMs / 1000).toFixed(2)} 秒。`, `Only ${(availableMs / 1000).toFixed(2)}s remain from this start; ${(trimMs / 1000).toFixed(2)}s will be trimmed from the voiceover tail.`)}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={trimConfirmed} onChange={event => setTrimConfirmed(event.target.checked)} /><span>{t('确认裁掉显示的配音尾部时长', 'Confirm trimming the stated voiceover tail')}</span></label>
        </div>}
        <button type="button" className="glass-button min-h-10 px-3 text-sm disabled:opacity-40" disabled={!canPlace || busy} onClick={() => onCreated(generated, startMs, trimMs > 0)}>{trimMs > 0 ? t('按确认时长裁尾并加入对白轨', 'Trim as confirmed and add to dialogue') : t('加入对白轨', 'Add to dialogue track')}</button>
      </div>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="glass-button px-3 py-2" disabled={busy || !text.trim() || !voice.id} onClick={() => void generate()}>{busy ? t('生成中…', 'Generating…') : generated ? t('重新生成试听', 'Regenerate preview') : t('生成配音试听', 'Generate voiceover preview')}</button></div>
    <VoicePickerModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} characterName="" previewText={text.trim() || undefined} currentVoiceId={voice.id} onApply={(id, name) => { setVoice({ id, name }); invalidateGenerated(); }} />
  </EditingProjectDialog>;
}
