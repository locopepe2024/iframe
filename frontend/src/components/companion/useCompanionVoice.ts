"use client";

import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useCompanionVoice(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const transcriptCallback = useRef(onTranscript);
  transcriptCallback.current = onTranscript;

  function dispose() {
    clearTimeout(timer.current);
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onend = current.onerror = current.onresult = null;
      current.abort();
    }
  }
  function cancelSpeech() {
    if (utteranceRef.current) {
      utteranceRef.current.onend = utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }
  function stopAll() {
    dispose(); cancelSpeech();
    setListening(false); setFinishing(false); setSpeaking(false);
  }
  useEffect(() => () => {
    dispose();
    cancelSpeech();
  }, []);

  function toggleListening() {
    if (recognition.current) {
      if (finishing) return;
      setFinishing(true);
      setNotice("正在结束听写，请稍等。");
      // stop() requests the final result; abort() would discard pending speech.
      recognition.current.stop();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        dispose(); setListening(false); setFinishing(false);
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
    const current = new Constructor();
    recognition.current = current;
    current.lang = "zh-CN";
    current.continuous = false;
    current.interimResults = false;
    current.onresult = (event) => {
      const text = Array.from(event.results).map(result => result[0]?.transcript ?? "").join("");
      transcriptCallback.current(text);
      setNotice("听写文字已放入输入框，请检查后继续。");
    };
    current.onerror = () => {
      dispose();
      setListening(false);
      setFinishing(false);
      setNotice("没有听清或麦克风未获允许。请重试，也可以直接输入。");
    };
    current.onend = () => {
      dispose();
      setListening(false);
      setFinishing(false);
    };
    try {
      current.start();
      setListening(true);
      setNotice("正在听，结束后可修改文字。再点一次可停止。");
      timer.current = setTimeout(() => {
        dispose();
        setListening(false);
        setFinishing(false);
        setNotice("听写已结束，请检查文字或重新开始。");
      }, 60_000);
    } catch {
      dispose();
      setListening(false);
      setNotice("听写暂时无法启动，请直接输入。");
    }
  }
  function speak(text: string, slow: boolean) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setNotice("这个浏览器暂不支持朗读，您可以阅读下方文字。");
      return;
    }
    cancelSpeech();
    if (speaking) { setSpeaking(false); return; }
    if (listening) { dispose(); setListening(false); setFinishing(false); }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = slow ? 0.7 : 0.9;
    utteranceRef.current = utterance;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => { setSpeaking(false); setNotice("朗读未完成，请重试。"); };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  return { listening, finishing, speaking, notice, toggleListening, speak, stopAll };
}
