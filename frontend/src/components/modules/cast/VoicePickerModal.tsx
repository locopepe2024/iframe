"use client";
// UniArt gateway voice library; legacy bindings are retained until explicitly replaced.
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Pause, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, type VoiceMeta } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
interface VoicePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    characterName: string;
    characterGender?: string;
    /** Sample text override — pass character's actual dialogue when available
     *  (Q5 A3 preferred). When null/undefined, uses character-name template. */
    previewText?: string;
    currentVoiceId?: string;
    onApply: (voiceId: string, voiceName: string) => void | Promise<void>;
    /** Retained for callers; gateway voices are owner-scoped, not series-scoped. */
    seriesId?: string | null;

    characterDescription?: string;
}



export default function VoicePickerModal({
    isOpen,
    onClose,
    characterName,
    previewText,
    currentVoiceId,
    onApply,
    seriesId,
}: VoicePickerModalProps) {
    const t = useTranslations("voicePicker");
    const [voices, setVoices] = useState<VoiceMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const savingRef = useRef(false);
    const [selectedId, setSelectedId] = useState<string | undefined>(currentVoiceId);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const previewRequest = useRef(0);

    useEffect(() => () => {
        previewRequest.current++;
        audioRef.current?.pause();
        audioRef.current = null;
    }, []);

    // Sync selected when current changes / modal opens
    useEffect(() => {
        if (isOpen) { setSelectedId(currentVoiceId); setSaveError(null); }
    }, [isOpen, currentVoiceId]);

    // Load voices once when modal opens
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setVoices([]);
        setPreviewError(null);
        api.getVoices().then(vs => { if (!cancelled) setVoices(vs.filter(v => v.family === "minimax" && ["speech-2.8-hd", "speech-2.8-turbo"].includes(v.model))); })
            .catch((e) => { if (!cancelled) setError(e?.message || t("loadFailed")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, seriesId]);

    // Stop any in-flight audio when closing
    useEffect(() => {
        if (!isOpen) {
            previewRequest.current++;
            audioRef.current?.pause();
            audioRef.current = null;
            setPlayingId(null);
            setPreviewingId(null);
        }
    }, [isOpen]);

    // Preview sample text — Q5 A2 fallback when character has no dialogue yet.
    // Prefer explicit previewText (Q5 A3); otherwise build from character name.
    const sampleText =
        previewText ||
        (characterName
            ? t("previewTextNamed", { name: characterName })
            : t("previewTextDefault"));

    // Preview and dialogue both use the stable gateway model/voice binding.
    const handlePreviewById = async (voiceId: string) => {
        const request = ++previewRequest.current;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
            if (playingId === voiceId) {
                setPlayingId(null);
                return;  // toggle off
            }
            setPlayingId(null);
        }
        setPreviewingId(voiceId);
        setPreviewError(null);
        try {
            const { url } = await api.previewVoice({
                voice_id: voiceId,
                text: sampleText,
            });
            if (request !== previewRequest.current) return;
            const audio = new Audio(getAssetUrl(url));
            audio.onended = () => {
                setPlayingId(null);
                if (audioRef.current === audio) audioRef.current = null;
            };
            audio.onerror = () => {
                setPlayingId(null);
                setPreviewError(t("playFailed"));
            };
            audioRef.current = audio;
            setPlayingId(voiceId);
            await audio.play();
        } catch (e: any) {
            if (request === previewRequest.current) { setPlayingId(null); setPreviewError(e?.message || t("previewFailed")); }
        } finally {
            if (request === previewRequest.current) setPreviewingId(null);
        }
    };

    const handlePreview = (voice: VoiceMeta) => handlePreviewById(voice.id);
    const groups = useMemo(() => Array.from(new Set(voices.map(v => v.model)))
        .map(model => ({ model, voices: voices.filter(v => v.model === model) })), [voices]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-overlay backdrop-blur-sm" onClick={() => { if (!savingRef.current) onClose(); }}>
            <div
                role="dialog" aria-modal="true" aria-label={t("title")}
                className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-glass-border">
                    <div className="flex items-center gap-3 min-w-0">
                        <h2 className="text-display font-medium text-foreground truncate">
                            {t("title")}
                            <span className="ml-2 text-text-muted">— {characterName}</span>
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={saving}
                        aria-label={t("close")}
                        className="p-2 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                    {loading && (
                        <div className="grid place-items-center py-12 text-text-muted">
                            <Loader2 className="animate-spin" size={20} />
                        </div>
                    )}
                    {error && (
                        <div className="rounded-md border border-status-failed-border bg-status-failed-bg p-3 text-body-sm text-status-failed-fg" role="alert">
                            {error}
                        </div>
                    )}

                    {!loading && !error && currentVoiceId && !voices.some(v => v.id === currentVoiceId) &&
                        <p className="mb-3 text-sm text-text-secondary">{t("legacyReselect")}</p>}
                    {!loading && !error && !voices.length && <p className="text-sm text-text-secondary">{t("gatewayEmpty")}</p>}
                    {!loading && !error && <div className="space-y-5">
                        {groups.map(group => <VoiceGroup key={group.model}
                            label={`UniArt · MiniMax ${group.model.endsWith('-hd') ? 'HD' : 'Turbo'}`}
                            voices={group.voices} selectedId={selectedId} playingId={playingId} previewingId={previewingId}
                            onSelect={setSelectedId} onPreview={handlePreview} />)}
                    </div>}
                    {previewError && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{previewError}</p>}

                </div>

                {saveError && <p role="alert" className="px-6 py-2 text-sm text-status-failed-fg">{saveError}</p>}
                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-glass-border">
                    <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-text-muted">
                        {voices.find(v => v.id === selectedId)?.name || t("noSelection")}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            disabled={saving}
                            className="inline-flex items-center px-4 py-2 rounded-md bg-glass border border-glass-border text-text-secondary hover:text-foreground hover:bg-hover-bg transition-colors text-[0.75rem]"
                        >
                            {t("cancel")}
                        </button>
                        <button
                            onClick={async () => {
                                if (!selectedId || savingRef.current) return;
                                // Only an available gateway voice can be applied.
                                const systemMeta = voices.find(v => v.id === selectedId);
                                if (!systemMeta) return;
                                const name = systemMeta.name;
                                savingRef.current = true;
                                setSaving(true);
                                setSaveError(null);
                                try {
                                    await onApply(selectedId, name);
                                    onClose();
                                } catch (e) {
                                    setSaveError(e instanceof Error ? e.message : t('saveFailed'));
                                } finally {
                                    savingRef.current = false;
                                    setSaving(false);
                                }
                            }}
                            disabled={saving || !voices.some(v => v.id === selectedId) || selectedId === currentVoiceId}
                            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white border border-[rgba(100,108,255,0.65)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[0.75rem] font-semibold"
                        >
                            {saving ? t("saving") : t("apply")}
                        </button>
                    </div>
                </div>
            </div>


        </div>
    );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function VoiceGroup({
    label,
    voices,
    selectedId,
    playingId,
    previewingId,
    onSelect,
    onPreview,
}: {
    label: string;
    voices: VoiceMeta[];
    selectedId?: string;
    playingId: string | null;
    previewingId: string | null;
    onSelect: (id: string) => void;
    onPreview: (voice: VoiceMeta) => void;
}) {
    if (!voices.length) return null;
    return (
        <section>
            <h3 className="mb-2 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                {label} <span className="text-text-muted/60">({voices.length})</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {voices.map((v) => (
                    <VoiceCard
                        key={v.id}
                        voice={v}
                        selected={selectedId === v.id}
                        playing={playingId === v.id}
                        previewing={previewingId === v.id}
                        onSelect={() => onSelect(v.id)}
                        onPreview={() => onPreview(v)}
                    />
                ))}
            </div>
        </section>
    );
}

