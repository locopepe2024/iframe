'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial, type EditVoiceClone } from '@/lib/editing';
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
      setClones(items => [item, ...items]); setVoice({ id: item.id, name: item.name });
      setSample(null); setCloneName(''); setConsent(false);
    } catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!text.trim() || !voice.id || busy) return;
    setBusy(true); setError('');
    try { onCreated(await editing.synthesizeVoice(text.trim(), voice.id, speed)); }
    catch (cause) { setError(extractErrorDetail(cause)); }
    finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={t('生成配音', 'Generate voiceover')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-glass-border bg-surface p-4 text-foreground">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t('生成配音', 'Generate voiceover')}</h2><button type="button" aria-label={t('关闭', 'Close')} disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <label className="block text-sm">{t('配音文本', 'Voiceover text')}<textarea className="glass-input mt-1 block w-full p-2" rows={5} maxLength={2000} value={text} onChange={event => setText(event.target.value)} /></label>
      <div className="flex items-center gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={() => setPickerOpen(true)}>{t('选择音色', 'Choose voice')}</button><span className="min-w-0 truncate text-sm text-text-secondary">{voice.name || t('未选择音色', 'No voice selected')}</span></div>
      {clones.length > 0 && <label className="block text-sm">{t('我的复刻音色', 'My cloned voices')}<select className="glass-input mt-1 block w-full p-2" value={clones.some(item => item.id === voice.id) ? voice.id : ''} disabled={busy} onChange={event => { const item = clones.find(row => row.id === event.target.value); if (item) setVoice({ id: item.id, name: item.name }); }}><option value="">{t('选择复刻音色', 'Choose cloned voice')}</option>{clones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="space-y-2 border-t border-glass-border pt-3">
        <h3 className="text-sm font-medium">{t('复刻音色', 'Clone a voice')}</h3>
        <input className="glass-input w-full p-2 text-sm" aria-label={t('音色名称', 'Voice name')} placeholder={t('音色名称', 'Voice name')} maxLength={80} value={cloneName} onChange={event => setCloneName(event.target.value)} />
        <input type="file" className="block w-full text-sm" aria-label={t('录音样本', 'Recording sample')} accept=".mp3,.m4a,.wav" disabled={busy} onChange={event => setSample(event.target.files?.[0] || null)} />
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{t('我已获得录音中说话人的音色复刻授权', 'I have permission from the speaker to clone this voice')}</span></label>
        <button type="button" className="glass-button px-3 py-2 text-sm" disabled={busy || !sample || sample.size > 20 * 1024 * 1024 || !cloneName.trim() || !consent} onClick={() => void clone()}>{busy ? t('处理中…', 'Processing…') : t('创建复刻音色', 'Create cloned voice')}</button>
      </div>
      <label className="block text-sm">{t('语速', 'Speed')} · {speed.toFixed(1)}<input className="mt-1 block w-full" type="range" min="0.5" max="2" step="0.1" value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="glass-button px-3 py-2" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="glass-button px-3 py-2" disabled={busy || !text.trim() || !voice.id} onClick={() => void generate()}>{busy ? t('生成中…', 'Generating…') : t('生成并加入对白轨', 'Generate and add dialogue')}</button></div>
    </div>
    <VoicePickerModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} characterName="" previewText={text.trim() || undefined} currentVoiceId={voice.id} onApply={(id, name) => setVoice({ id, name })} />
  </div>;
}
