/** Experimental energy-based silence segmentation, not a neural speech detector. */
export class SilenceSegments {
  private frames: Float32Array[] = [];
  private lead: Float32Array[] = [];
  private count = 0;
  private quiet = 0;
  private voiced = 0;
  private active = false;
  constructor(private rate: number, private emit: (samples: Float32Array) => void, private onSpeechStart: () => void = () => {}) {}
  reset() { this.frames=[];this.lead=[];this.count=this.quiet=this.voiced=0;this.active=false; }
  push(frame: Float32Array) {
    const rms=Math.sqrt(frame.reduce((sum,v)=>sum+v*v,0)/frame.length);
    const loud=rms>=.015;
    if (!this.active) {
      this.lead.push(frame.slice());
      while(this.lead.length && this.lead.reduce((n,f)=>n+f.length,0)>this.rate*.3) this.lead.shift();
      this.voiced=loud?this.voiced+frame.length:0;
      if(this.voiced<this.rate*.08)return;
      this.active=true;this.frames=this.lead;this.lead=[];this.count=this.frames.reduce((n,f)=>n+f.length,0);
      this.onSpeechStart();
    } else {this.frames.push(frame.slice());this.count+=frame.length;}
    this.quiet=loud?0:this.quiet+frame.length;
    if(this.quiet>=this.rate*.9 || this.count>=this.rate*15)this.flush();
  }
  flush() {
    if(this.active && this.count>=this.rate*.3){
      const result=new Float32Array(this.count);let at=0;
      for(const frame of this.frames){result.set(frame,at);at+=frame.length;}
      this.emit(result);
    }
    this.reset();
  }
}
export function pcmWav(samples:Float32Array,rate:number) {
  const view=new DataView(new ArrayBuffer(44+samples.length*2));
  const word=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
  word(0,"RIFF");view.setUint32(4,36+samples.length*2,true);word(8,"WAVE");word(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,"data");view.setUint32(40,samples.length*2,true);
  samples.forEach((v,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*(v<0?32768:32767),true));
  return new Blob([view.buffer],{type:"audio/wav"});
}
