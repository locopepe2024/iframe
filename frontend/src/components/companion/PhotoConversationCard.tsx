"use client";

import {useState} from "react";
import PhotoImage from "./photos/PhotoImage";
import MediaViewer from "./agent/MediaViewer";
import chatStyles from "./agent/chat.module.css";
import styles from "./photos/photos.module.css";

export default function PhotoConversationCard({photoId,label,selected,onOrganize}:{photoId:string;label:string;selected?:boolean;onOrganize?:()=>void}) {
  const [opened,setOpened]=useState(false);
  return <article className={styles.panel} aria-label={label} aria-current={selected ? "true" : undefined} style={selected ? {borderColor:"var(--accent)",boxShadow:"0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)"} : undefined}>
    <button className={chatStyles.mediaThumbnail} type="button" aria-label={`查看${label}`} onClick={()=>setOpened(true)}><PhotoImage id={photoId}/></button>
    {opened && <MediaViewer items={[{id:photoId,kind:"photo",name:label}]} onClose={()=>setOpened(false)} useLabel="整理这张照片" onUse={onOrganize?()=>{setOpened(false);onOrganize();}:undefined}/>}
  </article>;
}
