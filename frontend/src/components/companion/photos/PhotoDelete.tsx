"use client";
import {useRef,useState} from "react";
import {photoApi} from "@/lib/photoApi";
export default function PhotoDelete({photoId,onDeleted,initialConfirm=false}:{photoId:string;onDeleted?:()=>void;initialConfirm?:boolean}){
 const [confirm,setConfirm]=useState(initialConfirm),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState("");
 const operation=useRef("");const lock=useRef(false);
 async function remove(){if(lock.current)return;lock.current=true;setBusy(true);setError("");operation.current ||= crypto.randomUUID();try{await photoApi.deletePhoto(photoId,operation.current);setDone(true);onDeleted?.();window.dispatchEvent(new CustomEvent("companion-photo-deleted",{detail:{photoId}}));}catch{setError("删除尚未确认，请重试原操作。");}finally{lock.current=false;setBusy(false);}}
 if(done)return <p role="status">照片已从相册删除。</p>;
 return <section aria-label="删除照片">{confirm?<><p>要从相册删除这张照片吗？</p><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?'正在删除…':error?'重试删除':'确认删除照片'}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>保留照片</button></>:<button type="button" onClick={()=>setConfirm(true)}>删除这张照片</button>}{error&&<p role="alert">{error}</p>}</section>;
}
