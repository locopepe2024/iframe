import {expect,it,vi} from "vitest";
import {PlaybackQueue} from "@/lib/companionPlaybackQueue";
it("serializes replies independently and aborts current and queued playback on interruption",async()=>{
 const queue=new PlaybackQueue(),one=Symbol(),two=Symbol(),events:string[]=[];
 let finish!:()=>void;let signal!:AbortSignal;
 queue.enqueue(one,async (s,playing)=>{playing();signal=s;events.push("one");await new Promise<void>(r=>finish=r);});
 const cancelled=vi.fn();queue.enqueue(two,async()=>{events.push("two");},cancelled);
 expect(events).toEqual(["one"]);expect(queue.blocksCapture()).toBe(true);
 queue.cancel();await Promise.resolve();await Promise.resolve();expect(signal.aborted).toBe(true);expect(cancelled).toHaveBeenCalledOnce();expect(events).toEqual(["one"]);
 finish();await Promise.resolve();await Promise.resolve();expect(queue.isPlaying()).toBe(false);
});
it("plays the next reply only after completion",async()=>{
 const queue=new PlaybackQueue(),events:string[]=[];let finish!:()=>void;
 queue.enqueue(Symbol(),async()=>{events.push("one");await new Promise<void>(r=>finish=r);});
 queue.enqueue(Symbol(),async()=>{events.push("two");});expect(events).toEqual(["one"]);
 finish();for(let i=0;i<8;i++)await Promise.resolve();expect(events).toEqual(["one","two"]);
});
