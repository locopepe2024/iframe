"use client";
import { useEffect, useState } from "react";
import type { MediaDraft } from "@/lib/companionApi";
import GenerationSubmit from "./GenerationSubmit";
import AlbumPicker from "./AlbumPicker";
import PhotoImage from "../photos/PhotoImage";
import styles from "./chat.module.css";
type Action = "clear_photo"|"select_photo"|"select_first_photo"|"select_last_photo"|"add_reference_photo"|"remove_reference_photo"|"video_mode"|"setting"|"pause"|"resume"|"cancel";
export default function MediaDraftCard({task,disabled,onAction,onUpload,onRefresh}:{task:MediaDraft;disabled:boolean;onAction:(action:Action,photo?:string)=>Promise<boolean>;onUpload:()=>void;onRefresh?:()=>void}) {
 const [album,setAlbum]=useState(false); const [albumTarget,setAlbumTarget]=useState<"photo"|"first"|"last"|"reference">("photo"); const [reserved,setReserved]=useState(false);
 const video=task.type==="video_generate", videoMode=task.video_mode||"t2v";
 const title=task.type==="image_edit"?"修改照片":task.type==="image_generate"?"生成图片":"生成视频";
 const openAlbum=(target:typeof albumTarget)=>{setAlbumTarget(target);setAlbum(true);};
 useEffect(()=>{
  if(task.ui_action === "open_album" && task.status === "active") openAlbum("photo");
 },[task]);
 return <section className={styles.guideCard} aria-label="当前创作任务">
  <h2>{title}</h2><p>{task.spoken_text}</p>
  {!video && task.photo_id && <PhotoImage id={task.photo_id}/>} {task.brief && <><h3>{task.type==="image_edit"?"修改要求":"创作内容"}</h3><p>{task.brief}</p></>}
  <fieldset disabled={disabled||reserved}>
   {task.status==="active" && <>
    {video && <label>视频方式<select aria-label="视频方式" value={videoMode} onChange={e=>void onAction("video_mode",e.target.value)}><option value="t2v">文字生成</option><option value="i2v">让一张照片动起来</option><option value="f2v">首尾画面</option><option value="r2v">多张参考</option></select></label>}
    {!video && <><button type="button" onClick={()=>openAlbum("photo")}>{task.photo_id?"换一张照片":"从相册选择照片"}</button><button type="button" onClick={onUpload}>上传照片</button>{task.photo_id && task.type!=="image_edit" && <button type="button" onClick={()=>void onAction("clear_photo")}>不使用参考照片</button>}</>}
    {videoMode==="i2v" && <button type="button" onClick={()=>openAlbum("first")}>{task.first_photo_id?"更换首帧照片":"选择首帧照片"}</button>}
    {videoMode==="f2v" && <><button type="button" onClick={()=>openAlbum("first")}>{task.first_photo_id?"更换首帧":"选择首帧"}</button><button type="button" onClick={()=>openAlbum("last")}>{task.last_photo_id?"更换尾帧":"选择尾帧"}</button></>}
    {videoMode==="r2v" && <><button type="button" onClick={()=>openAlbum("reference")}>添加参考照片</button>{(task.reference_photo_ids||[]).map(id=><button key={id} type="button" onClick={()=>void onAction("remove_reference_photo",id)}>移除参考 {id.slice(0,6)}</button>)}</>}
    <button type="button" onClick={()=>void onAction("pause")}>先聊会儿</button><button type="button" onClick={()=>void onAction("cancel")}>取消创作</button>
   </>}
   {task.status==="paused" && <><button type="button" onClick={()=>void onAction("resume")}>继续这次创作</button><button type="button" onClick={()=>void onAction("cancel")}>取消创作</button></>}
  </fieldset>
  {(task.step==="configuring"||task.status==="submitted") && <>
   {task.status==="active" && <label>{video?"时长":"比例"}<select aria-label="创作参数" disabled={disabled||reserved} value={task.setting} onChange={e=>void onAction("setting",e.target.value)}>{(video?["5 秒","10 秒"]:["方形 1:1","横向 16:9","竖向 9:16"]).map(value=><option key={value}>{value}</option>)}</select></label>}
   <GenerationSubmit key={`${task.task_id}:${task.revision}`} value={{mode:video?"video":"image",prompt:task.brief,reference:video?null:task.photo_id,first_reference:task.first_photo_id,last_reference:task.last_photo_id,references:task.reference_photo_ids||[],video_mode:videoMode,setting:task.setting,step:"confirmed",task_id:task.task_id,expected_revision:task.revision,job_id:task.job_id}} disabled={disabled} onSubmitted={setReserved} onAccepted={onRefresh}/>
  </>}
  {album && task.status==="active" && <AlbumPicker disabled={disabled} onClose={()=>setAlbum(false)} onPhoto={photo=>{const action=albumTarget==="first"?"select_first_photo":albumTarget==="last"?"select_last_photo":albumTarget==="reference"?"add_reference_photo":"select_photo";void onAction(action,photo.photo_id).then(ok=>{if(ok)setAlbum(false);});}}/>}
 </section>;
}
