"use client";
import { useState } from "react";
import type { MediaDraft } from "@/lib/companionApi";
import GenerationSubmit from "./GenerationSubmit";
import AlbumPicker from "./AlbumPicker";
import PhotoImage from "../photos/PhotoImage";
import styles from "./chat.module.css";

export default function MediaDraftCard({task,disabled,onAction,onUpload,onRefresh}:{
 task:MediaDraft;disabled:boolean;
 onAction:(action:"clear_photo"|"select_photo"|"setting"|"pause"|"resume"|"cancel",photo?:string)=>Promise<boolean>;
 onUpload:()=>void;onRefresh?:()=>void;
}) {
 const [album,setAlbum]=useState(false);
 const [reserved,setReserved]=useState(false);
 const title=task.type==="image_edit"?"修改照片":task.type==="image_generate"?"生成图片":"生成视频";
 return <section className={styles.guideCard} aria-label="当前创作任务">
  <h2>{title}</h2><p>{task.spoken_text}</p>
  {task.photo_id && <PhotoImage id={task.photo_id}/>}
  {task.brief && <><h3>{task.type==="image_edit"?"修改要求":"创作内容"}</h3><p>{task.brief}</p></>}
  <fieldset disabled={disabled||reserved}>
   {task.status==="active" && <>
    <button type="button" onClick={()=>setAlbum(true)}>{task.photo_id?"换一张照片":"从相册选择照片"}</button>
    <button type="button" onClick={onUpload}>上传照片</button>
    {task.photo_id && task.type!=="image_edit" && <button type="button" onClick={()=>void onAction("clear_photo")}>不使用参考照片</button>}
    <button type="button" onClick={()=>void onAction("pause")}>先聊会儿</button>
    <button type="button" onClick={()=>void onAction("cancel")}>取消创作</button>
   </>}
   {task.status==="paused" && <><button type="button" onClick={()=>void onAction("resume")}>继续这次创作</button><button type="button" onClick={()=>void onAction("cancel")}>取消创作</button></>}
  </fieldset>
  {(task.step==="configuring"||task.status==="submitted") && <>
   {task.status==="active" && <label>{task.type==="video_generate"?"时长":"比例"}<select aria-label="创作参数" disabled={disabled||reserved} value={task.setting} onChange={e=>void onAction("setting",e.target.value)}>
    {(task.type==="video_generate"?["5 秒","10 秒"]:["方形 1:1","横向 16:9","竖向 9:16"]).map(value=><option key={value}>{value}</option>)}
   </select></label>}
   <GenerationSubmit key={`${task.task_id}:${task.revision}`} value={{mode:task.type==="video_generate"?"video":"image",prompt:task.brief,reference:task.photo_id,setting:task.setting,step:"confirmed",task_id:task.task_id,expected_revision:task.revision,job_id:task.job_id}} disabled={disabled} onSubmitted={setReserved} onAccepted={onRefresh}/>
  </>}
  {album && task.status==="active" && <AlbumPicker disabled={disabled} onClose={()=>setAlbum(false)} onPhoto={photo=>{void onAction("select_photo",photo.photo_id).then(ok=>{if(ok)setAlbum(false);});}}/>}
 </section>;
}
