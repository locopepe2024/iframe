"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { companionServices } from "@/lib/companionServices";
import { captureMicrophone, PcmPlayer } from "@/lib/companionRealtimeAudio";

export type VoiceLine = { id: string; role: "我" | "陪伴助手"; text: string };
export function useRealtimeVoice() {
  const [state, setState] = useState<"idle" | "connecting" | "listening" | "thinking" | "speaking">("idle");
  const [notice, setNotice] = useState("");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const generation = useRef(0), socket = useRef<WebSocket | null>(null), stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null), player = useRef<PcmPlayer | null>(null);
  const capture = useRef<(() => void) | null>(null), timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreAudio = useRef(false);
  const replyInProgress = useRef(false);
  const diagnosticsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const interruptions = useRef({ vadDuringPlayback: 0, manualInterrupts: 0 });
  const reportStats = useCallback(() => {
    const ws = socket.current, audio = context.current, playback = player.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !audio || !playback || ws.bufferedAmount > 256000) return;
    try {
      ws.send(JSON.stringify({ type: "playback.stats", stats: {
        ...playback.stats(), ...interruptions.current, sampleRate: audio.sampleRate,
        contextState: audio.state === "running" ? 1 : audio.state === "suspended" ? 2 : 3,
      } }));
    } catch { /* Diagnostics must not prevent microphone/socket cleanup. */ }
  }, []);
  const release = useCallback(() => {
    reportStats();
    generation.current++;
    replyInProgress.current = false;
    if (diagnosticsTimer.current) clearInterval(diagnosticsTimer.current);
    diagnosticsTimer.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    if (setupTimeout.current) clearTimeout(setupTimeout.current);
    timeout.current = null; setupTimeout.current = null;
    capture.current?.(); capture.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    const ws = socket.current; socket.current = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); }
    if (player.current) {
      console.info("Companion voice playback", player.current.stats());
      player.current.clear(); player.current = null;
    }
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
  }, [reportStats]);
  const stop = useCallback((message = "语音已结束。") => { release(); setState("idle"); setNotice(message); }, [release]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && context.current) stop("已暂停语音，返回页面后可重新开始。"); };
    document.addEventListener("visibilitychange", hidden);
    const leaving = () => { if (context.current) stop("语音已结束。"); };
    window.addEventListener("pagehide", leaving);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); release(); };
  }, [release, stop]);
  const start = useCallback(async () => {
    release(); const turn = generation.current;
    interruptions.current = { vadDuringPlayback: 0, manualInterrupts: 0 };
    setNotice(""); setLines([]); setState("connecting"); ignoreAudio.current = false;
    const current = () => generation.current === turn;
    const fail = (message: string) => { if (current()) stop(message); };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.WebSocket) throw new Error("这个浏览器暂不支持实时语音，请使用文字聊天。");
      const audio = new AudioContext(); context.current = audio;
      await audio.resume(); if (!current()) return;
      setupTimeout.current = setTimeout(() => fail("连接超时，请检查网络后重新开始。"), 30000);
      const ticket = await companionServices.realtimeTicket(); if (!current()) return;
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone; player.current = new PcmPlayer(audio, () => {
        if (current()) setState(old => old === "speaking" ? (replyInProgress.current ? "thinking" : "listening") : old);
      });
      const ws = new WebSocket(companionServices.realtimeUrl()); socket.current = ws;
      const append = (id: string, role: VoiceLine["role"], text: string, delta: boolean) => {
        if (!text) return;
        setLines(old => { const line = old.find(item => item.id === id); const next = { id, role, text: ((delta ? line?.text || "" : "") + text).slice(0, 6000) }; return (line ? old.map(item => item.id === id ? next : item) : [...old, next]).slice(-40); });
      };
      const confirmedInput = new Map<string,string>();
      ws.onopen = () => { if (current()) ws.send(JSON.stringify({ type: "authenticate", ticket: ticket.ticket })); };
      ws.onerror = () => fail("语音连接失败，请检查网络和 UniArt 渠道。");
      ws.onclose = () => fail("语音连接已断开，麦克风已关闭。请重新开始。");
      ws.onmessage = async message => {
        if (!current()) return;
        try {
          const event = JSON.parse(message.data);
          if (event.type === "ready") {
            if (capture.current) return;
            if (setupTimeout.current) clearTimeout(setupTimeout.current);
            timeout.current = setTimeout(() => fail("本次语音已到五分钟，可以重新开始。"), ticket.max_seconds * 1000);
            const endCapture = await captureMicrophone(audio, microphone, data => {
              if (!current() || ws.readyState !== WebSocket.OPEN) return;
              if (ws.bufferedAmount > 256000) { fail("网络较慢，已停止发送语音。请重新开始。"); return; }
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data }));
            });
            if (!current()) { endCapture(); return; }
            capture.current = endCapture; setState("listening");
            diagnosticsTimer.current = setInterval(reportStats, 10000);
          } else if (event.type === "error" || event.type === "ended") fail(event.message || "语音已结束。");
          else if (event.type === "input_audio_buffer.speech_started") {
            if (player.current?.isPlaying()) interruptions.current.vadDuringPlayback++;
            replyInProgress.current = false;
            ignoreAudio.current = true; player.current?.clear(); setState("listening");
          }
          else if (event.type === "input_audio_buffer.speech_stopped") setState("thinking");
          else if (event.type === "response.created") { replyInProgress.current = true; ignoreAudio.current = false; setState("thinking"); }
          else if (event.type === "response.audio.delta" && !ignoreAudio.current) { player.current?.play(event.delta); setState("speaking"); }
          else if (event.type === "response.done") {
            replyInProgress.current = false;
            player.current?.finishResponse();
            if (!player.current?.isPlaying()) setState("listening");
          }
          else if (event.type === "conversation.item.input_audio_transcription.delta") {
            const confirmed = (confirmedInput.get(event.item_id) || "") + (event.text || "");
            confirmedInput.set(event.item_id,confirmed);
            append(event.item_id,"我",confirmed + (event.stash || ""),false);
          }
          else if (event.type === "conversation.item.input_audio_transcription.completed") append(event.item_id, "我", event.transcript, false);
          else if (event.type === "response.audio_transcript.delta") append(event.item_id, "陪伴助手", event.delta, true);
          else if (event.type === "response.audio_transcript.done") append(event.item_id, "陪伴助手", event.transcript, false);
        } catch { fail("语音处理失败，请重新开始或使用文字聊天。"); }
      };
    } catch (error) {
      fail(error instanceof Error ? error.message : "无法使用麦克风，请检查权限。");
    }
  }, [release, stop, reportStats]);
  const interrupt = useCallback(() => {
    interruptions.current.manualInterrupts++;
    replyInProgress.current = false;
    ignoreAudio.current = true; player.current?.clear();
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "interrupt" }));
    setState("listening"); setNotice("已打断，您可以继续说。");
  }, []);
  return { state, active: state !== "idle", notice, lines, start, stop, interrupt };
}
