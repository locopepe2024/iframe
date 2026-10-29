"use client";
import type { AssetSlotCard as Card } from "@/lib/companionApi";

export default function AssetSlotCard({card,disabled,onAlbum,onBack}:{card:Card;disabled:boolean;onAlbum:()=>void;onBack:()=>void}) {
  const valid=card.protocol==="companion.ui.v1" && card.component==="choice_card" && card.status==="active" &&
    card.props.options.length===2 && card.props.options.some(o=>o.id==="album"&&o.action==="media.open_album") &&
    card.props.options.some(o=>o.id==="back"&&o.action==="media.pause");
  if(!valid) return <p role="alert">这张素材卡片暂不可用，请重新告诉小安要选择哪一张。</p>;
  return <fieldset aria-label={card.props.title} disabled={disabled}>
    <legend>{card.props.title}</legend>
    <div style={{display:"grid",gap:8}}>
      <button type="button" style={{minHeight:44,margin:0}} onClick={onAlbum}>从相册选择</button>
      <button type="button" style={{minHeight:44,margin:0}} onClick={onBack}>返回聊天</button>
    </div>
  </fieldset>;
}
