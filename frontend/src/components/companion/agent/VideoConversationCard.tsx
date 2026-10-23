"use client";

import { useEffect, useState } from "react";
import { companionMediaApi } from "@/lib/companionMediaApi";
import styles from "./chat.module.css";

export function VideoCover({ id }: { id: string }) {
  const [url,setUrl] = useState(""), [error,setError] = useState(false);
  useEffect(() => {
    let active = true, objectUrl = "";
    companionMediaApi.media(id).then(blob => { if (active) { objectUrl=URL.createObjectURL(blob);setUrl(objectUrl); } }).catch(()=>{if(active)setError(true);});
    return () => {active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id]);
  return url ? <img src={url} alt="视频封面" className={styles.videoImage}/> : <span>{error ? "视频封面暂不可用" : "正在读取封面…"}</span>;
}

export default function VideoConversationCard({ id, name }: {id:string;name:string}) {
  const [url,setUrl] = useState(""),[busy,setBusy] = useState(false),[error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    if(!attempt)return;
    let active=true, objectUrl="";setBusy(true);setError("");
    companionMediaApi.media(id,true).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}})
      .catch(()=>{if(active)setError("视频没有打开，请重试。");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,attempt]);
  return <article className={styles.guideCard} aria-label={`视频：${name}`}><h3>{name}</h3>{url ? <><video controls playsInline preload="metadata" src={url} className={styles.videoImage}/><p className={styles.muted}>若无法播放，可下载后查看。</p><a href={url} download={name}>下载视频</a></> : <><VideoCover id={id}/><button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{busy ? "正在读取视频…" : "打开视频"}</button></>}{error&&<p role="alert">{error}</p>}</article>;
}
