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
