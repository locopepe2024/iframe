import {expect,it,vi} from "vitest";
import {PcmEncoder,PcmPlayer} from "../lib/companionRealtimeAudio";
it("resamples across chunk boundaries identically and produces little endian bounded PCM16",()=>{
 const samples=Float32Array.from({length:4800},(_,i)=>Math.sin(i/17)*1.2);
 const whole=new PcmEncoder(48000).encode(samples),stream=new PcmEncoder(48000);
 const split=[samples.slice(0,127),samples.slice(127,911),samples.slice(911)].map(chunk=>atob(stream.encode(chunk))).join("");
 expect(split).toBe(atob(whole));expect(split.length).toBe(3200);
 const clipped=atob(new PcmEncoder(16000).encode(new Float32Array([2,-2,0])));
 expect([...clipped].map(c=>c.charCodeAt(0))).toEqual([255,127,0,128]);
});
it("decodes signed 24kHz audio and cancels all queued playback on interruption",()=>{
 const channel=new Float32Array(2);const source={buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};
 const context={currentTime:1,destination:{},createBuffer:vi.fn(()=>({duration:2/24000,getChannelData:()=>channel})),createBufferSource:()=>source};
 const player=new PcmPlayer(context as unknown as AudioContext);
 player.play(btoa(String.fromCharCode(0,128,255,127)));
 expect(context.createBuffer).toHaveBeenCalledWith(1,2,24000);expect(channel[0]).toBe(-1);expect(channel[1]).toBeCloseTo(32767/32768);
 expect(player.isPlaying()).toBe(true);player.clear();expect(source.stop).toHaveBeenCalledOnce();expect(player.isPlaying()).toBe(false);
});

function playbackHarness() {
 const nodes: {start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;onended:(()=>void)|null}[]=[];
 const context={currentTime:1,destination:{},createBuffer:(_channels:number,length:number,rate:number)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>{
   const node={buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};nodes.push(node);return node;
 }};
 const player=new PcmPlayer(context as unknown as AudioContext);
 const chunk=btoa("\0".repeat(4800)); // 100 ms mono PCM16
 return {player,context,nodes,chunk};
}
it("absorbs jitter inside 200ms headroom and schedules chunks without artificial gaps",()=>{
 const {player,context,nodes,chunk}=playbackHarness();
 player.play(chunk);expect(nodes[0].start).toHaveBeenCalledWith(1.2);
 context.currentTime=1.18;player.play(chunk);expect(nodes[1].start.mock.calls[0][0]).toBeCloseTo(1.3);
 context.currentTime=1.32;player.play(chunk);expect(nodes[2].start.mock.calls[0][0]).toBeCloseTo(1.4);
 expect(player.stats().underruns).toBe(0);
});
it("counts a real mid-response underrun, adds headroom and excludes normal ends and interruptions",()=>{
 const {player,context,nodes,chunk}=playbackHarness();
 player.play(chunk);context.currentTime=1.5;player.play(chunk);
 expect(nodes[1].start).toHaveBeenCalledWith(1.7);
 expect(player.stats()).toEqual({underruns:1,maxGapMs:200,startupBufferMs:200});
 player.finishResponse();context.currentTime=3;player.play(chunk);
 expect(player.stats().underruns).toBe(1);
 player.clear();expect(nodes.every(node=>node.stop.mock.calls.length===1)).toBe(true);
 context.currentTime=5;player.play(chunk);expect(player.stats().underruns).toBe(1);
});
