"use client";

import { useEffect, useRef, useState } from "react";
import { companionApi, type Diary } from "@/lib/companionApi";
import FeatureDialog from "./FeatureDialog";
import styles from "./chat.module.css";

export const diaryPrompt = (day: string) => `请把 ${day} 我们聊的内容整理成一篇回忆日记。只使用已经讲过的事实，缺少内容时先询问，不要编造。`;
export function diaryDay(text: string) {
  return text.match(/^请把\s+(\d{4}-\d{2}-\d{2})\s+我们聊的内容整理成一篇回忆日记/)?.[1]
    ?? text.match(/^请把我们今天聊的内容整理成一篇回忆日记（日记日期：(\d{4}-\d{2}-\d{2})）/)?.[1];
}
export function formatDiaryDay(day: string) { const [year,month,date] = day.split("-"); return `${year}年${Number(month)}月${Number(date)}日`; }
export function today() { const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; }

export default function DiaryCard({ day, text, sourceTurn, saved, onSaved }: {
  day: string; text: string; sourceTurn: string; saved?: Diary; onSaved?: (diary: Diary) => void;
}) {
  const [entry,setEntry] = useState(saved);
  const [previous,setPrevious] = useState<Diary>();
  const [editing,setEditing] = useState(false), [draft,setDraft] = useState(saved?.text ?? text);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [loaded,setLoaded] = useState(!!saved), [reload,setReload] = useState(0);
  useEffect(()=>{
    if(saved)return;
    let active=true;
    setLoaded(false);setError("");
    companionApi.diaries(day.slice(0,7)).then(result=>{if(active){const found=result.diaries.find(item=>item.day===day);setEntry(found?.source_turn_id===sourceTurn ? found : undefined);setPrevious(found?.source_turn_id!==sourceTurn ? found : undefined);setLoaded(true);}}).catch(()=>{if(active)setError("无法核对已保存的日记，请重试读取。");});
    return ()=>{active=false;};
  },[day,saved,reload,sourceTurn]);
  const lock = useRef(false);
  const request = useRef<{operation_id:string;text:string;source_turn_id:string;expected_revision:number} | null>(null);
  async function save(value: string) {
    if (lock.current || !value.trim()) return;
    lock.current=true;setBusy(true);setError("");
    if (!request.current || request.current.text !== value) request.current={operation_id:crypto.randomUUID(),text:value,source_turn_id:sourceTurn,expected_revision:entry?.revision ?? previous?.revision ?? 0};
    try {
      const result=await companionApi.saveDiary(day,request.current);
      setEntry(result);setPrevious(undefined);setDraft(result.text);setEditing(false);request.current=null;onSaved?.(result);
    } catch(failure) {setError(failure instanceof Error ? failure.message : "日记没有保存，请重试。");}
    finally {lock.current=false;setBusy(false);}
  }
  return <article className={styles.guideCard} aria-label={entry ? "已保存日记" : "日记草稿"}>
    <h2>{day} · {entry ? "日记已保存 ✅" : "日记草稿"}</h2>
    <p className={styles.diaryText}>{entry?.text ?? text}</p>
    {!entry && <p>要修改这篇日记吗？不修改可以直接保存。</p>}
    {previous && <details><summary>当天已有日记，保存将替换当天内容，点此核对原文</summary><p className={styles.diaryText}>{previous.text}</p></details>}
    <button type="button" disabled={busy || !loaded} onClick={()=>{setDraft(entry?.text ?? text);setEditing(true);}}>编辑日记</button>
    {!entry && <button type="button" disabled={busy || !loaded} onClick={()=>void save(text)}>{busy ? "正在保存…" : previous ? "确认替换当日日记" : "不修改，直接保存"}</button>}
    {!loaded && !error && <p role="status">正在核对日记…</p>}
    {error && !editing && <p role="alert">{error}{!loaded && <button type="button" onClick={()=>setReload(value=>value+1)}>重试核对日记</button>}</p>}
    {editing && <FeatureDialog title="编辑日记" onClose={()=>{if(!busy)setEditing(false);}}>
      <label>日记内容<textarea rows={12} maxLength={12000} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || !draft.trim()} onClick={()=>void save(draft)}>{busy ? "正在保存…" : "保存日记"}</button>
      <button type="button" disabled={busy} onClick={()=>setEditing(false)}>取消编辑</button>
    </FeatureDialog>}
  </article>;
}
