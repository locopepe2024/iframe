import {act,renderHook,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useContinuousCapture} from "./useContinuousCapture";
const mock=vi.hoisted(()=>({capture:vi.fn()}));
vi.mock("@/lib/companionApi",()=>({companionApi:{voiceDiagnostic:vi.fn().mockResolvedValue({status:"recorded"})}}));
vi.mock("@/lib/companionRealtimeAudio",()=>({captureMicrophonePcm:mock.capture}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){
 let audio!:(chunk:Float32Array)=>void;
 const stop=vi.fn(),close=vi.fn().mockResolvedValue(undefined),disconnect=vi.fn();
 const track={stop,onended:null};
 const getUserMedia=vi.fn().mockResolvedValue({getTracks:()=>[track]});
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia}});
 vi.stubGlobal("AudioContext",class {sampleRate=16000;resume=vi.fn().mockResolvedValue(undefined);close=close;});
 mock.capture.mockImplementation(async(_a,_s,cb)=>{audio=cb;return disconnect;});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({text:"今天开心"})});vi.stubGlobal("fetch",fetch);
 const text=vi.fn(),hook=renderHook(()=>useContinuousCapture(text));
 const sentence=()=>act(()=>{for(let i=0;i<25;i++)audio(new Float32Array(320).fill(.1));for(let i=0;i<45;i++)audio(new Float32Array(320));});
 return {hook,text,fetch,stop,close,disconnect,getUserMedia,sentence,getAudio:()=>audio};
}
it("retains one microphone through long silence and serializes recognition without losing later segments",async()=>{
 const s=setup();act(()=>s.hook.result.current.toggleListening());await waitFor(()=>expect(s.getAudio()).toBeDefined());
 act(()=>{for(let i=0;i<4000;i++)s.getAudio()(new Float32Array(320));});expect(s.fetch).not.toHaveBeenCalled();expect(s.stop).not.toHaveBeenCalled();
 let resolve!:(value:unknown)=>void;s.fetch.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 s.sentence();s.sentence();expect(s.fetch).toHaveBeenCalledOnce();
 await act(async()=>resolve({ok:true,json:async()=>({text:"第一段"})}));await waitFor(()=>expect(s.text.mock.calls.map(call=>call[0])).toEqual(["第一段","今天开心"]));
 expect(s.getUserMedia).toHaveBeenCalledOnce();s.hook.unmount();expect(s.stop).toHaveBeenCalledOnce();expect(s.disconnect).toHaveBeenCalledOnce();
});
it("preserves failed segment and later sentences for explicit retry",async()=>{
 const s=setup();s.fetch.mockRejectedValueOnce(new Error("network"));act(()=>s.hook.result.current.toggleListening());await waitFor(()=>expect(s.getAudio()).toBeDefined());
 s.sentence();s.sentence();await waitFor(()=>expect(s.hook.result.current.failed).toBe(true));expect(s.stop).toHaveBeenCalledOnce();expect(s.fetch).toHaveBeenCalledOnce();
 act(()=>s.hook.result.current.retry());await waitFor(()=>expect(s.text).toHaveBeenCalledTimes(2));expect(s.fetch).toHaveBeenCalledTimes(3);s.hook.unmount();
});
it("stops acquisition but flushes the last sentence and ignores late microphone permission after cancel",async()=>{
 const s=setup();act(()=>s.hook.result.current.toggleListening());await waitFor(()=>expect(s.getAudio()).toBeDefined());
 act(()=>{for(let i=0;i<30;i++)s.getAudio()(new Float32Array(320).fill(.1));s.hook.result.current.toggleListening();});
 await waitFor(()=>expect(s.text).toHaveBeenCalledOnce());expect(s.stop).toHaveBeenCalledOnce();s.hook.unmount();
 const late=setup();let resolve!:(value:unknown)=>void;late.getUserMedia.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 act(()=>late.hook.result.current.toggleListening());await waitFor(()=>expect(late.getUserMedia).toHaveBeenCalledOnce());act(()=>late.hook.result.current.stopAll());
 const stop=vi.fn();await act(async()=>resolve({getTracks:()=>[{stop}]}));expect(stop).toHaveBeenCalledOnce();late.hook.unmount();
});
it("keeps capture connected but discards reply audio and resumes after interruption tail",async()=>{
 const {companionPlayback}=await import("@/lib/companionPlaybackQueue");
 const s=setup();act(()=>s.hook.result.current.toggleListening());await waitFor(()=>expect(s.getAudio()).toBeDefined());
 act(()=>companionPlayback.enqueue(Symbol(),async (signal,playing)=>{playing();return new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));}));
 s.sentence();expect(s.fetch).not.toHaveBeenCalled();expect(s.stop).not.toHaveBeenCalled();
 await act(async()=>{s.hook.result.current.interrupt();});
 const spy=vi.spyOn(performance,"now").mockReturnValue(performance.now()+1000);
 s.sentence();await waitFor(()=>expect(s.text).toHaveBeenCalledOnce());spy.mockRestore();s.hook.unmount();
});
it("bounds pending audio and pauses capture on backlog without dropping the recorded segments",async()=>{
 const clock=vi.spyOn(performance,"now").mockReturnValue(performance.now()+5000);
 const s=setup();let resolve!:(value:unknown)=>void;s.fetch.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 act(()=>s.hook.result.current.toggleListening());await waitFor(()=>expect(s.getAudio()).toBeDefined());
 for(let i=0;i<12;i++)s.sentence();expect(s.stop).toHaveBeenCalledOnce();expect(s.fetch).toHaveBeenCalledOnce();
 await act(async()=>resolve({ok:true,json:async()=>({text:"第一段"})}));await waitFor(()=>expect(s.text).toHaveBeenCalledTimes(12));s.hook.unmount();clock.mockRestore();
});

it("preserves unfinished user speech when an assistant reply starts playing",async()=>{
 const {companionPlayback}=await import("@/lib/companionPlaybackQueue");
 const clock=vi.spyOn(performance,"now").mockReturnValue(performance.now()+5000);
 const s=setup();
 act(()=>s.hook.result.current.toggleListening());
 await waitFor(()=>expect(s.getAudio()).toBeDefined());
 act(()=>{for(let i=0;i<30;i++)s.getAudio()(new Float32Array(320).fill(.1));});
 expect(s.fetch).not.toHaveBeenCalled();
 let begin!:()=>void;
 act(()=>companionPlayback.enqueue(Symbol(),async(signal,playing)=>{
   begin=playing;
   await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));
 }));
 expect(s.fetch).not.toHaveBeenCalled();
 act(()=>begin());
 await waitFor(()=>expect(s.text).toHaveBeenCalledOnce());
 s.sentence();
 expect(s.fetch).toHaveBeenCalledOnce();
 await act(async()=>companionPlayback.cancel());
 s.hook.unmount();clock.mockRestore();
});
