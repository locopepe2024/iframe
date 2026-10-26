import {act,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import OpenTalkingReply from "./OpenTalkingReply";
class PC {iceGatheringState="complete";localDescription={sdp:"offer",type:"offer" as RTCSdpType};ontrack:any=null;close=vi.fn();addTransceiver=vi.fn();createOffer=vi.fn().mockResolvedValue(this.localDescription);setLocalDescription=vi.fn();setRemoteDescription=vi.fn();}
afterEach(()=>{vi.unstubAllGlobals();});
it("creates one agent-disabled OpenTalking session, speaks the existing text and closes it",async()=>{
 const calls:any[]=[];Object.defineProperty(HTMLVideoElement.prototype,"srcObject",{configurable:true,writable:true,value:null});vi.stubGlobal("RTCPeerConnection",PC);vi.stubGlobal("MediaStream",class{tracks:any[]=[];getTracks(){return this.tracks;}addTrack(t:any){this.tracks.push(t);}});vi.stubGlobal("fetch",vi.fn(async(url:string,init:any)=>{calls.push([url,init]);const path=url.replace("/opentalking-mock/api","");const body=path==="/sessions"?{session_id:"s1"}:path.includes("webrtc/ice-config")?{iceServers:[]}:path.includes("webrtc/offer")?{sdp:"answer",type:"answer"}:{status:"pending"};return {ok:true,json:async()=>body};}));
 const view=render(<OpenTalkingReply text="今天很开心" voice="longanyang_v3.6"/>);await waitFor(()=>expect(calls.some(([url])=>url.endsWith("/speak"))).toBe(true));
 const create=calls.find(([url])=>url.endsWith("/sessions"));expect(JSON.parse(create[1].body)).toMatchObject({agent_enabled:false,avatar_id:"office-woman",model:"mock",memory_enabled:false,knowledge_enabled:false});
 const speak=calls.find(([url])=>url.endsWith("/speak"));expect(JSON.parse(speak[1].body).text).toBe("今天很开心");expect(screen.getByText("OpenTalking 已连接")).toBeInTheDocument();
 view.unmount();await act(async()=>{});expect(calls.some(([url,init])=>url.endsWith("/s1")&&init.method==="DELETE")).toBe(true);
});
