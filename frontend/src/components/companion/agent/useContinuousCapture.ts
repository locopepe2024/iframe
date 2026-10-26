"use client";
import {useEffect,useRef,useState} from "react";
import {captureMicrophonePcm} from "@/lib/companionRealtimeAudio";
import {pcmWav,SilenceSegments} from "@/lib/companionSegments";
import {companionPlayback} from "@/lib/companionPlaybackQueue";

export function useContinuousCapture(onText:(text:string)=>void) {
 const [listening,setListening]=useState(false),[finishing,setFinishing]=useState(false),[notice,setNotice]=useState(""),[failed,setFailed]=useState(false),[playing,setPlaying]=useState(false);
 const callback=useRef(onText);callback.current=onText;
 const generation=useRef(0),stream=useRef<MediaStream|null>(null),context=useRef<AudioContext|null>(null),cleanup=useRef<(()=>void)|null>(null),segment=useRef<SilenceSegments|null>(null);
 const queue=useRef<Blob[]>([]),running=useRef(false),paused=useRef(false),controller=useRef<AbortController|null>(null),intent=useRef(false);
 function release(){intent.current=false;cleanup.current?.();cleanup.current=null;segment.current=null;stream.current?.getTracks().forEach(t=>{t.onended=null;t.stop();});stream.current=null;void context.current?.close().catch(()=>{});context.current=null;setListening(false);}
 function cancel(){generation.current++;controller.current?.abort();controller.current=null;queue.current=[];paused.current=false;release();setFinishing(false);setFailed(false);}
 async function drain(){
   if(running.current || paused.current)return;
   running.current=true;const version=generation.current;
   try{while(version===generation.current && queue.current.length && !paused.current){
     const request=new AbortController();controller.current=request;
     const timeout=setTimeout(()=>request.abort(),30000);
     try{
       const form=new FormData();form.append("file",queue.current[0],"speech.wav");
       const response=await fetch("/companion-demo/sensevoice-test/analyze",{method:"POST",body:form,signal:request.signal});
       if(!response.ok)throw new Error(`HTTP ${response.status}`);
       const result=await response.json() as {text?:string};
       if(version!==generation.current)return;
       queue.current.shift();if(result.text?.trim())callback.current(result.text.trim());
     }catch{
       if(version!==generation.current)return;
       paused.current=true;segment.current?.flush();setFailed(true);setNotice("这一段识别失败，录音暂存在本页。请重试，或结束并清空。");
       release();
     }finally{clearTimeout(timeout);if(controller.current===request)controller.current=null;}
   }}finally{running.current=false;if(version===generation.current)setFinishing(!paused.current && !intent.current && queue.current.length>0);else if(queue.current.length)void drain();}
 }
 function stop(){segment.current?.flush();release();setFinishing(queue.current.length>0);setNotice("已停止收音，正在处理剩余语音。");void drain();}
 async function start(){
   cancel();const version=generation.current;intent.current=true;setListening(true);setNotice("正在打开麦克风…");
   try{
     if(!navigator.mediaDevices?.getUserMedia || !window.AudioContext)throw new Error("unsupported");
     const audio=new AudioContext();context.current=audio;await audio.resume();
     if(version!==generation.current || !intent.current)return;
     const microphone=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
     if(version!==generation.current || !intent.current){microphone.getTracks().forEach(t=>t.stop());return;}
     stream.current=microphone;
     const parts=new SilenceSegments(audio.sampleRate,samples=>{
       queue.current.push(pcmWav(samples,audio.sampleRate));
       if(queue.current.length>=12){release();setNotice("识别暂时跟不上，已暂停收音，正在处理已录内容。");setFinishing(true);}
       void drain();
     });segment.current=parts;
     const disconnect=await captureMicrophonePcm(audio,microphone,frame=>{
       if(version!==generation.current || !intent.current)return;
       if(companionPlayback.blocksCapture()){parts.reset();return;}
       parts.push(frame);
     });
     if(version!==generation.current || !intent.current){disconnect();return;}
     cleanup.current=disconnect;
     microphone.getTracks().forEach(t=>{t.onended=()=>{if(version===generation.current){stop();setNotice("麦克风已断开，已保留采集到的语音。");}};});
     setNotice("正在持续听，停顿后可以接着说。");
   }catch{if(version===generation.current){release();setNotice("麦克风无法启动，请检查权限后重试。");}}
 }
 useEffect(()=>{
   const unsubscribe=companionPlayback.subscribe(()=>{setPlaying(companionPlayback.isPlaying());segment.current?.reset();});
   const leaving=()=>cancel();window.addEventListener("pagehide",leaving);
   return()=>{unsubscribe();window.removeEventListener("pagehide",leaving);cancel();};
   // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return {listening,finishing,notice,failed,playing,toggleListening:()=>intent.current?stop():void start(),stopAll:cancel,retry:()=>{paused.current=false;setFailed(false);setNotice("正在重试语音识别…");void drain();},interrupt:()=>{companionPlayback.cancel();segment.current?.reset();}};
}
