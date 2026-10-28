"use client";
import { useEffect, useRef, useState } from "react";
import { photoApi, type PhotoAnalysis, type PhotoAnnotations, type PhotoFacts } from "@/lib/photoApi";
import styles from "./PhotoFactsEditor.module.css";

function analysisDraft(facts: PhotoFacts, analysis?: PhotoAnalysis | null): PhotoFacts {
  if (!analysis) return facts;
  return {...facts,
    scene: facts.scene || (analysis.observation.scene || "").slice(0,1600),
    lighting: facts.lighting || (analysis.observation.lighting || "").slice(0,500),
    people: facts.people.length ? facts.people : (analysis.observation.people || []).slice(0,30).map(person=>({
      reference: [person.reference,person.position].filter(Boolean).join(" ").slice(0,120),
      name:"", age:null, gender:"unknown" as const,
    })),
  };
}

export default function PhotoFactsEditor({photoId, analysis, initialPatch, expectedRevision, onSaved}: {photoId: string; analysis?: PhotoAnalysis | null; initialPatch?: Partial<PhotoFacts>; expectedRevision?: number; onSaved?:()=>void}) {
  const [record,setRecord] = useState<PhotoAnnotations | null>(null);
  const [facts,setFacts] = useState<PhotoFacts | null>(null);
  const [busy,setBusy] = useState(false),[error,setError] = useState(""),[notice,setNotice] = useState("");
  const pending = useRef<{operation_id:string;expected_revision:number;facts:PhotoFacts}|null>(null);
  const lock = useRef(false);
  const edited = useRef(false), seeded = useRef(false);
  useEffect(()=>{let active=true;edited.current=false;seeded.current=false;setFacts(null);setRecord(null);setError("");photoApi.annotations(photoId).then(value=>{if(active){if(expectedRevision !== undefined && expectedRevision !== value.revision){setError("照片资料已有更新，请重新提出修改。");return;}setRecord(value);setFacts({...value.facts,...initialPatch});}}).catch(()=>{if(active)setError("资料暂未读出，请重新打开照片。");});return()=>{active=false;};},[photoId, expectedRevision]);
  useEffect(()=>{
    if (!analysis || !record || record.revision !== 0 || edited.current || seeded.current || initialPatch) return;
    seeded.current=true;
    setFacts(current=>current ? analysisDraft(current,analysis) : current);
  },[analysis,record,initialPatch]);
  function change(next: PhotoFacts) {edited.current=true;setFacts(next);setNotice("");}
  async function save(){
    if(!facts || !record || lock.current)return;
    lock.current=true;setBusy(true);setError("");
    pending.current ??= {operation_id:crypto.randomUUID(),expected_revision:record.revision,facts};
    try{const value=await photoApi.saveAnnotations(photoId,pending.current);setRecord(value);setFacts(value.facts);pending.current=null;setNotice("照片资料已保存。");onSaved?.();}
    catch(failure){setError(failure instanceof Error ? failure.message : "保存未确认，请重试原操作。");}
    finally{lock.current=false;setBusy(false);}
  }
  if(!facts)return <section aria-label="照片资料">{error ? <p role="alert">{error}</p> : <p role="status">正在读取照片资料…</p>}</section>;
  const blocked=busy || !!pending.current;
  return <section className={styles.editor} aria-label="照片资料">
    <h3>照片资料</h3>
    {seeded.current && !notice && <p className={styles.hint}>已预填画面信息，请核对后保存。</p>}
    <fieldset className={styles.fields} disabled={blocked}>
      <legend>人物</legend>
      {facts.people.map((person,index)=><div key={index}>
        <label>姓名<input placeholder={`人物 ${index+1}，也可填称呼`} maxLength={100} value={person.name} onChange={e=>change({...facts,people:facts.people.map((p,i)=>i===index?{...p,name:e.target.value}:p)})}/></label>
        <details className={styles.details}><summary>{`人物 ${index+1} 的更多资料`}</summary>
        <label>画面位置<input maxLength={120} value={person.reference} onChange={e=>change({...facts,people:facts.people.map((p,i)=>i===index?{...p,reference:e.target.value}:p)})}/></label>
        <label>年龄<input type="number" min={0} max={130} value={person.age ?? ""} onChange={e=>change({...facts,people:facts.people.map((p,i)=>i===index?{...p,age:e.target.value===""?null:Number(e.target.value)}:p)})}/></label>
        <label>性别<select value={person.gender} onChange={e=>change({...facts,people:facts.people.map((p,i)=>i===index?{...p,gender:e.target.value as typeof p.gender}:p)})}><option value="unknown">未填写</option><option value="female">女</option><option value="male">男</option><option value="other">其他</option></select></label>
        <button type="button" onClick={()=>change({...facts,people:facts.people.filter((_,i)=>i!==index)})}>移除此人物资料</button>
        </details>
      </div>)}
      <button type="button" disabled={facts.people.length>=30} onClick={()=>change({...facts,people:[...facts.people,{reference:"",name:"",age:null,gender:"unknown"}]})}>添加人物</button>
    </fieldset>
    <fieldset className={styles.fields} disabled={blocked}>
      <label>地点<input maxLength={300} placeholder="在哪里？不记得可留空" value={facts.location} onChange={e=>change({...facts,location:e.target.value})}/></label>
      <label>拍摄时间<input maxLength={25} placeholder="例如 2026、2026-10 或 2026-10-28" value={facts.capture_time} onChange={e=>change({...facts,capture_time:e.target.value})}/></label>
      <label>备注<textarea rows={2} maxLength={1600} placeholder="想补充的内容，可留空" value={facts.notes} onChange={e=>change({...facts,notes:e.target.value})}/></label>
      <details className={styles.details}><summary>画面与更多资料</summary>
      {([['scene','场景'],['lighting','光影']] as const).map(([key,label])=><label key={key}>{label}<textarea rows={3} maxLength={key==='lighting'?500:1600} value={facts[key]} onChange={e=>change({...facts,[key]:e.target.value})}/></label>)}
      <details><summary>地理坐标</summary>{(['latitude','longitude'] as const).map(key=><label key={key}>{key==='latitude'?'纬度':'经度'}<input type="number" step="any" min={key==='latitude'?-90:-180} max={key==='latitude'?90:180} value={facts[key]??""} onChange={e=>change({...facts,[key]:e.target.value===""?null:Number(e.target.value)})}/></label>)}</details>
      </details>
    </fieldset>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={()=>void save()}>{busy?'正在保存…':pending.current?'重试原保存':'保存照片资料'}</button>
  </section>;
}
