import {act,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import OpenTalkingReply from "./OpenTalkingReply";
import {companionPlayback} from "@/lib/companionPlaybackQueue";
let calls:{url:string;init:RequestInit}[],peer:PC,events:ES;
class PC extends EventTarget {
  iceGatheringState="complete";connectionState="connected";localDescription={sdp:"offer",type:"offer" as RTCSdpType};
  ontrack:unknown=null;onconnectionstatechange:unknown=null;close=vi.fn();addTransceiver=vi.fn();
  createOffer=vi.fn().mockResolvedValue(this.localDescription);setLocalDescription=vi.fn();setRemoteDescription=vi.fn();
  constructor(){super();peer=this;}
}
class ES extends EventTarget {close=vi.fn();constructor(){super();events=this;setTimeout(()=>this.dispatchEvent(new Event("open")),0);}}
beforeEach(()=>{
 calls=[];Object.defineProperty(HTMLVideoElement.prototype,"srcObject",{configurable:true,writable:true,value:null});
 vi.stubGlobal("RTCPeerConnection",PC);vi.stubGlobal("MediaStream",class{getTracks(){return [];} });vi.stubGlobal("EventSource",ES);
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit={})=>{
  calls.push({url,init});const path=url.replace("/opentalking-mock/api","");
  const body=path==="/sessions"?{session_id:"s1"}:path==="/sessions/s1"?{state:"worker_ready"}:path.includes("webrtc/ice-config")?{iceServers:[]}:path.includes("webrtc/offer")?{sdp:"answer",type:"answer"}:{status:"queued"};
  return {ok:true,json:async()=>body};
 }));
});
afterEach(()=>{companionPlayback.cancel();vi.unstubAllGlobals();});
const speaks=()=>calls.filter(c=>c.url.endsWith("/speak"));
it("keeps one media session across two replies and ignores duplicate history rerenders",async()=>{
 const view=render(<OpenTalkingReply reply={{id:"one",text:"今天开心"}}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(1));
 expect(JSON.parse(calls.find(c=>c.url.endsWith("/sessions"))!.init.body as string)).toMatchObject({agent_enabled:false,avatar_id:"office-woman",model:"mock",knowledge_enabled:false,memory_enabled:false});
 expect(JSON.parse(speaks()[0].init.body as string)).toMatchObject({text:"今天开心",render_text:true});
 view.rerender(<OpenTalkingReply reply={{id:"one",text:"今天开心"}}/>);expect(speaks()).toHaveLength(1);expect(peer.close).not.toHaveBeenCalled();
 view.rerender(<OpenTalkingReply reply={{id:"two",text:"明天散步"}}/>);expect(speaks()).toHaveLength(1);
 const first=JSON.parse(speaks()[0].init.body as string);
 act(()=>events.dispatchEvent(new MessageEvent("speech.ended",{data:JSON.stringify({utterance_id:first.command_id,text:"今天开心"})})));
 await waitFor(()=>expect(speaks()).toHaveLength(2));
 expect(calls.filter(c=>c.url.endsWith("/sessions"))).toHaveLength(1);expect(screen.queryByText("OpenTalking 已连接")).not.toBeInTheDocument();
 view.unmount();await act(async()=>{});expect(peer.close).toHaveBeenCalledOnce();expect(events.close).toHaveBeenCalledOnce();
 expect(calls.some(c=>c.url.endsWith("/s1")&&c.init.method==="DELETE")).toBe(true);
});
it("deletes a session created after unmount and never starts media for it",async()=>{
 let resolve!:(value:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}}/>);view.unmount();
 await act(async()=>resolve({ok:true,json:async()=>({session_id:"late"})} as Response));
 await waitFor(()=>expect(calls.some(c=>c.url.endsWith("/late")&&c.init.method==="DELETE")).toBe(true));
 expect(calls.some(c=>c.url.includes("/start"))).toBe(false);
});
it("releases media on pagehide",async()=>{
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(1));
 act(()=>window.dispatchEvent(new Event("pagehide")));
 expect(peer.close).toHaveBeenCalledOnce();expect(events.close).toHaveBeenCalledOnce();
 view.unmount();expect(peer.close).toHaveBeenCalledOnce();
});
