"use client";

import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceOptions = { continuous?: boolean; onFinalTranscript?: (text: string) => void };
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
let activeVoice: { id: symbol; stop: () => void } | null = null;

export function useCompanionVoice(onTranscript: (text: string) => void, options: VoiceOptions = {}) {
  const owner = useRef(Symbol("companion-voice"));
  const [listening, setListening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const restartTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepListening = useRef(false);
  const finishingRef = useRef(false);
  const transcriptCallback = useRef(onTranscript);
  const finalCallback = useRef(options.onFinalTranscript);
  const continuous = options.continuous ?? false;
  transcriptCallback.current = onTranscript;
  finalCallback.current = options.onFinalTranscript;

  function dispose() {
    clearTimeout(timer.current);
    clearTimeout(restartTimer.current);
    keepListening.current = false;
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onend = current.onerror = current.onresult = null;
      current.abort();
    }
    if (activeVoice?.id === owner.current && !utteranceRef.current) activeVoice = null;
  }
  function cancelSpeech() {
    if (utteranceRef.current) {
      utteranceRef.current.onend = utteranceRef.current.onerror = null;
      utteranceRef.current = null;
      window.speechSynthesis?.cancel();
    }
    if (activeVoice?.id === owner.current && !recognition.current) activeVoice = null;
  }
  function stopAll() {
    keepListening.current = false;
    finishingRef.current = false;
    dispose(); cancelSpeech();
    setListening(false); setFinishing(false); setSpeaking(false);
  }
  function claimVoice() {
    if (activeVoice && activeVoice.id !== owner.current) activeVoice.stop();
    activeVoice = { id: owner.current, stop: stopAll };
  }
  useEffect(() => () => {
    dispose();
    cancelSpeech();
  }, []);

  function toggleListening() {
    if (recognition.current || keepListening.current) {
      if (finishingRef.current) return;
      if (!recognition.current) { stopAll(); setNotice("已停止语音聊天。"); return; }
      keepListening.current = false;
      finishingRef.current = true;
      setFinishing(true);
      setNotice("正在结束听写，请稍等。");
      // stop() requests the final result; abort() would discard pending speech.
      recognition.current.stop();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        dispose(); setListening(false); setFinishing(false);
        finishingRef.current = false;
        setNotice("听写没有返回文字，请重试或直接输入。");
      }, 5000);
      return;
    }
    const voiceWindow = window as VoiceWindow;
    const Constructor = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setNotice("这个浏览器暂不支持听写，请用文字输入或试用示例。");
      return;
    }
    cancelSpeech();
    setSpeaking(false);
    claimVoice();
    keepListening.current = continuous;
    let failures = 0;
    const retry = (failed: boolean) => {
      if (!keepListening.current) return;
      if (failed && ++failures > 3) {
        stopAll(); setNotice("语音服务连续连接失败，请检查网络后重新开始。"); return;
      }
      setNotice("语音连接正在恢复，您可以点停止结束。");
      clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(startRecognition, failed ? 500 * failures : 300);
    };
    const startRecognition = () => {
      if (!keepListening.current && continuous) return;
      const current = new Constructor();
      recognition.current = current;
      let delivered = 0;
      const detach = () => {
        current.onend = current.onerror = current.onresult = null;
        if (recognition.current === current) recognition.current = null;
      };
      current.lang = "zh-CN";
      current.continuous = continuous;
      current.interimResults = false;
      current.onresult = event => {
        if (recognition.current !== current) return;
        const start = Math.max(delivered, event.resultIndex ?? 0);
        for (let i = start; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal === false) break;
          delivered = i + 1;
          const text = result[0]?.transcript ?? "";
          if (!text.trim()) continue;
          failures = 0;
          transcriptCallback.current(text);
          finalCallback.current?.(text);
          setNotice(continuous ? "已听到，您可以继续说。" : "听写文字已放入输入框，请检查后继续。");
        }
      };
      current.onerror = event => {
        if (recognition.current !== current) return;
        const error = event?.error ?? "unknown";
        if (continuous && keepListening.current && ["no-speech", "aborted", "network"].includes(error)) {
          detach(); current.abort(); retry(error !== "no-speech"); return;
        }
        stopAll();
        setNotice(`语音输入已停止（${error}），请检查麦克风权限或重新开始。`);
      };
      current.onend = () => {
        if (recognition.current !== current) return;
        detach();
        if (continuous && keepListening.current && !finishingRef.current) { retry(false); return; }
        dispose(); setListening(false); setFinishing(false); finishingRef.current = false;
      };
      try {
        current.start(); setListening(true);
        setNotice(continuous ? "正在连续听，点停止结束聊天。" : "正在听，结束后可修改文字。再点一次可停止。");
      } catch {
        detach(); current.abort();
        if (continuous && keepListening.current) retry(true);
        else { stopAll(); setNotice("听写暂时无法启动，请直接输入。"); }
      }
    };
    startRecognition();
    if (!continuous) timer.current = setTimeout(() => {
      dispose();
      setListening(false);
      setFinishing(false);
      finishingRef.current = false;
      setNotice("听写已结束，请检查文字或重新开始。");
    }, 60_000);
  }
  function speak(text: string, slow: boolean) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setNotice("这个浏览器暂不支持朗读，您可以阅读下方文字。");
      return;
    }
    cancelSpeech();
    if (speaking) { setSpeaking(false); return; }
    if (listening) { dispose(); setListening(false); setFinishing(false); }
    claimVoice();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = slow ? 0.7 : 0.9;
    utteranceRef.current = utterance;
    const finished = () => {
      utteranceRef.current = null;
      if (activeVoice?.id === owner.current) activeVoice = null;
      setSpeaking(false);
    };
    utterance.onend = finished;
    utterance.onerror = () => { finished(); setNotice("朗读未完成，请重试。"); };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  return { listening, finishing, speaking, notice, toggleListening, speak, stopAll };
}
