"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { photoApi, type AlbumPhoto } from "@/lib/photoApi";
import { companionMediaApi, type CompanionVideo } from "@/lib/companionMediaApi";
import PhotoImage from "../photos/PhotoImage";
import { VideoCover } from "./VideoConversationCard";
import styles from "./chat.module.css";

export default function AlbumPicker({ disabled = false, initialDate = "", initialFrom = "", initialTo = "", initialQuery = "", order = "id", onPhoto, onVideo, onClose }: {
  initialDate?: string; initialFrom?:string; initialTo?:string; initialQuery?: string; order?: "id" | "recent";
  disabled?: boolean; onPhoto: (photo: AlbumPhoto) => void; onVideo?: (video: CompanionVideo) => void; onClose: () => void;
}) {
  const [kind,setKind] = useState<"photos" | "videos">("photos");
  const [query,setQuery] = useState(initialQuery), [applied,setApplied] = useState("");
  const [photos,setPhotos] = useState<AlbumPhoto[]>([]), [videos,setVideos] = useState<CompanionVideo[]>([]);
  const [cursor,setCursor] = useState<string|null>(null), [busy,setBusy] = useState(true), [error,setError] = useState("");
  const serial = useRef(0), lock = useRef(false);
  async function load(type: "photos"|"videos", search: string, after = "") {
    const request = ++serial.current;
    lock.current = true; setBusy(true); setError("");
    try {
      if (type === "photos") {
        const page = initialDate || initialFrom || initialTo || order !== "id" ? await photoApi.list("all", "", after, search, {date_prefix: initialDate, ...(initialFrom ? {date_from:initialFrom} : {}), ...(initialTo ? {date_to:initialTo} : {}), order}) : await photoApi.list("all", "", after, search);
        if (serial.current === request) { setPhotos(old => after ? [...old,...page.photos] : page.photos); setCursor(page.next_after_id); }
      } else {
        const page = await companionMediaApi.list(search,after);
        if (serial.current === request) { setVideos(old => after ? [...old,...page.videos] : page.videos); setCursor(page.next_after_id); }
      }
      if (serial.current === request) setApplied(search);
    } catch { if (serial.current === request) setError("相册暂时没有打开，请重试。"); }
    finally { if (serial.current === request) { lock.current=false; setBusy(false); } }
  }
  useEffect(() => {
    void load("photos", initialQuery);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { serial.current++; window.removeEventListener("keydown", onKeyDown); };
  }, []);
  const blocked = busy || disabled;
  return <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.albumSheet} role="dialog" aria-modal="true" aria-label="浏览相册" aria-busy={busy} onMouseDown={event => event.stopPropagation()}>
    <div className={styles.sheetHandle} aria-hidden="true" /><div className={styles.albumHeader}><h2>相册</h2><button className={styles.albumIcon} type="button" aria-label="关闭相册" onClick={onClose}><X size={24} aria-hidden="true" /></button></div>
    {(initialFrom || initialTo) && <p>拍摄日期：{initialFrom || "不限"} 至 {initialTo || "不限"}</p>}
    {(initialDate || order === "recent") && <p>{initialDate ? `拍摄日期：${initialDate}` : "最近加入的照片"}</p>}
    {onVideo && <div className={styles.choices}><button type="button" disabled={blocked} aria-pressed={kind === "photos"} onClick={() => { setKind("photos");setQuery("");void load("photos", ""); }}>照片</button><button type="button" disabled={blocked} aria-pressed={kind === "videos"} onClick={() => { setKind("videos");setQuery("");void load("videos", ""); }}>视频</button></div>}
    <form className={styles.albumSearch} onSubmit={event => { event.preventDefault(); if (!lock.current && !disabled) void load(kind, query.trim()); }}>
      <button className={styles.albumIcon} type="submit" disabled={blocked} aria-label="搜索"><Search size={24} aria-hidden="true" /></button>
      <input aria-label={kind === "photos" ? "搜索照片" : "搜索视频"} maxLength={100} value={query} disabled={blocked} onChange={event => setQuery(event.target.value)} placeholder={kind === "photos" ? "讲述或描述关键词" : "视频文件名"} />
      {(query || applied) && <button className={styles.albumIcon} type="button" disabled={blocked} aria-label="清除搜索" onClick={() => {setQuery("");void load(kind, "");}}><X size={22} aria-hidden="true" /></button>}
    </form>
    {busy && <p role="status">正在读取相册…</p>}
    {error ? <p role="alert">{error}<button type="button" disabled={blocked} onClick={() => void load(kind,query.trim())}>重试打开相册</button></p> : !busy && <>
      {!photos.length && kind === "photos" && <p>{applied || initialDate || initialFrom || initialTo ? "没有找到符合这些条件的照片。" : "相册里还没有照片，可以先上传。"}</p>}
      {!videos.length && kind === "videos" && <p>{applied ? "没有找到匹配的视频。" : "还没有上传视频。"}</p>}
      <div className={styles.albumGrid}>{kind === "photos" ? photos.map((photo,i) => <div key={photo.photo_id}>
        <button className={styles.albumTile} type="button" aria-label={`选择照片 ${i+1}`} disabled={disabled} onClick={() => onPhoto(photo)}>
          <PhotoImage id={photo.photo_id}/><span className={styles.albumOverlay}><Check size={24} aria-hidden="true" /></span>
        </button>
        {photo.search_matches?.[0] && <small className={styles.albumExcerpt}>{photo.search_matches[0].excerpt}</small>}
      </div>) : videos.map(video => <button key={video.video_id} className={styles.albumTile} type="button" aria-label={`选择视频：${video.name}`} disabled={disabled} onClick={() => onVideo?.(video)}>
        <VideoCover id={video.video_id}/><span className={styles.albumOverlay}><Check size={24} aria-hidden="true" /></span>
      </button>)}</div>
      {cursor && <button type="button" disabled={blocked} onClick={() => void load(kind,applied,cursor)}>更多{kind === "photos" ? "照片" : "视频"}</button>}
    </>}
    </section>
  </div>;
}
