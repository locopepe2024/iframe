"use client";

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { useTranslations } from 'next-intl';
import VoicePickerModal from './VoicePickerModal';

type CharacterVoice = {
  id: string; name: string; gender?: string; description?: string;
  voice_id?: string | null; voice_name?: string | null;
};

/** Voice is character metadata, independent of visual design/AI drafts. */
export default function CharacterVoiceBinding({ character, seriesId, onSave }: {
  character: CharacterVoice; seriesId?: string | null;
  onSave?: (attributes: Record<string, unknown>) => void | Promise<void>;
}) {
  const t = useTranslations('voicePicker');
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState({ id: character.voice_id, name: character.voice_name });
  useEffect(() => {
    setVoice({ id: character.voice_id, name: character.voice_name });
  }, [character.id, character.voice_id, character.voice_name]);

  return <>
    <button type="button" disabled={!onSave} onClick={() => setOpen(true)}
      title={voice.name || voice.id || t('noSelection')}
      className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-md border border-glass-border px-2 text-xs text-text-secondary hover:bg-hover-bg hover:text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <AudioLines size={15} aria-hidden="true" />
      <span>{t('library')}</span>
      {voice.id && <span className="hidden max-w-24 truncate text-foreground sm:inline">{voice.name || voice.id}</span>}
    </button>
    {open && createPortal(<VoicePickerModal isOpen onClose={() => setOpen(false)}
      characterName={character.name} characterGender={character.gender}
      characterDescription={character.description} seriesId={seriesId} currentVoiceId={voice.id || undefined}
      onApply={async (id, name) => {
        if (!onSave) throw new Error(t('saveFailed'));
        await onSave({ voice_id: id, voice_name: name });
        setVoice({ id, name });
      }} />, document.body)}
  </>;
}
