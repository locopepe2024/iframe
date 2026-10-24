"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi } from "@/lib/photoApi";
import { companionMediaApi } from "@/lib/companionMediaApi";
import styles from "./chat.module.css";

export type UploadedMedia = { kind: "photo" | "video"; id: string; name: string };
type Item = { file: File; operation: string; done: boolean; error: string };
export default function MediaUpload({files,disabled,onUploaded,onClose,onBusyChange}:{files:File[];disabled:boolean;onUploaded:(media:UploadedMedia)=>void;onClose:()=>void;onBusyChange?:(busy:boolean)=>void}) {
  const [items,setItems]=useState<Item[]>(()=>files.map(file=>({file,operation:crypto.randomUUID(),done:false,error:""})));
  const [previews,setPreviews]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const alive=useRef(true),locked=useRef(false);
  const callback=useRef(onUploaded);callback.current=onUploaded;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if (typeof URL.createObjectURL !== "function") return;
    const next:Record<string,string> = {};
    files.forEach(file => { next[file.name] = URL.createObjectURL(file); });
    setPreviews(next);
    return () => Object.values(next).forEach(url => URL.revokeObjectURL(url));
  },[files]);
  async function upload(){
    if(locked.current)return;locked.current=true;setBusy(true);onBusyChange?.(true);
    for(let index=0;index<items.length&&alive.current;index++){
      const item=items[index];if(item.done)continue;
      try{
        const video=item.file.type.startsWith("video/")||/\.(mp4|mov|webm)$/i.test(item.file.name);
        if(!item.file.size||item.file.size>(video?25:10)*1024*1024)throw new Error(video?"请选择不超过 25 MB 的视频。":"请选择不超过 10 MB 的照片。");
        if(item.file.name.length>255)throw new Error("文件名太长，请缩短后重新选择。");
        const result=video ? await companionMediaApi.upload(item.operation,item.file) : await photoApi.upload(item.operation,item.file);
        if(!alive.current)break;
        setItems(old=>old.map((row,i)=>i===index?{...row,done:true,error:""}:row));
        callback.current({kind:video?"video":"photo",id:"video_id" in result?result.video_id:result.photo_id,name:item.file.name});
      }catch(error){if(alive.current)setItems(old=>old.map((row,i)=>i===index?{...row,error:error instanceof Error?error.message:"上传未完成，请重试。"}:row));}
    }
    locked.current=false;if(alive.current){setBusy(false);onBusyChange?.(false);}
  }
  return <section className={styles.guideCard} aria-label="上传照片或视频" aria-busy={busy}>
    <h2>上传照片或视频</h2><p>照片每张不超过 10 MB；视频每段不超过 25 MB、5 分钟。</p>
    <ul>{items.map((item,i)=><li key={item.operation} className={styles.uploadItem}>
      {previews[item.file.name] && (item.file.type.startsWith("video/") ? <video className={styles.uploadPreview} src={previews[item.file.name]} muted playsInline preload="metadata" aria-label={`${item.file.name} 缩略图`} /> : <img className={styles.uploadPreview} src={previews[item.file.name]} alt={`${item.file.name} 缩略图`} />)}
      <p>{item.file.name}：{item.done?"已上传":"待上传"}</p>{item.error&&<p role="alert">{item.error}</p>}
    </li>)}</ul>
    <button type="button" disabled={busy||disabled||items.every(item=>item.done)} onClick={()=>void upload()}>{busy?"正在上传…":items.some(item=>item.error)?"重试未完成的上传":"确认上传"}</button>
    <button type="button" disabled={busy} onClick={onClose}>{items.every(item=>item.done)?"完成":"关闭上传"}</button>
    {busy&&<p role="status">正在上传，请保持页面打开。</p>}
    <p className={styles.muted}>上传后保存在相册，不会自动分析或发送给聊天模型。</p>
  </section>;
}
