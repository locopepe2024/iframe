"use client";
import { useState } from "react";
import type { MediaDraft } from "@/lib/companionApi";
import AlbumPicker from "./AlbumPicker";
import PhotoImage from "../photos/PhotoImage";
import styles from "./chat.module.css";

export default function MediaDraftCard({task,disabled,onAction,onUpload}:{
 task:MediaDraft;disabled:boolean;
 onAction:(action:"clear_photo"|"select_photo"|"pause"|"resume"|"cancel",photo?:string)=>Promise<boolean>;
 onUpload:()=>void;
}) {
 const [album,setAlbum]=useState(false);
 const title=task.type==="image_edit"?"修改照片":task.type==="image_generate"?"生成图片":"生成视频";
 return <section className={styles.guideCard} aria-label="当前创作任务">
  <h2>{title}</h2><p>{task.spoken_text}</p>
  {task.photo_id && <PhotoImage id={task.photo_id}/>}
  {task.brief && <><h3>{task.type==="image_edit"?"修改要求":"创作内容"}</h3><p>{task.brief}</p></>}
  <fieldset disabled={disabled}>
   {task.status==="active" && <>
    <button type="button" onClick={()=>setAlbum(true)}>{task.photo_id?"换一张照片":"从相册选择照片"}</button>
    <button type="button" onClick={onUpload}>上传照片</button>
    {task.photo_id && task.type!=="image_edit" && <button type="button" onClick={()=>void onAction("clear_photo")}>不使用参考照片</button>}
    <button type="button" onClick={()=>void onAction("pause")}>先聊会儿</button>
    <button type="button" onClick={()=>void onAction("cancel")}>取消创作</button>
   </>}
   {task.status==="paused" && <><button type="button" onClick={()=>void onAction("resume")}>继续这次创作</button><button type="button" onClick={()=>void onAction("cancel")}>取消创作</button></>}
  </fieldset>
  {album && task.status==="active" && <AlbumPicker disabled={disabled} onClose={()=>setAlbum(false)} onPhoto={photo=>{void onAction("select_photo",photo.photo_id).then(ok=>{if(ok)setAlbum(false);});}}/>}
 </section>;
}
