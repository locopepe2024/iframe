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
 expect(player.isPlaying()).toBe(true);player.finishResponse();player.clear();expect(source.stop).toHaveBeenCalledOnce();expect(player.isPlaying()).toBe(false);
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
it("waits for 600ms of actual audio before starting, then schedules contiguously",()=>{
 const {player,context,nodes,chunk}=playbackHarness();
 for(let i=0;i<5;i++){context.currentTime=1+i*.2;player.play(chunk);}
 expect(nodes).toHaveLength(0);expect(player.isPlaying()).toBe(true);
 context.currentTime=2;player.play(chunk);
 expect(nodes).toHaveLength(6);expect(nodes[0].start.mock.calls[0][0]).toBeCloseTo(2.05);
 for(let i=1;i<6;i++)expect(nodes[i].start.mock.calls[0][0]).toBeCloseTo(2.05+i*.1);
 context.currentTime=2.4;player.play(chunk);
 expect(nodes[6].start.mock.calls[0][0]).toBeCloseTo(2.65);
 context.currentTime=2.73;player.play(chunk);
 expect(nodes[7].start.mock.calls[0][0]).toBeCloseTo(2.75);
 expect(player.stats().underruns).toBe(0);
});
it("flushes short responses at completion and never plays pending audio after interruption",()=>{
 const {player,nodes,chunk}=playbackHarness();
 player.play(chunk);expect(nodes).toHaveLength(0);player.finishResponse();
 expect(nodes).toHaveLength(1);expect(nodes[0].start.mock.calls[0][0]).toBeCloseTo(1.05);
 player.clear();player.play(chunk);player.clear();player.finishResponse();
 expect(nodes).toHaveLength(1);expect(nodes[0].stop).toHaveBeenCalledOnce();
 expect(player.isPlaying()).toBe(false);expect(player.stats().underruns).toBe(0);
});
it("rebuilds a real audio reserve after an underrun rather than restarting each small chunk",()=>{
 const {player,context,nodes,chunk}=playbackHarness();
 for(let i=0;i<6;i++)player.play(chunk);
 context.currentTime=2;player.play(chunk);
 expect(nodes).toHaveLength(6);expect(player.stats().underruns).toBe(1);
 for(let i=0;i<4;i++){context.currentTime+=.1;player.play(chunk);}
 expect(nodes).toHaveLength(6);expect(player.stats().underruns).toBe(1);
 player.play(chunk);expect(nodes).toHaveLength(12);
 expect(nodes[6].start.mock.calls[0][0]).toBeCloseTo(2.45);
 player.finishResponse();player.clear();context.currentTime=5;player.play(chunk);player.finishResponse();
 expect(player.stats().underruns).toBe(1);
});
it("bounds pending audio as well as scheduled playback",()=>{
 const {player}=playbackHarness();
 expect(()=>player.play(btoa("\0".repeat(24000*2*16)))).toThrow();
});
