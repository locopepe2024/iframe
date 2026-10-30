import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import OpenTalkingReply, { formatOpenTalkingError } from "./OpenTalkingReply";
import {companionPlayback} from "@/lib/companionPlaybackQueue";
import {companionApi} from "@/lib/companionApi";
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
vi.mock("@/lib/companionApi",()=>({companionApi:{voiceDiagnostic:vi.fn().mockResolvedValue({status:"recorded"})}}));
const speaks=()=>calls.filter(c=>c.url.endsWith("/speak"));
it("links a captured voice turn to the accepted TTS command without sending its text to diagnostics",async()=>{
 vi.mocked(companionApi.voiceDiagnostic).mockClear();
 const trace={id:"trace-1",started:performance.now()};
 const view=render(<OpenTalkingReply reply={{id:"one",text:"私密原话",trace}}/>);
 await waitFor(()=>expect(vi.mocked(companionApi.voiceDiagnostic).mock.calls.some(([body])=>body.state==="tts_accepted")).toBe(true));
 const sent=vi.mocked(companionApi.voiceDiagnostic).mock.calls.find(([body])=>body.state==="tts_sent")![0];
 expect(sent).toMatchObject({trace_id:"trace-1",session_id:"s1",command_id:JSON.parse(speaks()[0].init.body as string).command_id});
 expect(JSON.stringify(vi.mocked(companionApi.voiceDiagnostic).mock.calls)).not.toContain("私密原话");
 view.unmount();
});
it("recreates a missing session once and retains the same command id",async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let first=true;
 vi.mocked(fetch).mockImplementation(async(url,init)=>{
   if(String(url).endsWith("/speak") && first){first=false;calls.push({url:String(url),init:init!});return {ok:false,status:404} as Response;}
   return original(url,init);
 });
 const view=render(<OpenTalkingReply reply={{id:"one",text:"你好"}}/>);
 await waitFor(()=>expect(speaks()).toHaveLength(2));
 expect(calls.filter(c=>c.url.endsWith("/sessions"))).toHaveLength(2);
 expect(JSON.parse(speaks()[1].init.body as string).command_id).toBe(JSON.parse(speaks()[0].init.body as string).command_id);
 expect(calls.some(c=>c.url.endsWith("/s1")&&c.init.method==="DELETE")).toBe(true);
 view.unmount();
});
it("does not replay an uncertain failure and bounds repeated missing-session responses",async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let status=503;
 vi.mocked(fetch).mockImplementation(async(url,init)=>{
   if(String(url).endsWith("/speak")){calls.push({url:String(url),init:init!});return {ok:false,status} as Response;}
   return original(url,init);
 });
 const view=render(<OpenTalkingReply reply={{id:"one",text:"第一句"}}/>);
 await waitFor(()=>expect(screen.getByText(/OpenTalking HTTP 503/)).toBeInTheDocument());
 expect(speaks()).toHaveLength(1);
 status=404;
 view.rerender(<OpenTalkingReply reply={{id:"two",text:"第二句"}}/>);
 await waitFor(()=>expect(screen.getByText(/OpenTalking HTTP 404/)).toBeInTheDocument());
 expect(speaks()).toHaveLength(3);
 expect(calls.filter(c=>c.url.endsWith("/sessions"))).toHaveLength(2);
 view.unmount();
});
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
 expect(screen.queryByRole("button",{name:"播放声音"})).not.toBeInTheDocument();
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
