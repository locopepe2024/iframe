"use client";
import { useEffect, useState } from "react";
import { companionServices } from "@/lib/companionServices";
export default function UniArtSettings() {
  const [key,setKey]=useState(""),[url,setUrl]=useState("https://uniart.fun/v1"),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  useEffect(()=>{ companionServices.channel().then(c=>{setUrl(c.base_url);setNotice(c.configured?"个人渠道已配置。":"请填写个人 UniArt API Key。");}).catch(()=>setNotice("渠道设置读取失败。")); },[]);
  return <section aria-label="UniArt 渠道设置"><h2>UniArt 渠道</h2>
    <label>API 地址<input value={url} type="url" onChange={e=>setUrl(e.target.value)} disabled={busy}/></label>
    <label>API Key<input type="password" autoComplete="off" value={key} placeholder="留空保留现有密钥" onChange={e=>setKey(e.target.value)} disabled={busy}/></label>
    <button disabled={busy} onClick={async()=>{setBusy(true);try{await companionServices.saveChannel(url,key||undefined);setKey("");setNotice("渠道已保存，可测试图片、视频与朗读。");}catch(e){setNotice(e instanceof Error?e.message:"保存失败。");}finally{setBusy(false);}}}>保存渠道</button>
    <p role="status">{notice}</p><p>密钥加密保存在测试站。生成与朗读会使用此渠道并可能计费。</p>
  </section>;
}
