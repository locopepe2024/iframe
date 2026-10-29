"use client";
import { useRef, useState } from "react";
import type { ChoiceCard as Card, SourceChoiceEvent } from "@/lib/companionApi";

const actions = {upload:"media.open_upload",album:"media.open_album",back:"media.pause"} as const;
export default function ChoiceCard({card,disabled,onChoose}:{card:Card;disabled:boolean;onChoose:(event:SourceChoiceEvent)=>Promise<boolean>}) {
 const operation=useRef<SourceChoiceEvent|null>(null);
 const pending=useRef(false);
 const [state,setState]=useState<"ready"|"pending"|"retry">("ready");
 const valid=card.protocol==="companion.ui.v1" && card.component==="choice_card" && card.status==="active" &&
  card.props.options.length===3 && new Set(card.props.options.map(o=>o.id)).size===3 &&
  card.props.options.every(o=>actions[o.id]===o.action);
 if(!valid) return <p role="alert">这张操作卡片暂不可用，请重新告诉小安想做什么。</p>;
 async function choose(id:SourceChoiceEvent["option_id"]) {
  if(pending.current || disabled) return;
  if(!operation.current) operation.current={operation_id:crypto.randomUUID(),card_id:card.card_id,option_id:id};
  pending.current=true;setState("pending");
  try {const ok=await onChoose(operation.current);if(ok){operation.current=null;setState("ready");}else setState("retry");}
  catch {setState("retry");}
  finally {pending.current=false;}
 }
 return <fieldset aria-label={card.props.title} aria-busy={state==="pending"} disabled={disabled||state==="pending"} style={state==="pending" ? {border:"2px solid var(--accent)",borderRadius:12,padding:12} : undefined}>
  <legend>{card.props.title}</legend>
  <div style={{display:"grid",gap:8}}>
   {state!=="retry" && card.props.options.map(option=><button key={option.id} type="button" aria-current={state==="pending" && operation.current?.option_id===option.id ? "step" : undefined} style={{minHeight:44,margin:0,border:state==="pending" && operation.current?.option_id===option.id ? "2px solid var(--accent)" : undefined}} onClick={()=>void choose(option.id)}>{option.label}</button>)}
   {state==="pending" && <span role="status">正在处理选择…</span>}
   {state==="retry" && <><p role="alert">这次选择尚未确认，可以重试。</p><button type="button" style={{minHeight:44}} onClick={()=>{if(operation.current)void choose(operation.current.option_id);}}>重试这次选择</button></>}
  </div>
 </fieldset>;
}
