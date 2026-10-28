"use client";

import { useState } from "react";
import { CalendarDays, Clock, Images, Users, X } from "lucide-react";
import AlbumPicker from "./AlbumPicker";
import styles from "./chat.module.css";

export default function AlbumScopeCard({ browse = false, disabled = false, onSelect }: {
  browse?: boolean; disabled?: boolean; onSelect: (id: string) => void;
}) {
  const [choice, setChoice] = useState<"time" | "person" | null>(null);
  const [date, setDate] = useState("");
  const [person, setPerson] = useState("");
  const [picker, setPicker] = useState<{ date?: string; query?: string; order?: "recent" } | null>(browse ? {} : null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <article className={styles.guideCard} aria-label="选择整理范围">
    <div className={styles.albumHeader}><h2>想整理哪些照片？</h2><button type="button" className={styles.albumIcon} aria-label="关闭整理引导" onClick={() => { setPicker(null); setDismissed(true); }}><X size={20} aria-hidden="true" /></button></div>
    <p>想看什么时候、和谁有关的照片？也可以自己挑一张。</p>
    <div className={styles.choices}>
      <button type="button" disabled={disabled} onClick={() => setPicker({order: "recent"})}><Clock size={20} aria-hidden="true" />最近加入</button>
      <button type="button" disabled={disabled} aria-pressed={choice === "time"} onClick={() => setChoice("time")}><CalendarDays size={20} aria-hidden="true" />按时间找</button>
      <button type="button" disabled={disabled} aria-pressed={choice === "person"} onClick={() => setChoice("person")}><Users size={20} aria-hidden="true" />按人物找</button>
      <button type="button" disabled={disabled} onClick={() => setPicker({})}><Images size={20} aria-hidden="true" />打开相册</button>
    </div>
    {choice && <form onSubmit={event => { event.preventDefault(); setPicker(choice === "time" ? {date: date.trim()} : {query: person.trim()}); }}>
      {choice === "time" ? <label>哪一年或哪一天？<input aria-label="照片日期" value={date} onChange={event => setDate(event.target.value)} placeholder="例如 2025 或 2025-10-01" pattern="[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?" required maxLength={10} disabled={disabled} /></label> : <><label>想找谁？<input aria-label="照片人物" value={person} onChange={event => setPerson(event.target.value)} required maxLength={100} disabled={disabled} placeholder="例如女儿、小明" /></label><p>按您保存的备注和故事查找；还没记录的人物，需要先在相册里指出。</p></>}
      <button type="submit" disabled={disabled || !(choice === "time" ? date.trim() : person.trim())}>找这些照片</button>
      <button type="button" onClick={() => setChoice(null)}>返回</button>
    </form>}
    {picker && <AlbumPicker initialDate={picker.date} initialQuery={picker.query} order={picker.order} disabled={disabled} onClose={() => setPicker(null)} onPhoto={photo => { setPicker(null); onSelect(photo.photo_id); }} />}
  </article>;
}
