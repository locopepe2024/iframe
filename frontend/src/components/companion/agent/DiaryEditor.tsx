"use client";
import { useRef, useState } from "react";
import { useDiaryDictation } from "./useDiaryDictation";

export default function DiaryEditor({initialText,busy,error,onSave,onCancel}:{initialText:string;busy:boolean;error:string;onSave:(text:string)=>void;onCancel:()=>void}) {
  const [text,setText]=useState(initialText),[consent,setConsent]=useState(false),[prompt,setPrompt]=useState(false);
  const [savePending,setSavePending]=useState(false);
  const value=useRef(initialText);
  function change(next:string){value.current=next;setText(next);setSavePending(false);}
  const voice=useDiaryDictation(next=>{
    if(value.current.length+next.length+1>12000){voice.stop();return;}
    change(`${value.current}${value.current ? "\n" : ""}${next}`);
  },()=>{if(!busy && value.current.trim())setSavePending(true);});
  return <>
    <label>日记内容<textarea rows={12} maxLength={12000} value={text} disabled={busy} onChange={event=>change(event.target.value)}/></label>
    <button type="button" disabled={busy || savePending} onClick={()=>{if(voice.listening)voice.stop();else if(consent)voice.start();else setPrompt(true);}}>{voice.listening ? "暂停记录" : "开始或继续语音记录"}</button>
    {prompt && <section aria-label="日记语音说明"><p>语音交给浏览器识别，文字追加到当前日记。说“停止记录”暂停，说“保存日记”后再确认保存。</p><button type="button" onClick={()=>{setConsent(true);setPrompt(false);voice.start();}}>同意并开始记录</button><button type="button" onClick={()=>setPrompt(false)}>先用文字</button></section>}
    <p role="status">{voice.listening ? "正在记录日记 · 麦克风已开启" : "日记编辑中 · 麦克风已关闭"}</p>
    {voice.notice && <p>{voice.notice}</p>}
    {error && <p role="alert">{error}</p>}
    {savePending ? <section aria-label="日记保存确认"><p>要保存当前日记吗？</p><button type="button" disabled={busy} onClick={()=>{voice.stop();onSave(value.current);}}>确认保存日记</button><button type="button" disabled={busy} onClick={()=>setSavePending(false)}>先不保存，继续编辑</button></section> : <button type="button" disabled={busy || !text.trim()} onClick={()=>{voice.stop();onSave(value.current);}}>{busy ? "正在保存…" : "保存日记"}</button>}
    <button type="button" disabled={busy} onClick={()=>{voice.stop();onCancel();}}>取消编辑</button>
  </>;
}
