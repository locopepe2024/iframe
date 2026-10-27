"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { companionPlayback } from "@/lib/companionPlaybackQueue";
import { companionServices } from "@/lib/companionServices";
export default function SpeechPlayback({text,voice,autoPlay=false}:{text:string;voice?:string;autoPlay?:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[url,setUrl]=useState("");
  const owner=useRef(Symbol("reply-playback")),queued=useRef(false);
  const current=useRef(""); const alive=useRef(true); const audio=useRef<HTMLAudioElement>(null); const autoPlayed=useRef("");
  useLayoutEffect(()=>{alive.current=true;return()=>{
    alive.current=false;companionPlayback.cancel(owner.current);
    const node=audio.current;if(node){node.pause();node.removeAttribute("src");node.load();}
    if(current.current)URL.revokeObjectURL(current.current);
  };},[]);
  function play(cached=false) {
    if (queued.current || text.length>3000) return;
    queued.current=true;setBusy(true);setError("");
    companionPlayback.enqueue(owner.current,async (signal,playing)=>{
      try {
        if(!cached){
          const blob=await companionServices.speech(text,voice);
          if(!alive.current || signal.aborted)return;
          if(current.current)URL.revokeObjectURL(current.current);
          const next=URL.createObjectURL(blob);current.current=next;setUrl(next);
        }
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        if(!alive.current || signal.aborted)return;
        const node=audio.current;if(!node)return;
        await new Promise<void>((resolve,reject)=>{
          const done=()=>{cleanup();resolve();};
          const failed=()=>{cleanup();reject(new Error("播放失败，请重试。"));};
          const aborted=()=>{node.pause();done();};
          const cleanup=()=>{node.removeEventListener("ended",done);node.removeEventListener("error",failed);signal.removeEventListener("abort",aborted);};
          node.addEventListener("ended",done);node.addEventListener("error",failed);signal.addEventListener("abort",aborted,{once:true});
          playing();
          void node.play().catch(()=>{cleanup();reject(new Error("浏览器未能播放，请点击朗读按钮重试。"));});
        });
      } catch(error) {if(alive.current && !signal.aborted)setError(error instanceof Error?error.message:"朗读失败，请检查 UniArt 渠道。");}
      finally{queued.current=false;if(alive.current)setBusy(false);}
    },()=>{queued.current=false;if(alive.current)setBusy(false);});
  }
  useEffect(()=>{
    if(!autoPlay || !text.trim() || autoPlayed.current===text) return;
    autoPlayed.current=text;
    void play();
  },[autoPlay,text,voice]);
  return <div><button disabled={busy || text.length>3000} onClick={() => void play()}>{busy?"正在准备朗读…":"用 UniArt 朗读（可能计费）"}</button>
  {url&&<audio ref={audio} controls onPlay={()=>{if(!queued.current){audio.current?.pause();play(true);}}} src={url} aria-label="助手回复朗读"/>}{error&&<p role="alert">{error}</p>}</div>;
}
