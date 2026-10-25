"use client";
import { useEffect, useState } from "react";

export const companionIdentityKey="iframe-companion-identity-v1";
export type CompanionIdentity={name:string;avatar:string;voice:string};
export const defaultCompanionIdentity:CompanionIdentity={name:"小安",avatar:"🌿",voice:"longanhuan_v3.6"};
export function readCompanionIdentity():CompanionIdentity {
  try { const value=JSON.parse(localStorage.getItem(companionIdentityKey)||"null"); return {...defaultCompanionIdentity,...(value||{})}; } catch { return defaultCompanionIdentity; }
}
export default function CompanionIdentitySettings({onChange}:{onChange:(value:CompanionIdentity)=>void}) {
 const [value,setValue]=useState(defaultCompanionIdentity),[notice,setNotice]=useState("");
 useEffect(()=>setValue(readCompanionIdentity()),[]);
 function update(next:Partial<CompanionIdentity>){const result={...value,...next};setValue(result);localStorage.setItem(companionIdentityKey,JSON.stringify(result));onChange(result);setNotice("陪伴助手设置已保存。");}
 return <section aria-label="陪伴助手设置"><h2>陪伴助手</h2>
  <label>名字<input value={value.name} maxLength={24} onChange={e=>update({name:e.target.value})}/></label>
  <fieldset><legend>形象</legend><div className="companion-avatar-options">{["🌿","🌼","🐻","🐶","🧓"].map(item=><button type="button" key={item} aria-label={`选择形象 ${item}`} aria-pressed={value.avatar===item} onClick={()=>update({avatar:item})}>{item}</button>)}</div></fieldset>
  <label>音色<select value={value.voice} onChange={e=>update({voice:e.target.value})}><option value="longanhuan_v3.6">温和女声</option><option value="longanyang_v3.6">沉稳男声</option></select></label>
  <p role="status">{notice||"名字、形象和音色会用于聊天与朗读。"}</p>
 </section>;
}
