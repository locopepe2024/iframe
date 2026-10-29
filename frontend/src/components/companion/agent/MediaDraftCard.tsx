"use client";
import { useEffect, useRef, useState } from "react";
import type { MediaDraft, SourceChoiceEvent } from "@/lib/companionApi";
import ChoiceCard from "./ChoiceCard";
import AssetSlotCard from "./AssetSlotCard";
import GenerationSubmit from "./GenerationSubmit";
import AlbumPicker from "./AlbumPicker";
import PhotoImage from "../photos/PhotoImage";
import styles from "./chat.module.css";
type Action = "clear_photo"|"select_photo"|"select_first_photo"|"select_last_photo"|"add_reference_photo"|"remove_reference_photo"|"video_mode"|"setting"|"pause"|"resume"|"cancel";
export default function MediaDraftCard({task,disabled,onAction,onUpload,onRefresh,onChooseSource,onAssetSelected}:{task:MediaDraft;disabled:boolean;onAction:(action:Action,photo?:string)=>Promise<boolean>;onUpload:()=>void;onRefresh?:()=>void;onChooseSource?:(event:SourceChoiceEvent)=>Promise<boolean>;onAssetSelected?:(photoId:string,slot:"source"|"first_frame"|"last_frame"|"reference",cardId:string)=>Promise<boolean>}) {
 const [album,setAlbum]=useState(false); const [albumTarget,setAlbumTarget]=useState<"photo"|"first"|"last"|"reference">("photo"); const [reserved,setReserved]=useState(false);
 const [selectionError,setSelectionError]=useState("");
 const video=task.type==="video_generate", videoMode=task.video_mode||"t2v";
 const title=task.type==="image_edit"?"修改照片":task.type==="image_generate"?"生成图片":"生成视频";
 const openAlbum=(target:typeof albumTarget)=>{setAlbumTarget(target);setAlbum(true);};
 const handledNavigation=useRef("");
 useEffect(()=>{
  const event=task.ui_event_id || `${task.task_id}:${task.revision}:${task.ui_action}`;
  if(task.ui_action === "open_album" && task.status === "active" && handledNavigation.current!==event) {handledNavigation.current=event;openAlbum("photo");}
 },[task.task_id,task.revision,task.status,task.ui_action,task.ui_event_id]);
 const assetCard=task.asset_card && video && task.status==="active" && task.asset_card.task.id===task.task_id && task.asset_card.task.revision===task.revision ? task.asset_card : null;
 const sourceCard=task.ui_card && onChooseSource && task.status==="active" && task.type==="image_edit" && !task.photo_id &&
  task.ui_card.task.id===task.task_id && task.ui_card.task.revision===task.revision ? task.ui_card : null;
 return <section className={styles.guideCard} aria-label="当前创作任务">
  <h2>{title}</h2>{!sourceCard && <p>{task.spoken_text}</p>}
  {assetCard && <AssetSlotCard card={assetCard} disabled={disabled||reserved} onAlbum={()=>openAlbum(assetCard.slot==="first_frame"?"first":assetCard.slot==="last_frame"?"last":"reference")} onBack={()=>void onAction("pause")}/>}
  {sourceCard && <ChoiceCard key={sourceCard.card_id} card={sourceCard} disabled={disabled||reserved} onChoose={onChooseSource!}/>}
  {sourceCard && task.ui_action==="open_upload" && <button type="button" disabled={disabled||reserved} onClick={onUpload}>选择手机或电脑里的照片</button>}
  {!video && task.photo_id && <PhotoImage id={task.photo_id}/>} {task.brief && <><h3>{task.type==="image_edit"?"修改要求":"创作内容"}</h3><p>{task.brief}</p></>}
  <fieldset disabled={disabled||reserved}>
   {task.status==="active" && <>
    {video && <label>视频方式<select aria-label="视频方式" value={videoMode} onChange={e=>void onAction("video_mode",e.target.value)}><option value="t2v">文字生成</option><option value="i2v">让一张照片动起来</option><option value="f2v">首尾画面</option><option value="r2v">多张参考</option></select></label>}
    {!video && !sourceCard && <><button type="button" onClick={()=>openAlbum("photo")}>{task.photo_id?"换一张照片":"从相册选择照片"}</button><button type="button" onClick={onUpload}>上传照片</button>{task.photo_id && task.type!=="image_edit" && <button type="button" onClick={()=>void onAction("clear_photo")}>不使用参考照片</button>}</>}
    {videoMode==="i2v" && !assetCard && <button type="button" onClick={()=>openAlbum("first")}>{task.first_photo_id?"更换首帧照片":"选择首帧照片"}</button>}
    {videoMode==="f2v" && !assetCard && <><button type="button" onClick={()=>openAlbum("first")}>{task.first_photo_id?"更换首帧":"选择首帧"}</button><button type="button" onClick={()=>openAlbum("last")}>{task.last_photo_id?"更换尾帧":"选择尾帧"}</button></>}
    {videoMode==="r2v" && !assetCard && <><button type="button" onClick={()=>openAlbum("reference")}>添加参考照片</button>{(task.reference_photo_ids||[]).map(id=><button key={id} type="button" onClick={()=>void onAction("remove_reference_photo",id)}>移除参考 {id.slice(0,6)}</button>)}</>}
    {!sourceCard && <button type="button" onClick={()=>void onAction("pause")}>先聊会儿</button>}<button type="button" onClick={()=>void onAction("cancel")}>取消创作</button>
   </>}
   {task.status==="paused" && <><button type="button" onClick={()=>void onAction("resume")}>继续这次创作</button><button type="button" onClick={()=>void onAction("cancel")}>取消创作</button></>}
  </fieldset>
  {(task.step==="configuring"||task.status==="submitted") && <>
   {task.status==="active" && <label>{video?"时长":"比例"}<select aria-label="创作参数" disabled={disabled||reserved} value={task.setting} onChange={e=>void onAction("setting",e.target.value)}>{(video?["5 秒","10 秒"]:["方形 1:1","横向 16:9","竖向 9:16"]).map(value=><option key={value}>{value}</option>)}</select></label>}
   <GenerationSubmit key={`${task.task_id}:${task.revision}`} value={{mode:video?"video":"image",prompt:task.brief,reference:video?null:task.photo_id,first_reference:task.first_photo_id,last_reference:task.last_photo_id,references:task.reference_photo_ids||[],video_mode:videoMode,setting:task.setting,step:"confirmed",task_id:task.task_id,expected_revision:task.revision,job_id:task.job_id}} disabled={disabled} onSubmitted={setReserved} onAccepted={onRefresh}/>
  </>}
  {selectionError && <p role="alert">{selectionError}<button type="button" onClick={onRefresh}>刷新任务</button></p>}
  {album && task.status==="active" && <AlbumPicker disabled={disabled} onClose={()=>setAlbum(false)} onPhoto={photo=>{const slot=albumTarget==="first"?"first_frame":albumTarget==="last"?"last_frame":albumTarget==="reference"?"reference":"source";const cardId=task.selection_cards?.[slot] || (slot==="source"?task.ui_card?.card_id:task.asset_card?.slot===slot?task.asset_card.card_id:undefined);if(!cardId || !onAssetSelected){setSelectionError("选图卡片已失效，请刷新任务后重试。");setAlbum(false);return;}setSelectionError("");void onAssetSelected(photo.photo_id,slot,cardId).then(ok=>{if(ok)setAlbum(false);else setSelectionError("照片尚未加入，请刷新任务后重试。");}).catch(()=>setSelectionError("照片尚未加入，请稍后重试。"));}}/>}
 </section>;
}
