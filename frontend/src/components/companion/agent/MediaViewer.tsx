"use client";

import {useEffect, useRef, useState} from "react";
import {ArrowLeft, ChevronLeft, ChevronRight, Info, Minus, Plus} from "lucide-react";
import {photoApi} from "@/lib/photoApi";
import {companionMediaApi} from "@/lib/companionMediaApi";
import PhotoContent from "../photos/PhotoContent";
import PhotoStory from "../photos/PhotoStory";
import styles from "./chat.module.css";
import {useInteractionFocus} from "./InteractionFocus";

export interface ViewerItem {id: string; kind: "photo" | "video"; name: string}
export default function MediaViewer({items, initialIndex = 0, disabled = false, useLabel = "使用这张照片", onUse, onClose}: {
  items: ViewerItem[]; initialIndex?: number; disabled?: boolean; useLabel?: string;
  onUse?: (item: ViewerItem) => void; onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex), [url, setUrl] = useState("");
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [zoom, setZoom] = useState(1), [info, setInfo] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const item = items[index];
  useInteractionFocus(item?.kind === "photo" ? {kind:"photo",object_id:item.id,phase:"viewing",draft:""} : null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => {node?.close();}; }, []);
  useEffect(() => {
    if (!item) return;
    let active = true, objectUrl = "";
    setUrl(""); setError(false); setZoom(1); setInfo(false);
    const request = item.kind === "photo" ? photoApi.image(item.id, true) : companionMediaApi.media(item.id, true);
    request.then(blob => {if (active) {objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);}}).catch(() => {if (active) setError(true);});
    return () => {active = false; if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [item?.id, item?.kind, attempt]);
  useEffect(() => {
    const remove = (event: Event) => {if ((event as CustomEvent<{photoId:string}>).detail.photoId === item?.id && item.kind === "photo") onClose();};
    window.addEventListener("companion-photo-deleted",remove);
    return ()=>window.removeEventListener("companion-photo-deleted",remove);
  }, [item?.id, item?.kind, onClose]);
  if (!item) return null;
  function back() { if (info) setInfo(false); else onClose(); }
  return <dialog ref={dialog} className={styles.mediaViewer} aria-label={info ? "照片资料" : "全屏查看"} onCancel={event => {event.preventDefault(); event.stopPropagation(); back();}}>
    <header className={styles.albumHeader}>
      <button autoFocus className={styles.albumIcon} type="button" aria-label={info ? "返回照片" : "返回相册"} onClick={back}><ArrowLeft aria-hidden="true" size={24}/></button>
      <span>{info ? "照片资料" : `${index + 1} / ${items.length}`}</span>
      {item.kind === "photo" && !info ? <button className={styles.albumIcon} type="button" aria-label="查看照片资料" onClick={() => setInfo(true)}><Info aria-hidden="true" size={24}/></button> : <span/>}
    </header>
    {info ? <div className={styles.mediaDetails}><PhotoContent key={item.id} photoId={item.id}/><PhotoStory key={`story-${item.id}`} photoId={item.id}/></div> : <>
      <div className={styles.mediaStage}>
        {error ? <p role="alert">素材暂时没有打开。<button type="button" onClick={() => setAttempt(n => n + 1)}>重试打开</button></p> : !url ? <p role="status">正在打开{item.kind === "photo" ? "原图" : "视频"}…</p> : item.kind === "photo" ? <div className={styles.zoomCanvas} style={{width: `${zoom * 100}%`, height: `${zoom * 100}%`}}><img src={url} alt={item.name} className={styles.fullImage}/></div> : <video key={item.id} controls playsInline preload="metadata" src={url} className={styles.fullImage} aria-label={item.name}/>}
      </div>
      <footer className={styles.viewerControls}>
        <div className={styles.albumHeader}>
          <button type="button" aria-label="上一张" disabled={index === 0} onClick={() => setIndex(n => n - 1)}><ChevronLeft aria-hidden="true"/></button>
          {item.kind === "photo" && <div className={styles.zoomControls}><button type="button" aria-label="缩小照片" disabled={zoom <= 1 || !url} onClick={() => setZoom(n => Math.max(1,n - .5))}><Minus aria-hidden="true"/></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大照片" disabled={zoom >= 3 || !url} onClick={() => setZoom(n => Math.min(3,n + .5))}><Plus aria-hidden="true"/></button></div>}
          <button type="button" aria-label="下一张" disabled={index >= items.length - 1} onClick={() => setIndex(n => n + 1)}><ChevronRight aria-hidden="true"/></button>
        </div>
        {onUse && <button type="button" disabled={disabled} onClick={() => onUse(item)}>{item.kind === "video" ? "使用这个视频" : useLabel}</button>}
      </footer>
    </>}
  </dialog>;
}
