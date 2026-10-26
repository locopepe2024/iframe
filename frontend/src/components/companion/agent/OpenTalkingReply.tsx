"use client";
import {useEffect,useRef,useState} from "react";
import styles from "./chat.module.css";

const base=(process.env.NEXT_PUBLIC_OPENTALKING_URL||"/opentalking-mock/api").replace(/\/$/,"");
type Session={session_id:string};
async function json<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(base+path,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});if(!r.ok)throw new Error(`OpenTalking HTTP ${r.status}`);return r.json();}

export default function OpenTalkingReply({text,voice}:{text:string;voice?:string}){
 const video=useRef<HTMLVideoElement>(null),pc=useRef<RTCPeerConnection|null>(null),session=useRef("");
 const [state,setState]=useState<"opening"|"speaking"|"ready"|"error">("opening"),[error,setError]=useState("");
 useEffect(()=>{let alive=true;
  async function open(){try{
   const created=await json<Session>("/sessions",{method:"POST",body:JSON.stringify({model:"wav2lip",agent_enabled:false,tts_voice:voice||undefined})});if(!alive)return;session.current=created.session_id;
   const ice=await json<{iceServers?:RTCIceServer[];iceTransportPolicy?:RTCIceTransportPolicy}>("/sessions/webrtc/ice-config");
   const connection=new RTCPeerConnection({iceServers:ice.iceServers||[],iceTransportPolicy:ice.iceTransportPolicy});pc.current=connection;
   const stream=new MediaStream();if(video.current)video.current.srcObject=stream;connection.ontrack=e=>{if(!stream.getTracks().some(t=>t.id===e.track.id))stream.addTrack(e.track);void video.current?.play().catch(()=>{});};
   connection.addTransceiver("video",{direction:"recvonly"});connection.addTransceiver("audio",{direction:"recvonly"});
   const offer=await connection.createOffer();await connection.setLocalDescription(offer);
   await new Promise<void>(resolve=>{if(connection.iceGatheringState==="complete")return resolve();const timeout=setTimeout(resolve,8000);connection.onicegatheringstatechange=()=>{if(connection.iceGatheringState==="complete"){clearTimeout(timeout);resolve();}}});
   const answer=await json<{sdp:string;type:RTCSdpType}>(`/sessions/${encodeURIComponent(session.current)}/webrtc/offer`,{method:"POST",body:JSON.stringify({sdp:connection.localDescription?.sdp,type:connection.localDescription?.type})});
   await connection.setRemoteDescription(answer);
   await json(`/sessions/${encodeURIComponent(session.current)}/speak`,{method:"POST",headers:{"Idempotency-Key":`iframe-${crypto.randomUUID()}`},body:JSON.stringify({text,mode:"replace",voice:voice||undefined})});
   if(alive)setState("speaking");
  }catch(e){if(alive){setState("error");setError(e instanceof Error?e.message:"OpenTalking 无法连接");}}
 }
 open();return()=>{alive=false;pc.current?.close();pc.current=null;if(session.current)void fetch(`${base}/sessions/${encodeURIComponent(session.current)}`,{method:"DELETE"}).catch(()=>{});};
 },[voice]);
 useEffect(()=>{if(!session.current||state==="error")return;},[state]);
 return <div className={styles.openTalkingReply} aria-label="OpenTalking 语音回复"><video ref={video} autoPlay playsInline muted={false} aria-label="数字人回复"/><span>{state==="opening"?"正在连接数字人…":state==="error"?`文字已保留，语音连接失败：${error}`:"OpenTalking 已连接"}</span></div>;
}
