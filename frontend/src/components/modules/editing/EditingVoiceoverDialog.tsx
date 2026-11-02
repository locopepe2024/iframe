'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial } from '@/lib/editing';
import { extractErrorDetail } from '@/lib/utils';
import VoicePickerModal from '../cast/VoicePickerModal';

export default function EditingVoiceoverDialog({ onClose, onCreated }: {
  onClose: () => void; onCreated: (material: EditMaterial) => void;
}) {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [text, setText] = useState('');
  const [voice, setVoice] = useState({ id: '', name: '' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generate = async () => {
    if (!text.trim() || !voice.id || busy) return;
    setBusy(true); setError('');
    try { onCreated(await editing.synthesizeVoice(text.trim(), voice.id, speed)); }
    catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={t('生成配音', 'Generate voiceover')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-lg space-y-4 rounded-lg border border-glass-border bg-surface p-4 text-foreground">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t('生成配音', 'Generate voiceover')}</h2><button type="button" aria-label={t('关闭', 'Close')} disabled={busy} onClick={onClose}>×</button></div>
      <label className="block text-sm">{t('配音文本', 'Voiceover text')}<textarea className="glass-input mt-1 block w-full p-2" rows={5} maxLength={2000} value={text} onChange={event => setText(event.target.value)} /></label>
      <div className="flex items-center gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={() => setPickerOpen(true)}>{t('选择音色', 'Choose voice')}</button><span className="min-w-0 truncate text-sm text-text-secondary">{voice.name || t('未选择音色', 'No voice selected')}</span></div>
      <label className="block text-sm">{t('语速', 'Speed')} · {speed.toFixed(1)}<input className="mt-1 block w-full" type="range" min="0.5" max="2" step="0.1" value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="glass-button px-3 py-2" disabled={busy || !text.trim() || !voice.id} onClick={() => void generate()}>{busy ? t('生成中…', 'Generating…') : t('生成并加入对白轨', 'Generate and add dialogue')}</button></div>
    </div>
    <VoicePickerModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} characterName="" previewText={text.trim() || undefined} currentVoiceId={voice.id} onApply={(id, name) => setVoice({ id, name })} />
  </div>;
}
