import React from "react";
import { createRoot } from "react-dom/client";
import DiaryEditor from "../../frontend/src/components/companion/agent/DiaryEditor";
import { diaryVoiceCommand } from "../../frontend/src/components/companion/agent/diaryVoiceCommand";

const probe: any = { events: [], saves: [], captures: [], activeTracks: [] };
(window as any).probe = probe;
const log = (type: string, detail: unknown = null) => probe.events.push({ type, at_ms: Math.round(performance.now()), detail });
const browser = window as any;
const Native = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
probe.nativeRecognitionAvailable = !!Native;
// Transparent construction instrumentation: recognition and its results remain native.
if (Native) {
  browser.SpeechRecognition = new Proxy(Native, { construct(target, args) {
    const instance = Reflect.construct(target, args);
    for (const event of ["start", "audiostart", "soundstart", "speechstart", "speechend", "audioend", "end", "error", "result"]) {
      instance.addEventListener(event, (value: any) => log(event,
        event === "error" ? { error: value.error, message: value.message } :
          event === "result" ? { resultIndex: value.resultIndex, results: Array.from(value.results).map((r: any) => ({ text: r[0]?.transcript, final: r.isFinal })) } : null));
    }
    return instance;
  }});
}

function wav(samples: Float32Array, rate: number) {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, "RIFF"); data.setUint32(4, 36 + samples.length * 2, true); word(8, "WAVE"); word(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  word(36, "data"); data.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767), true));
  return new Blob([data.buffer], { type: "audio/wav" });
}
probe.capture = async (milliseconds: number) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  probe.activeTracks = stream.getTracks();
  const context = new AudioContext({ sampleRate: 16000 });
  let source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined;
  try {
    await context.resume();
    source = context.createMediaStreamSource(stream);
    // Diagnostic-only raw PCM tap; no ScriptProcessor is added to the product.
    processor = context.createScriptProcessor(1024, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor); processor.connect(context.destination);
    await new Promise(resolve => setTimeout(resolve, milliseconds));
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const rms = Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length);
    const settings = stream.getAudioTracks()[0].getSettings();
    const audio = wav(samples, context.sampleRate);
    const record: any = { duration_seconds: samples.length / context.sampleRate, rms, sample_rate: context.sampleRate,
      settings: { sampleRate: settings.sampleRate, channelCount: settings.channelCount, echoCancellation: settings.echoCancellation },
      source: "Chrome file-backed virtual microphone" };
    // Release capture BEFORE inference, so network delays cannot hold the device open.
    stream.getTracks().forEach(track => track.stop());
    record.track_states_after_stop = stream.getTracks().map(track => track.readyState);
    const form = new FormData(); form.append("file", audio, "synthetic-capture.wav");
    const started = performance.now();
    try {
      const response = await fetch("/analyze", { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
      record.http_status = response.status; record.asr = await response.json();
      record.command = response.ok && record.asr.text?.trim() ? diaryVoiceCommand(record.asr.text) : null;
    } catch (error) { record.network_error = error instanceof Error ? error.name : "unknown"; }
    record.roundtrip_ms = Math.round(performance.now() - started);
    probe.captures.push(record); return record;
  } finally {
    stream.getTracks().forEach(track => track.stop());
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect(); await context.close();
  }
};
const root = createRoot(document.getElementById("root")!);
root.render(<DiaryEditor initialText="合成测试草稿。" busy={false} error="" onSave={text => probe.saves.push(text)} onCancel={() => log("editor_cancel")} />);
probe.unmount = () => { root.unmount(); return { tracks: probe.activeTracks.map((t: MediaStreamTrack) => t.readyState), events: probe.events.length }; };
probe.ready = true;
