'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { agentRequest, agentTranscribe } from '@/lib/api';

function wavFile(buffer: AudioBuffer): File {
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  for (let index = 0; index < samples; index++) {
    const value = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new File([bytes], 'recording.wav', { type: 'audio/wav' });
}

export default function VoiceTranscriptionButton({ onTranscribed }: { onTranscribed: (text: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
    let live = true;
    agentRequest<{ available: boolean }>('/transcription-capability')
      .then(result => { if (live) setAvailable(result.available); })
      .catch(() => { if (live) setAvailable(false); });
    return () => {
      live = false; mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const start = async () => {
    setError('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const next = new MediaRecorder(media);
      stream.current = media;
      recorder.current = next;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach(track => track.stop());
        stream.current = null;
        if (!mounted.current) return;
        setRecording(false);
        setBusy(true);
        try {
          const encoded = await new Blob(chunks, { type: next.mimeType }).arrayBuffer();
          const context = new AudioContext();
          let decoded: AudioBuffer;
          try { decoded = await context.decodeAudioData(encoded); }
          finally { await context.close(); }
          const result = await agentTranscribe(wavFile(decoded));
          if (mounted.current) onTranscribed(result.text);
        } catch (cause) {
          if (mounted.current) setError(cause instanceof Error ? cause.message : '语音识别失败，请重试');
        } finally { if (mounted.current) setBusy(false); recorder.current = null; }
      };
      next.start();
      timer.current = setTimeout(() => { if (next.state === 'recording') next.stop(); }, 60_000);
      setRecording(true);
    } catch { setError('无法使用麦克风，请检查浏览器权限'); }
  };

  if (!available) return null;
  return <div className="flex shrink-0 items-center gap-2">
    <button type="button" onClick={() => recording ? recorder.current?.stop() : void start()} disabled={busy}
      aria-label={recording ? '停止录音并识别' : '开始语音输入'} title={recording ? '停止录音并识别' : '开始语音输入'}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50">
      {busy ? <Loader2 size={18} className="animate-spin" /> : recording ? <Square size={16} /> : <Mic size={18} />}
    </button>
    {(recording || busy) && <span role="status" className="whitespace-nowrap text-xs text-text-muted">{recording ? '正在录音，点击停止' : '正在识别语音…'}</span>}
    {error && <span role="alert" className="text-xs text-status-failed-fg">{error}</span>}
  </div>;
}
