"use client";
import { useEffect, useRef, useState } from "react";
import { diaryVoiceCommand } from "./diaryVoiceCommand";

type Result = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: {resultIndex: number; results: ArrayLike<Result>}) => void) | null;
  onend: (() => void) | null; onerror: ((event: {error: string}) => void) | null;
  start(): void; stop(): void; abort(): void;
};

export function useDiaryDictation(onAppend: (text: string) => void, onSave: () => void) {
  const [listening,setListening] = useState(false), [notice,setNotice] = useState("");
  const active = useRef(false), recognition = useRef<Recognition | null>(null);
  const restart = useRef<ReturnType<typeof setTimeout>>();
  const callbacks = useRef({onAppend,onSave}); callbacks.current={onAppend,onSave};
  function stop() {
    active.current=false;clearTimeout(restart.current);
    const current=recognition.current; recognition.current=null;
    if(current){current.onresult=current.onend=current.onerror=null;current.abort();}
    setListening(false);
  }
  function start() {
    if(active.current)return;
    const browser=window as Window & {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
    const Constructor=browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if(!Constructor){setNotice("这个浏览器暂不支持语音记录，可以直接输入日记。");return;}
    active.current=true;
    function connect() {
      if(!active.current)return;
      const current=new Constructor!(); recognition.current=current;
      current.lang="zh-CN";current.continuous=true;current.interimResults=false;
      current.onresult=event=>{
        if(!active.current || recognition.current!==current)return;
        for(let i=event.resultIndex;i<event.results.length;i++){
          const result=event.results[i];if(!result.isFinal)continue;
          const text=result[0]?.transcript?.trim();if(!text)continue;
          const command=diaryVoiceCommand(text);
          if(command==="save"){
            stop();setNotice("已暂停听写，请确认是否保存日记。");callbacks.current.onSave();return;
          }
          if(command==="stop"){
            stop();setNotice("已停止听写，草稿仍在，可以继续记录或保存。");return;
          }
          callbacks.current.onAppend(text);
        }
      };
      current.onerror=event=>{
        if(event.error==="no-speech")return;
        stop();setNotice("语音记录已暂停，请检查麦克风或网络后继续。草稿仍保留。");
      };
      current.onend=()=>{
        recognition.current=null;
        if(active.current)restart.current=setTimeout(connect,300);
      };
      try{current.start();setListening(true);setNotice("正在记录日记，停顿不会结束。说“停止记录”停听，说“保存日记”保存。");}
      catch{stop();setNotice("语音记录未能启动，请重试或直接输入。");}
    }
    connect();
  }
  useEffect(()=>()=>{
    active.current=false;clearTimeout(restart.current);
    const current=recognition.current;
    if(current){current.onresult=current.onend=current.onerror=null;current.abort();}
  },[]);
  return {listening,notice,start,stop};
}
