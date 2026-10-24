"use client";
import { useEffect, useRef, useState } from "react";
import { companionServices, type ServiceModel, type GenerationJob } from "@/lib/companionServices";
import type { GenerationDraft } from "./GenerationGuide";
export default function GenerationSubmit({value,onSubmitted}:{value:GenerationDraft;onSubmitted:(pending:boolean)=>void}) {
  const [models,setModels]=useState<ServiceModel[]>([]),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[job,setJob]=useState<GenerationJob|null>(null),[url,setUrl]=useState("");
  const operation=useRef("");
  const resource=useRef("");
  useEffect(()=>{if(job && job.status!=="running")onSubmitted(false);},[job,onSubmitted]);
  useEffect(()=>{if(!job || job.status!=="running")return;let stopped=false;const timer=setInterval(async()=>{try{const next=await companionServices.job(job.id);if(!stopped)setJob(next);}catch{if(!stopped)setError("进度读取失败，稍后会继续查询。");}},3000);return()=>{stopped=true;clearInterval(timer);};},[job]);
  useEffect(()=>{if(job?.status!=="completed")return;let stopped=false;companionServices.media(job.id).then(blob=>{if(!stopped){resource.current=URL.createObjectURL(blob);setUrl(resource.current);}}).catch(()=>{if(!stopped)setError("结果读取失败，请重新查看任务。");});return()=>{stopped=true;if(resource.current)URL.revokeObjectURL(resource.current);};},[job]);
  if(value.reference)return <p>参考照片已保留。本轮先开放文字生成；参考素材生成需要接通素材授权传输后测试。</p>;
  return <section aria-label="UniArt 生成"><h3>使用 UniArt 生成</h3>
  {!job&&<><button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const data=await companionServices.models();setModels(data.models.filter(m=>m.capabilities.includes(value.mode==="image"?"t2i":"t2v")));}catch(e){setError(e instanceof Error?e.message:"读取失败。");}finally{setBusy(false);}}}>读取我的可用模型</button>
  {models.length>0&&<label>生成模型<select disabled={busy||!!operation.current} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择</option>{models.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label>}
  <p>将发送本次描述给个人 UniArt 渠道。费用按渠道结算，当前未提供预报价。</p>
  <button disabled={busy||!selected} onClick={async()=>{if(!operation.current){operation.current=crypto.randomUUID();onSubmitted(true);}setBusy(true);setError("");try{setJob(await companionServices.generate({operation_id:operation.current,mode:value.mode,model:selected,prompt:value.prompt,setting:value.setting,reference:null,allow_external_generation:true}));}catch(e){setError(e instanceof Error?e.message:"生成未确认，请使用原请求重试。");}finally{setBusy(false);}}}>{busy?"正在提交…":operation.current?"查询或重试原生成请求":"确认生成（可能计费）"}</button></>}
  {job&&<p role="status">{job.status==="running"?"正在生成，请稍候。":job.status==="failed"?"生成失败；没有自动重新提交。":"生成完成。"}</p>}
  {url&&(value.mode==="image"?<img src={url} alt="生成的图片" style={{maxWidth:"100%"}}/>:<video src={url} controls style={{maxWidth:"100%"}}/>)}
  {error&&<p role="alert">{error}</p>}
  </section>;
}
