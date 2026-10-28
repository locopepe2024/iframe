"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { companionApi, type Diary } from "@/lib/companionApi";
import DiaryCard, { today } from "./DiaryCard";
import FeatureDialog from "./FeatureDialog";
import styles from "./chat.module.css";

export default function DiaryCalendar({onClose,onCreate,initialMonth}: {onClose:()=>void;onCreate:(day:string)=>void;initialMonth?:string}) {
  const [selected,setSelected]=useState(today),[month,setMonth]=useState(()=>initialMonth || today().slice(0,7));
  const [entries,setEntries]=useState<Diary[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const [reload,setReload]=useState(0);const serial=useRef(0);
  const [writing,setWriting]=useState(false);
  const [showEntry,setShowEntry]=useState(false);
  useEffect(()=>{setMonth(initialMonth || today().slice(0,7));setShowEntry(false);},[initialMonth]);
  useEffect(()=>{
    const request=++serial.current;setBusy(true);setError("");setEntries([]);
    companionApi.diaries(month).then(result=>{if(request===serial.current)setEntries(result.diaries);}).catch(()=>{if(request===serial.current)setError("日记暂时没有打开，请重试。");}).finally(()=>{if(request===serial.current)setBusy(false);});
    return ()=>{serial.current++;};
  },[month,reload]);
  const year=Number(month.slice(0,4)),number=Number(month.slice(5));
  const days=new Date(year,number,0).getDate(),offset=new Date(year,number-1,1).getDay();
  const entry=entries.find(item=>item.day===selected);
  function changeMonth(value:string){if(!/^\d{4}-\d{2}$/.test(value))return;setMonth(value);setSelected(value+"-01");setShowEntry(false);}
  function shift(delta:number){const date=new Date(year,number-1+delta,1);if(date.getFullYear()<1900||date.getFullYear()>2100)return;changeMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`);}
  return <FeatureDialog title="日记" onClose={onClose}>
    {writing && <DiaryCard day={selected} text="" sourceTurn="" startEditing onExitEditor={()=>setWriting(false)} onSaved={result=>{setEntries(old=>[...old.filter(item=>item.day!==result.day),result]);setWriting(false);}}/>}
    <div className={styles.calendarToolbar}>
      <button type="button" className={styles.albumIcon} aria-label="上个月" onClick={()=>shift(-1)}><ChevronLeft aria-hidden="true" /></button>
      <label>年月<input type="month" aria-label="选择年月" min="1900-01" max="2100-12" value={month} onChange={event=>changeMonth(event.target.value)}/></label>
      <button type="button" className={styles.albumIcon} aria-label="下个月" onClick={()=>shift(1)}><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={()=>{setMonth(today().slice(0,7));setSelected(today());setShowEntry(true);}}>今天</button>
    </div>
    <div className={styles.calendarGrid} aria-label="日记日历" aria-busy={busy}>
      {["日","一","二","三","四","五","六"].map(item=><span key={item}>{item}</span>)}
      {Array.from({length:offset},(_,i)=><span key={`empty-${i}`} />)}
      {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,"0")}`;const has=entries.some(item=>item.day===day);return <button key={day} type="button" aria-label={`${day}${has ? "，已有日记" : ""}`} aria-pressed={selected===day} onClick={()=>{setSelected(day);setShowEntry(true);}}><span className={styles.calendarDayNumber}>{i+1}</span>{has && <small className={styles.calendarDayMark} aria-hidden="true">✅</small>}</button>;})}
    </div>
    {busy ? <p role="status">正在读取日记…</p> : error ? <p role="alert">{error}<button type="button" onClick={()=>setReload(value=>value+1)}>重试读取日记</button></p> : entry && !showEntry ? <p>选择日期查看日记。</p> : entry ? <DiaryCard key={`${entry.day}-${entry.revision}`} day={entry.day} text={entry.text} sourceTurn={entry.source_turn_id} saved={entry} onSaved={result=>setEntries(old=>old.map(item=>item.day===result.day ? result : item))}/> : <div className={styles.featureEmpty}><p>{selected} 还没有保存日记。</p><button type="button" onClick={()=>setWriting(true)}>开始记录日记</button><button type="button" onClick={()=>onCreate(selected)}>整理这一天的日记</button></div>}
  </FeatureDialog>;
}
