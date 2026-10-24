"use client";
import { useEffect, useRef, useState } from "react";
import { companionServices } from "@/lib/companionServices";
export default function SpeechPlayback({text}:{text:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[url,setUrl]=useState("");
  const current=useRef(""); const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(current.current)URL.revokeObjectURL(current.current);};},[]);
  return <div><button disabled={busy || text.length>3000} onClick={async()=>{setBusy(true);setError("");try{const blob=await companionServices.speech(text);if(!alive.current)return;if(current.current)URL.revokeObjectURL(current.current);current.current=URL.createObjectURL(blob);setUrl(current.current);}catch{if(alive.current)setError("朗读失败，请检查 UniArt 渠道。");}finally{if(alive.current)setBusy(false);}}}>{busy?"正在准备朗读…":"用 UniArt 朗读（可能计费）"}</button>
  {url&&<audio controls src={url} aria-label="助手回复朗读"/>}{error&&<p role="alert">{error}</p>}</div>;
}
