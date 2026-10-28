"use client";

import { useEffect, useRef, useState } from "react";
import { companionApi, type Diary } from "@/lib/companionApi";
import FeatureDialog from "./FeatureDialog";
import DiaryEditor from "./DiaryEditor";
import styles from "./chat.module.css";

export const diaryPrompt = (day: string) => `请把 ${day} 我们聊的内容整理成一篇回忆日记。只使用已经讲过的事实，缺少内容时先询问，不要编造。`;
export function diaryDay(text: string, reply = "", fallbackDay?: string) {
  const explicit = text.match(/^\s*(?:请\s*)?把\s+(\d{4}-\d{2}-\d{2})\s+我们聊的内容整理成一篇回忆日记/)?.[1]
    ?? text.match(/^请把我们今天聊的内容整理成一篇回忆日记（日记日期：(\d{4}-\d{2}-\d{2})）/)?.[1];
  if (explicit) return explicit;
  const compact = text.replace(/[\s，。！？、,.!?：:]/g, "");
  if (!/^(?:请|请你|麻烦)?(?:帮我|给我)?(?:写|写一下|写一篇|写篇|整理|整理一下|整理一篇|记录)(?:今天的?)(?:回忆)?日记(?:吧|好吗)?$/.test(compact)) return undefined;
  // Old messages have no timestamp in this API. Recover a date from the reply heading;
  // never assign today's date to an undated historical reply.
  const heading = reply.trim().split("\n")[0];
  const dated = heading.match(/(\d{4})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})(?:日)?/);
  return dated ? `${dated[1]}-${dated[2].padStart(2,"0")}-${dated[3].padStart(2,"0")}` : fallbackDay;
}
export function formatDiaryDay(day: string) { const [year,month,date] = day.split("-"); return `${year}年${Number(month)}月${Number(date)}日`; }
export function today() { const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; }

export interface DiaryContextItem { id: string; role: "user" | "assistant"; text: string }
export interface DiaryContextMedia { id: string; kind: "photo" | "video"; name: string }

export default function DiaryCard({ day, text, sourceTurn, saved, onSaved, onOpenDiary, startEditing = false, onExitEditor, context = [], media = [] }: {
  day: string; text: string; sourceTurn: string; saved?: Diary; onSaved?: (diary: Diary) => void;
  onOpenDiary?: () => void;
  startEditing?: boolean;
  onExitEditor?: () => void;
    context?: DiaryContextItem[]; media?: DiaryContextMedia[];
}) {
  const [entry,setEntry] = useState(saved);
  const [previous,setPrevious] = useState<Diary>();
  const [editing,setEditing] = useState(startEditing), [draft,setDraft] = useState(saved?.text ?? text);
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [dismissed,setDismissed] = useState(false);
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
  if (dismissed) return null;
  return <article className={styles.guideCard} aria-label={entry ? "已保存日记" : "日记草稿"}>
    <h2>{day} · {entry ? "日记已保存 ✅" : "日记草稿"}</h2>
    <p className={styles.diaryText}>{entry?.text ?? text}</p>
    {!entry && <p>要修改这篇日记吗？不修改可以直接保存。</p>}
    {previous && <details><summary>当天已有日记，保存将替换当天内容，点此核对原文</summary><p className={styles.diaryText}>{previous.text}</p></details>}
    <button type="button" disabled={busy || !loaded} onClick={()=>{setDraft(entry?.text ?? text);setEditing(true);}}>{entry ? "编辑日记" : "继续写日记"}</button>
    {!entry && <><button type="button" disabled={busy || !loaded} onClick={()=>void save(text)}>{busy ? "正在保存…" : previous ? "确认替换当日日记" : "保存日记"}</button><button type="button" disabled={busy || !loaded} onClick={()=>setDismissed(true)}>放弃保存</button></>}
    {onOpenDiary && <button type="button" disabled={busy} onClick={onOpenDiary}>查看已保存日记</button>}
    {!loaded && !error && <p role="status">正在核对日记…</p>}
    {error && !editing && <p role="alert">{error}{!loaded && <button type="button" onClick={()=>setReload(value=>value+1)}>重试核对日记</button>}</p>}
    {editing && <FeatureDialog title="日记编辑器" onClose={()=>{if(!busy){setEditing(false);onExitEditor?.();}}}>
      <section aria-label="日记编辑工作域" data-diary-editor="true">
      <p className={styles.muted}>这里是日记编辑区。内容只会保存到这一天的日记，不会发送给聊天助手，也不会触发图片、视频或上传指令。</p>
      {(context.length > 0 || media.length > 0) && <details className={styles.diaryContext} open>
        <summary>这篇日记的依据</summary>
        <p className={styles.muted}>这里只显示本次对话里已经出现的内容，编辑时不会自动加入新的事实。</p>
        {context.length > 0 && <div className={styles.diarySourceList} aria-label="原始聊天片段">
          {context.map(item => <blockquote key={item.id} data-role={item.role}><strong>{item.role === "user" ? "我" : "陪伴助手"}</strong><span>{item.text}</span></blockquote>)}
        </div>}
        {media.length > 0 && <div className={styles.diaryMediaList} aria-label="关联素材">
          {media.map(item => <span key={item.id} className={styles.diaryMediaChip}>{item.kind === "photo" ? "照片" : "视频"} · {item.name}</span>)}
        </div>}
      </details>}
      <DiaryEditor day={day} initialText={draft} busy={busy || !loaded} error={error} onSave={value=>void save(value)} onCancel={()=>{setEditing(false);onExitEditor?.();}}/>
      </section>
    </FeatureDialog>}
  </article>;
}
