import {expect,it,vi} from "vitest";
import {SilenceSegments,pcmWav} from "@/lib/companionSegments";
it("keeps long silence idle, retains short pauses and emits separate sentences",()=>{
 const emit=vi.fn(),parts=new SilenceSegments(16000,emit);
 const push=(count:number,value:number)=>{for(let i=0;i<count;i++)parts.push(new Float32Array(320).fill(value));};
 push(4000,0);expect(emit).not.toHaveBeenCalled();
 push(20,.1);push(20,0);push(20,.1);expect(emit).not.toHaveBeenCalled();push(45,0);expect(emit).toHaveBeenCalledOnce();
 push(4000,0);push(30,.1);parts.flush();expect(emit).toHaveBeenCalledTimes(2);
 expect(emit.mock.calls[0][0].length).toBeLessThan(16000*3);
});
it("splits long utterances without imposing session duration and resets discarded audio",()=>{
 const emit=vi.fn(),parts=new SilenceSegments(16000,emit);
 for(let i=0;i<1600;i++)parts.push(new Float32Array(320).fill(.1));
 expect(emit).toHaveBeenCalledTimes(2);parts.reset();parts.flush();expect(emit).toHaveBeenCalledTimes(2);
});
it("encodes a bounded mono PCM WAV",async()=>{
 const blob=pcmWav(new Float32Array([-.5,.5]),16000);
 const bytes=await new Promise<ArrayBuffer>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.readAsArrayBuffer(blob);});
 const view=new DataView(bytes);expect(view.getUint32(24,true)).toBe(16000);expect(view.getUint32(40,true)).toBe(4);expect(view.getInt16(44,true)).toBe(-16384);
});
