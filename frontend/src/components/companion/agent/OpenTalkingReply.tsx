"use client";

import { useEffect, useRef, useState } from "react";
import { companionPlayback } from "@/lib/companionPlaybackQueue";
import styles from "./chat.module.css";

export type SpokenReply = { id: string; text: string };
const base = (process.env.NEXT_PUBLIC_OPENTALKING_URL || "/opentalking-mock/api").replace(/\/$/, "");

type State = "idle" | "opening" | "ready" | "waiting" | "audio" | "blocked" | "error";
async function request<T>(path: string, signal?: AbortSignal, body?: object, method = body ? "POST" : "GET"): Promise<T> {
  const response = await fetch(base + path, {
    method, signal, credentials: "omit", headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`OpenTalking HTTP ${response.status}`);
  return response.json();
}

function waitForPeer(pc: RTCPeerConnection, signal: AbortSignal, gathering = false) {
  return new Promise<void>((resolve, reject) => {
    const event = gathering ? "icegatheringstatechange" : "connectionstatechange";
    const finish = (error?: Error) => {
      clearTimeout(timeout); pc.removeEventListener(event, check); signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error("语音连接已取消。"));
    const check = () => {
      if (signal.aborted) abort();
      else if (gathering ? pc.iceGatheringState === "complete" : pc.connectionState === "connected") finish();
      else if (["failed", "closed"].includes(pc.connectionState)) finish(new Error("WebRTC 连接失败。"));
    };
    const timeout = setTimeout(() => finish(new Error(gathering ? "媒体地址协商超时。" : "WebRTC 连接超时。")), gathering ? 12000 : 25000);
    signal.addEventListener("abort", abort, { once: true }); pc.addEventListener(event, check); check();
  });
}

/** One media session per chat page, independent of message-history reconciliation. */
export default function OpenTalkingReply({ reply, voice }: { reply: SpokenReply | null; voice?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>("idle"), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const enqueue = useRef<((reply: SpokenReply) => void) | null>(null);
  const pending = useRef<SpokenReply[]>([]), seen = useRef(new Set<string>());
  const failed = useRef<SpokenReply | null>(null);
  const interrupt = useRef<(() => void) | null>(null);
  const audible = useRef(false);
  const resumeAudio = useRef<(() => void) | null>(null);

  useEffect(() => {
    const lifetime = new AbortController(), owner = Symbol("opentalking-page");
    let session = "", peer: RTCPeerConnection | null = null, events: EventSource | null = null;
    let audio: AudioContext | null = null, source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null, animation = 0;
    let opening: Promise<void> | null = null;
    let active: { command: string; done: () => void; fail: (e: Error) => void; playing: () => void } | null = null;
    let playbackBlocked = false;
    const live = () => !lifetime.signal.aborted;
    resumeAudio.current = () => { void audio?.resume().catch(() => {}); };
    const deleteSession = (id: string) => fetch(`${base}/sessions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "omit", keepalive: true }).catch(() => {});
    const update = (next: State) => { if (live()) setState(next); };
    const mediaFailure = (message: string) => {
      if (!live()) return;
      setError(message); update("error");
      active?.fail(new Error(message)); companionPlayback.cancel(owner);
    };
    const open = async () => {
      update("opening");
      // Do not cancel the create HTTP request: even a late result must be deleted.
      const created = await request<{ session_id: string }>("/sessions", AbortSignal.timeout(30000), {
        avatar_id: "office-woman", model: "mock", agent_enabled: false,
        memory_enabled: false, knowledge_enabled: false, ...(voice ? { tts_voice: voice } : {}),
      });
      session = created.session_id;
      if (!live()) { await deleteSession(session); throw new Error("语音连接已取消。"); }
      await request(`/sessions/${session}/start`, lifetime.signal, {});
      const ice = await request<RTCConfiguration>("/sessions/webrtc/ice-config", lifetime.signal);
      if (!live()) throw new Error("语音连接已取消。");
      peer = new RTCPeerConnection(ice);
      const stream = new MediaStream();
      if (video.current) video.current.srcObject = stream;
      peer.ontrack = event => {
        if (!live()) return;
        if (!stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
        if (event.track.kind === "audio" && !audio) {
          audio = new AudioContext(); void audio.resume().catch(() => {});
          source = audio.createMediaStreamSource(new MediaStream([event.track]));
          analyser = audio.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const inspect = () => {
            if (!live() || !analyser) return;
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
            if (active && rms > .003) { audible.current = true; active.playing(); if (!playbackBlocked && video.current && !video.current.paused && !video.current.muted) update("audio"); }
            animation = requestAnimationFrame(inspect);
          };
          inspect();
        }
        void video.current?.play().catch(() => { playbackBlocked = true; update("blocked"); });
      };
      peer.onconnectionstatechange = () => {
        if (peer && ["failed", "disconnected"].includes(peer.connectionState)) mediaFailure("WebRTC 音频连接已中断，请重试。");
      };
      peer.addTransceiver("video", { direction: "recvonly" }); peer.addTransceiver("audio", { direction: "recvonly" });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForPeer(peer, lifetime.signal, true);
      const answer = await request<RTCSessionDescriptionInit>(`/sessions/${session}/webrtc/offer`, lifetime.signal, { sdp: peer.localDescription?.sdp, type: "offer" });
      await peer.setRemoteDescription(answer); await waitForPeer(peer, lifetime.signal);
      events = new EventSource(`${base}/sessions/${session}/events`);
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => { clearTimeout(timeout); lifetime.signal.removeEventListener("abort", abort); events?.removeEventListener("open", ready); error ? reject(error) : resolve(); };
        const ready = () => finish(), abort = () => finish(new Error("语音连接已取消。"));
        const timeout = setTimeout(() => finish(new Error("语音状态连接超时。")), 15000);
        lifetime.signal.addEventListener("abort", abort, { once: true });
        events!.addEventListener("open", ready, { once: true });
        if (!live()) abort();
      });
      events.addEventListener("speech.ended", event => {
        try { const data = JSON.parse((event as MessageEvent).data); if (active && data.utterance_id === active.command) active.done(); }
        catch { mediaFailure("语音状态无效，请重试。"); }
      });
      events.addEventListener("error", event => {
        // Named server errors carry JSON; transport errors have no data.
        const data = (event as MessageEvent).data;
        if (data) mediaFailure("OpenTalking 生成语音失败，请检查语音渠道后重试。");
        else mediaFailure("语音状态连接断开，请重试。");
      });
      update("ready");
    };
    const queueReply = (item: SpokenReply) => {
      companionPlayback.enqueue(owner, async (signal, playing) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        try {
          opening ??= open(); await opening;
          if (signal.aborted || !live()) return;
          // Do not consume a live WebRTC utterance while the browser blocks output.
          try {
            if (!video.current) throw new Error("播放器未就绪。");
            await video.current.play();
            playbackBlocked = false;
          } catch {
            playbackBlocked = true; failed.current = item; update("blocked"); return;
          }
          const command = `iframe-${crypto.randomUUID()}`;
          audible.current = false; update("waiting");
          const complete = new Promise<void>((resolve, reject) => {
            active = { command, playing, done: resolve, fail: reject };
            abort = () => {
              if (session) void request(`/sessions/${session}/interrupt`, undefined, {}).catch(() => {});
              resolve();
            };
            signal.addEventListener("abort", abort, { once: true });
            timeout = setTimeout(() => reject(new Error("未能确认本轮语音播放，请重试。")), 90000);
          });
          void complete.catch(() => {});
          // Claim playback before TTS to avoid capturing the first response syllable.
          playing();
          const sent = await request<{ status: string }>(`/sessions/${session}/speak`, lifetime.signal, {
            text: item.text, mode: "replace", render_text: true, command_id: command, ...(voice ? { voice } : {}),
          });
          if (!["queued", "duplicate"].includes(sent.status)) throw new Error("语音任务未入队，请重试。");
          await complete;
          if (!signal.aborted && live()) {
            if (!audible.current) { failed.current = item; setError("本轮尚未检测到有效音频，请点击播放或重试。"); update("blocked"); }
            else update("ready");
          }
        } catch (failure) {
          if (live() && !signal.aborted) {
            failed.current = item; setError(failure instanceof Error ? failure.message : "语音播放失败。"); update("error");
          }
        } finally {
          clearTimeout(timeout); if (abort) signal.removeEventListener("abort", abort); active = null;
        }
      });
    };
    enqueue.current = queueReply;
    interrupt.current = () => { companionPlayback.cancel(owner); update("ready"); };
    pending.current.splice(0).forEach(queueReply);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      lifetime.abort(); enqueue.current = null; interrupt.current = null; resumeAudio.current = null;
      companionPlayback.cancel(owner);
      active?.done(); events?.close(); peer?.close(); cancelAnimationFrame(animation);
      source?.disconnect(); void audio?.close().catch(() => {});
      if (video.current) { video.current.pause(); video.current.srcObject = null; }
      if (session) void deleteSession(session);
    };
    window.addEventListener("pagehide", dispose);
    return () => { window.removeEventListener("pagehide", dispose); dispose(); };
  }, [voice, retry]);

  useEffect(() => {
    if (!reply || seen.current.has(reply.id)) return;
    seen.current.add(reply.id);
    if (enqueue.current) enqueue.current(reply); else pending.current.push(reply);
  }, [reply]);
  return <section className={styles.openTalkingReply} aria-label="OpenTalking 语音回复">
    <video ref={video} autoPlay playsInline controls aria-label="数字人回复" />
    <p role="status">{state === "idle" ? "语音回复已开启" : state === "opening" ? "正在连接语音…" : state === "waiting" ? "正在准备回复声音…" : state === "audio" ? "已收到回复音频" : state === "ready" ? "语音已就绪" : state === "blocked" ? "请点击播放声音" : `文字已保留：${error}`}</p>
    {state === "blocked" && <button type="button" onClick={() => {
      resumeAudio.current?.();
      void video.current?.play().then(() => {
        if (failed.current) { const item = failed.current; failed.current = null; enqueue.current?.(item); }
        else setState("waiting");
      }).catch(() => { setError("浏览器仍未允许播放，请检查媒体权限。"); });
    }}>播放声音</button>}
    <button type="button" onClick={() => interrupt.current?.()}>打断语音</button>
    {state === "error" && <button type="button" onClick={() => {
      if (failed.current) { pending.current.unshift(failed.current); failed.current = null; }
      setError(""); setRetry(value => value + 1);
    }}>重试语音连接</button>}
  </section>;
}
