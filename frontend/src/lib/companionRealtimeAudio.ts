/** Streaming mono PCM16 transport. Provider input is 16 kHz, output is 24 kHz. */
export class PcmEncoder {
  private pending = new Float32Array(0);
  private offset = 0;
  constructor(private readonly rate: number) {
    if (!Number.isFinite(rate) || rate < 16000) throw new Error("不支持此麦克风采样率。");
  }
  encode(chunk: Float32Array): string {
    const samples = new Float32Array(this.pending.length + chunk.length);
    samples.set(this.pending); samples.set(chunk, this.pending.length);
    const step = this.rate / 16000;
    const pcm: number[] = [];
    while (this.offset + 1 < samples.length) {
      const index = Math.floor(this.offset), fraction = this.offset - index;
      const value = Math.max(-1, Math.min(1, samples[index] * (1 - fraction) + samples[index + 1] * fraction));
      const signed = Math.round(value * (value < 0 ? 32768 : 32767));
      pcm.push(signed & 255, (signed >> 8) & 255);
      this.offset += step;
    }
    const consumed = Math.floor(this.offset);
    this.pending = samples.slice(Math.min(consumed, samples.length));
    this.offset -= Math.min(consumed, samples.length);
    let binary = "";
    for (const byte of pcm) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

const captureProcessor = `class CompanionCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(Math.round(sampleRate*.02));this.used=0;}
  process(inputs){const input=inputs[0]?.[0];if(input)for(const value of input){this.buffer[this.used++]=value;if(this.used===this.buffer.length){this.port.postMessage(this.buffer);this.used=0;}}return true;}
} registerProcessor("companion-capture",CompanionCapture);`;

export async function captureMicrophone(context: AudioContext, stream: MediaStream, onAudio: (audio: string) => void) {
  const module = URL.createObjectURL(new Blob([captureProcessor], { type: "text/javascript" }));
  try { await context.audioWorklet.addModule(module); } finally { URL.revokeObjectURL(module); }
  const encoder = new PcmEncoder(context.sampleRate);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "companion-capture");
  const silent = context.createGain(); silent.gain.value = 0;
  node.port.onmessage = event => { const pcm = encoder.encode(event.data); if (pcm) onAudio(pcm); };
  source.connect(node); node.connect(silent); silent.connect(context.destination);
  return () => { node.port.onmessage = null; node.port.close(); source.disconnect(); node.disconnect(); silent.disconnect(); };
}

export class PcmPlayer {
  private until = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private pending: AudioBuffer[] = [];
  private pendingSeconds = 0;
  private buffering = true;
  private responseActive = false;
  private underruns = 0;
  private maxGapMs = 0;
  private maxArrivalIntervalMs = 0;
  private lastArrival: number | null = null;
  private receivedAudioSeconds = 0;
  private readonly reserveSeconds = .6;
  private readonly schedulingLead = .05;

  constructor(private readonly context: AudioContext, private readonly onIdle: () => void = () => {}) {}

  finishResponse() {
    this.responseActive = false;
    this.lastArrival = null;
    // A short response must not wait forever for the startup threshold.
    this.flush();
    this.buffering = true;
  }

  stats() {
    return {
      underruns: this.underruns,
      maxGapMs: Math.round(this.maxGapMs),
      maxArrivalIntervalMs: Math.round(this.maxArrivalIntervalMs),
      receivedAudioMs: Math.round(this.receivedAudioSeconds * 1000),
      startupBufferMs: this.reserveSeconds * 1000,
    };
  }

  isPlaying() { return this.pending.length > 0 || this.nodes.size > 0; }

  play(encoded: string) {
    const bytes = atob(encoded);
    if (!bytes.length || bytes.length % 2) throw new Error("语音数据无效。");
    const now = this.context.currentTime;
    const duration = bytes.length / 2 / 24000;
    if (Math.max(0, this.until - now) + this.pendingSeconds + duration > 15) {
      throw new Error("语音播放跟不上，已结束本次连接。");
    }
    if (this.lastArrival !== null) {
      this.maxArrivalIntervalMs = Math.max(this.maxArrivalIntervalMs, (now - this.lastArrival) * 1000);
    }
    this.lastArrival = now;
    this.receivedAudioSeconds += duration;
    if (!this.buffering && this.until <= now && this.responseActive) {
      this.underruns++;
      this.maxGapMs = Math.max(this.maxGapMs, (now - this.until) * 1000);
      this.buffering = true;
    }
    this.responseActive = true;
    const buffer = this.context.createBuffer(1, bytes.length / 2, 24000);
    const floats = buffer.getChannelData(0);
    for (let i = 0; i < floats.length; i++) {
      const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      floats[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
    this.pending.push(buffer);
    this.pendingSeconds += duration;
    if (!this.buffering || this.pendingSeconds + 1e-9 >= this.reserveSeconds) {
      this.flush();
      this.buffering = false;
    }
  }

  private flush() {
    if (!this.pending.length) return;
    // All buffered chunks share one continuous AudioContext timeline.
    const now = this.context.currentTime;
    let start = this.until > now ? this.until : now + this.schedulingLead;
    for (const buffer of this.pending) {
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.connect(this.context.destination);
      node.onended = () => {
        this.nodes.delete(node);
        node.disconnect();
        if (!this.isPlaying()) this.onIdle();
      };
      this.nodes.add(node);
      node.start(start);
      start += buffer.duration;
    }
    this.until = start;
    this.pending = [];
    this.pendingSeconds = 0;
  }

  clear() {
    for (const node of Array.from(this.nodes)) { node.onended = null; node.stop(); node.disconnect(); }
    this.nodes.clear();
    this.pending = [];
    this.pendingSeconds = 0;
    this.until = 0;
    this.responseActive = false;
    this.buffering = true;
    this.lastArrival = null;
  }
}