function localizedGender(
    gender: string | undefined,
    t: (key: string) => string,
): string {
    const normalized = (gender || "").trim().toLowerCase();
    if (normalized === "male" || normalized === "m" || gender === "男") return t("genderMale");
    if (normalized === "female" || normalized === "f" || gender === "女") return t("genderFemale");
    return gender?.trim() || t("genderUnknown");
}

function VoiceCard({
    voice,
    selected,
    playing,
    previewing,
    onSelect,
    onPreview,
}: {
    voice: VoiceMeta;
    selected: boolean;
    playing: boolean;
    previewing: boolean;
    onSelect: () => void;
    onPreview: () => void;
}) {
    const t = useTranslations("voicePicker");
    return (
        <div
            role="radio" aria-checked={selected} tabIndex={0}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
            onClick={onSelect}
            className={`relative cursor-pointer rounded-lg border p-3 transition-colors ${
                selected
                    ? "border-primary bg-[rgba(100,108,255,0.10)]"
                    : "border-glass-border bg-glass hover:border-foreground/30"
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-medium text-foreground" title={voice.name}>
                        {voice.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-text-muted">
                        {localizedGender(voice.gender, t)}
                        {voice.dialect ? ` · ${voice.dialect}` : ""}
                        {voice.lang_primary ? ` · ${voice.lang_primary}` : ""}
                        {voice.supports_instruction ? ` · ${t("supportsInstruction")}` : ""}
                    </p>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onPreview(); }}
                    aria-label={playing ? t("previewStop") : t("previewPlay")}
                    className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                        playing
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-glass-border bg-black/30 text-text-secondary hover:border-foreground/30 hover:text-foreground"
                    }`}
                >
                    {previewing ? (
                        <Loader2 size={12} className="animate-spin" />
                    ) : playing ? (
                        <Pause size={12} />
                    ) : (
                        <Play size={12} />
                    )}
                </button>
            </div>
            {selected && (
                <div className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-white">
                    <Check size={11} strokeWidth={2.5} />
                </div>
            )}
        </div>
    );
}
