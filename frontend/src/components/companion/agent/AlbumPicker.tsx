"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { photoApi, type AlbumPhoto } from "@/lib/photoApi";
import { companionMediaApi, type CompanionVideo } from "@/lib/companionMediaApi";
import PhotoImage from "../photos/PhotoImage";
import { VideoCover } from "./VideoConversationCard";
import styles from "./chat.module.css";

export default function AlbumPicker({ disabled = false, onPhoto, onVideo, onClose }: {
  disabled?: boolean; onPhoto: (photo: AlbumPhoto) => void; onVideo?: (video: CompanionVideo) => void; onClose: () => void;
}) {
  const [kind,setKind] = useState<"photos" | "videos">("photos");
  const [query,setQuery] = useState(""), [applied,setApplied] = useState("");
  const [photos,setPhotos] = useState<AlbumPhoto[]>([]), [videos,setVideos] = useState<CompanionVideo[]>([]);
  const [cursor,setCursor] = useState<string|null>(null), [busy,setBusy] = useState(true), [error,setError] = useState("");
  const serial = useRef(0), lock = useRef(false);
  async function load(type: "photos"|"videos", search: string, after = "") {
    const request = ++serial.current;
    lock.current = true; setBusy(true); setError("");
    try {
      if (type === "photos") {
        const page = await photoApi.list("all", "", after, search);
        if (serial.current === request) { setPhotos(old => after ? [...old,...page.photos] : page.photos); setCursor(page.next_after_id); }
      } else {
        const page = await companionMediaApi.list(search,after);
        if (serial.current === request) { setVideos(old => after ? [...old,...page.videos] : page.videos); setCursor(page.next_after_id); }
      }
      if (serial.current === request) setApplied(search);
    } catch { if (serial.current === request) setError("相册暂时没有打开，请重试。"); }
    finally { if (serial.current === request) { lock.current=false; setBusy(false); } }
  }
  useEffect(() => { void load("photos", ""); return () => { serial.current++; }; }, []);
  const blocked = busy || disabled;
  return <section className={styles.guideCard} aria-label="浏览相册" aria-busy={busy}>
    <h2>从相册选择</h2>
    <button type="button" onClick={onClose}>关闭相册</button>
    {onVideo && <div className={styles.choices}><button type="button" disabled={blocked} aria-pressed={kind === "photos"} onClick={() => { setKind("photos");setQuery("");void load("photos", ""); }}>照片</button><button type="button" disabled={blocked} aria-pressed={kind === "videos"} onClick={() => { setKind("videos");setQuery("");void load("videos", ""); }}>视频</button></div>}
    <form onSubmit={event => { event.preventDefault(); if (!lock.current && !disabled) void load(kind, query.trim()); }}>
      <label>搜索{kind === "photos" ? "照片" : "视频"}<input maxLength={100} value={query} disabled={blocked} onChange={event => setQuery(event.target.value)} placeholder={kind === "photos" ? "输入照片的讲述或描述关键词" : "输入视频文件名"} /></label>
      <button type="submit" disabled={blocked}><Search size={22} aria-hidden="true" />搜索</button>
      <button type="button" disabled={blocked} onClick={() => {setQuery("");void load(kind, "");}}>查看全部</button>
    </form>
    {busy && <p role="status">正在读取相册…</p>}
    {error ? <p role="alert">{error}<button type="button" disabled={blocked} onClick={() => void load(kind,query.trim())}>重试打开相册</button></p> : !busy && <>
      {!photos.length && kind === "photos" && <p>{applied ? "没有找到匹配的照片，换个词试试。" : "相册里还没有照片，可以先上传。"}</p>}
      {!videos.length && kind === "videos" && <p>{applied ? "没有找到匹配的视频。" : "还没有上传视频。"}</p>}
      <div className={styles.referenceGrid}>{kind === "photos" ? photos.map((photo,i) => <button key={photo.photo_id} type="button" disabled={disabled} onClick={() => onPhoto(photo)}><PhotoImage id={photo.photo_id}/><span>选择照片 {i+1}</span>{photo.search_matches?.[0] && <small>{photo.search_matches[0].excerpt}</small>}</button>) : videos.map(video => <button key={video.video_id} type="button" disabled={disabled} onClick={() => onVideo?.(video)}><VideoCover id={video.video_id}/><span>选择视频：{video.name}</span></button>)}</div>
      {cursor && <button type="button" disabled={blocked} onClick={() => void load(kind,applied,cursor)}>更多{kind === "photos" ? "照片" : "视频"}</button>}
    </>}
  </section>;
}
