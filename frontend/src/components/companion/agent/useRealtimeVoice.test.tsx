import {act,renderHook,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useRealtimeVoice} from "./useRealtimeVoice";
const mocks=vi.hoisted(()=>({ticket:vi.fn(),capture:vi.fn(),endCapture:vi.fn(),play:vi.fn(),clear:vi.fn(),playing:vi.fn(),idle:vi.fn(),finish:vi.fn()}));
vi.mock("@/lib/companionServices",()=>({companionServices:{realtimeTicket:mocks.ticket,realtimeUrl:()=>"wss://example.test/realtime"}}));
vi.mock("@/lib/companionRealtimeAudio",()=>({captureMicrophone:mocks.capture,PcmPlayer:class {constructor(_audio:unknown,onIdle:()=>void){mocks.idle.mockImplementation(onIdle);}stats=()=>({underruns:0});finishResponse=mocks.finish;play=mocks.play;clear=mocks.clear;isPlaying=mocks.playing;}}));
let ws:FakeSocket;
class FakeSocket {
 static OPEN=1;readyState=1;bufferedAmount=0;
 onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;
 send=vi.fn();close=vi.fn();constructor(){ws=this;}
}
const track={stop:vi.fn()},resume=vi.fn(),close=vi.fn(),getUserMedia=vi.fn();
beforeEach(()=>{
 vi.resetAllMocks();mocks.ticket.mockResolvedValue({ticket:"one-use",max_seconds:300});mocks.capture.mockResolvedValue(mocks.endCapture);resume.mockResolvedValue(undefined);close.mockResolvedValue(undefined);getUserMedia.mockResolvedValue({getTracks:()=>[track]});
 vi.stubGlobal("WebSocket",FakeSocket);vi.stubGlobal("AudioContext",class {resume=resume;close=close;});
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia}});
});
afterEach(()=>{vi.unstubAllGlobals();});
async function ready(result:{current:ReturnType<typeof useRealtimeVoice>}){
 await act(async()=>{await result.current.start();});act(()=>ws.onopen?.());
 expect(ws.send).toHaveBeenCalledWith(JSON.stringify({type:"authenticate",ticket:"one-use"}));
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"ready"})});});
}
it("only connects explicitly, streams audio, interrupts and releases every resource",async()=>{
 const {result,unmount}=renderHook(()=>useRealtimeVoice());expect(mocks.ticket).not.toHaveBeenCalled();expect(getUserMedia).not.toHaveBeenCalled();
 await ready(result);expect(result.current.state).toBe("listening");
 act(()=>mocks.capture.mock.calls[0][2]("AAAA"));expect(ws.send).toHaveBeenCalledWith(JSON.stringify({type:"input_audio_buffer.append",audio:"AAAA"}));
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"response.audio.delta",delta:"audio"})});});expect(mocks.play).toHaveBeenCalledWith("audio");
 act(()=>result.current.interrupt());expect(mocks.clear).toHaveBeenCalled();expect(ws.send).toHaveBeenCalledWith(JSON.stringify({type:"interrupt"}));
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"response.audio.delta",delta:"late"})});});expect(mocks.play).toHaveBeenCalledTimes(1);
 act(()=>result.current.stop());expect(track.stop).toHaveBeenCalledOnce();expect(mocks.endCapture).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(ws.close).toHaveBeenCalledOnce();expect(result.current.active).toBe(false);unmount();
});
it("stops on upstream error and does not reconnect",async()=>{
 const {result}=renderHook(()=>useRealtimeVoice());await ready(result);
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"error",message:"余额不足"})});});
 expect(result.current.notice).toBe("余额不足");expect(track.stop).toHaveBeenCalledOnce();expect(mocks.ticket).toHaveBeenCalledOnce();
});
it("cancels a late microphone permission result after ending",async()=>{
 let resolve!:(value:unknown)=>void;getUserMedia.mockReturnValue(new Promise(r=>resolve=r));
 const {result}=renderHook(()=>useRealtimeVoice());let pending!:Promise<void>;
 act(()=>{pending=result.current.start();});await waitFor(()=>expect(getUserMedia).toHaveBeenCalled());
 act(()=>result.current.stop());await act(async()=>{resolve({getTracks:()=>[track]});await pending;});
 expect(track.stop).toHaveBeenCalledOnce();expect(mocks.capture).not.toHaveBeenCalled();expect(result.current.active).toBe(false);
});
it("releases the microphone when hidden and on unmount",async()=>{
 const view=renderHook(()=>useRealtimeVoice());await ready(view.result);
 Object.defineProperty(document,"hidden",{configurable:true,value:true});act(()=>document.dispatchEvent(new Event("visibilitychange")));
 expect(track.stop).toHaveBeenCalledOnce();expect(view.result.current.active).toBe(false);
 Object.defineProperty(document,"hidden",{configurable:true,value:false});await ready(view.result);view.unmount();expect(track.stop).toHaveBeenCalledTimes(2);
});

it("renders native Qwen ASR text/stash and replaces it with the final transcript",async()=>{
 const {result}=renderHook(()=>useRealtimeVoice());await ready(result);
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"conversation.item.input_audio_transcription.delta",item_id:"u",text:"今天",stash:"开心"})});});
 expect(result.current.lines[0].text).toBe("今天开心");
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"conversation.item.input_audio_transcription.completed",item_id:"u",transcript:"今天很开心"})});});
 expect(result.current.lines).toEqual([{id:"u",role:"我",text:"今天很开心"}]);
});

it("does not invite speech when an unfinished reply drains its playback queue",async()=>{
 const {result}=renderHook(()=>useRealtimeVoice());await ready(result);
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"response.created"})});await ws.onmessage?.({data:JSON.stringify({type:"response.audio.delta",delta:"audio"})});});
 expect(result.current.state).toBe("speaking");act(()=>mocks.idle());
 expect(result.current.state).toBe("thinking");
 await act(async()=>{await ws.onmessage?.({data:JSON.stringify({type:"response.done"})});});
 expect(mocks.finish).toHaveBeenCalledOnce();expect(result.current.state).toBe("listening");
});
it("reports a connected-but-silent upstream instead of staying in listening forever",async()=>{
 vi.useFakeTimers();
 const {result}=renderHook(()=>useRealtimeVoice());
 await ready(result);
 act(()=>mocks.capture.mock.calls[0][2]("AAAA"));
 act(()=>vi.advanceTimersByTime(12001));
 expect(result.current.active).toBe(false);
 expect(result.current.notice).toContain("没有收到回复");
 vi.useRealTimers();
});
