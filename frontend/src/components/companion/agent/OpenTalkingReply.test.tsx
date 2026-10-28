import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import OpenTalkingReply, { formatOpenTalkingError } from "./OpenTalkingReply";
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
it("maps browser timeout errors to a clear Chinese recovery message",()=>{
 expect(formatOpenTalkingError(new DOMException("signal timed out","TimeoutError"))).toBe("语音连接超时，请稍后重试。");
 expect(formatOpenTalkingError(new Error("signal timed out"))).toBe("语音连接超时，请稍后重试。");
});
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

it("waits for explicit playback permission before sending speech, then reuses the session",async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,"play").mockRejectedValue(new DOMException("blocked","NotAllowedError"));
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}}/>);
 const button=await screen.findByRole("button",{name:"播放声音"});
 expect(speaks()).toHaveLength(0);
 expect(screen.getByLabelText("数字人回复")).toHaveAttribute("controls");
 play.mockResolvedValue();fireEvent.click(button);
 await waitFor(()=>expect(speaks()).toHaveLength(1));
 expect(calls.filter(c=>c.url.endsWith("/sessions"))).toHaveLength(1);
 view.unmount();play.mockRestore();
});

it("interrupts the current utterance without closing its peer and unmutes the next reply",async()=>{
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(1));
 await act(async()=>companionPlayback.cancel());
 expect(peer.close).not.toHaveBeenCalled();
 expect(calls.some(c=>c.url.endsWith("/interrupt"))).toBe(true);
 expect(screen.getByLabelText("数字人回复")).toHaveProperty("muted",true);
 view.rerender(<OpenTalkingReply reply={{id:"two",text:"接着聊"}}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(2));
 expect(screen.getByLabelText("数字人回复")).toHaveProperty("muted",false);
 view.unmount();
});
it("resets a connection on microphone restart without replaying the previous reply",async()=>{
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}} connectionEpoch={0}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(1));
 const oldPeer=peer;
 view.rerender(<OpenTalkingReply reply={{id:"one",text:"你好"}} connectionEpoch={1}/>);
 await act(async()=>{});
 expect(oldPeer.close).toHaveBeenCalledOnce();
 expect(speaks()).toHaveLength(1);
 expect(screen.queryByRole("button",{name:"检查声音"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"重试语音连接"})).not.toBeInTheDocument();
 view.rerender(<OpenTalkingReply reply={{id:"two",text:"新的话"}} connectionEpoch={1}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(2));
 expect(calls.filter(c=>c.url.endsWith("/sessions"))).toHaveLength(2);
 view.unmount();
});

it("never speaks a cancelled reply when its delayed player becomes ready",async()=>{
 let resume!:(value:void)=>void;
 const play=vi.spyOn(HTMLMediaElement.prototype,"play").mockImplementationOnce(()=>new Promise(resolve=>{resume=resolve;})).mockResolvedValue();
 const view=render(<OpenTalkingReply reply={{id:"old",text:"旧回复"}}/>);
 try {
   await waitFor(()=>expect(play).toHaveBeenCalledTimes(1));
   await act(async()=>companionPlayback.cancel());
   view.rerender(<OpenTalkingReply reply={{id:"new",text:"新回复"}}/>);
   await waitFor(()=>expect(speaks()).toHaveLength(1));
   await act(async()=>resume());
   expect(speaks().map(call=>JSON.parse(call.init.body as string).text)).toEqual(["新回复"]);
   const command=JSON.parse(speaks()[0].init.body as string).command_id;
   view.rerender(<OpenTalkingReply reply={{id:"third",text:"下一句"}}/>);
   act(()=>events.dispatchEvent(new MessageEvent("speech.ended",{data:JSON.stringify({utterance_id:command,text:"新回复"})})));
   await waitFor(()=>expect(speaks()).toHaveLength(2));
 } finally {view.unmount();play.mockRestore();}
});
