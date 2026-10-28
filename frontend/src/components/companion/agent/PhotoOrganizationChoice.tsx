"use client";

import {useState} from "react";
import {ArrowLeft} from "lucide-react";
import PhotoContent from "../photos/PhotoContent";
import PhotoFactsEditor from "../photos/PhotoFactsEditor";

export default function PhotoOrganizationChoice({photoId, name, disabled = false}: {photoId:string; name:string; disabled?:boolean}) {
  const [mode,setMode] = useState<"choose" | "manual" | "assisted" | "later" | "saved">("choose");
  function leave(next: "choose" | "later") {
    if (window.confirm("请确认已保存需要保留的资料，未保存的填写内容会丢失。要离开整理吗？")) setMode(next);
  }
  if (mode === "later") return null;
  if (mode === "saved") return <p role="status">照片资料已保存。</p>;
  return <section aria-label={`整理照片：${name}`}>
    {mode === "choose" ? <>
      <p>照片已加入相册，要整理一下吗？</p>
      <button type="button" disabled={disabled} onClick={()=>setMode("manual")}>自己填写</button>
      <button type="button" disabled={disabled} onClick={()=>setMode("assisted")}>小安帮我整理</button>
      <button type="button" disabled={disabled} onClick={()=>setMode("later")}>以后再说</button>
    </> : <>
      <button type="button" aria-label="返回选择整理方式" onClick={()=>leave("choose")}><ArrowLeft size={20} aria-hidden="true"/></button>
      {mode === "manual" ? <PhotoFactsEditor photoId={photoId} onSaved={()=>setMode("saved")}/> : <PhotoContent photoId={photoId} onSaved={()=>setMode("saved")}/>}
    </>}
  </section>;
}
