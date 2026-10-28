"use client";
import {useRef,useState} from "react";
import {photoApi,type PhotoAnalysis} from "@/lib/photoApi";
import PhotoFactsEditor from "../photos/PhotoFactsEditor";
import PhotoDelete from "../photos/PhotoDelete";
import type {PhotoActionResult} from "@/lib/companionApi";
import styles from "./chat.module.css";
export default function PhotoActionCard({result}:{result:PhotoActionResult}){
 const [analysis,setAnalysis]=useState<PhotoAnalysis|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[cancelled,setCancelled]=useState(false);
 const lock=useRef(false);
 async function analyze(){if(lock.current)return;lock.current=true;setBusy(true);setError("");try{setAnalysis(await photoApi.analyze(result.photo_id));}catch(failure){setError(failure instanceof Error?failure.message:'分析失败，请重试。');}finally{lock.current=false;setBusy(false);}}
 if(cancelled)return <p>已取消这次操作。</p>;
 return <article className={styles.guideCard} aria-label="照片操作确认">
 <p>{result.spoken_text}</p>
 {result.action==='delete'?<PhotoDelete photoId={result.photo_id} initialConfirm/>:result.action==='edit'?<PhotoFactsEditor photoId={result.photo_id} initialPatch={result.facts} expectedRevision={result.expected_revision}/>:analysis?<PhotoFactsEditor photoId={result.photo_id} analysis={analysis}/>:<button type="button" disabled={busy} onClick={()=>void analyze()}>{busy?'正在分析…':'确认分析这张照片'}</button>}
 {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>setCancelled(true)}>关闭</button>
 </article>;
}
