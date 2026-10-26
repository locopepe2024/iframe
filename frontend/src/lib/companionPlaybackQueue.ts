/** One playback owner for the chat page. Capture subscribes without owning playback. */
export class PlaybackQueue {
  private jobs:{owner:symbol;run:(signal:AbortSignal,playing:()=>void)=>Promise<void>;cancel:()=>void}[]=[];
  private current:{owner:symbol;controller:AbortController;audible:boolean}|null=null;
  private listeners=new Set<()=>void>();
  private mutedUntil=0;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private notify(){this.listeners.forEach(fn=>fn());}
  isPlaying=()=>this.current?.audible===true;
  blocksCapture=()=>this.isPlaying() || performance.now()<this.mutedUntil;
  enqueue(owner:symbol,run:(signal:AbortSignal,playing:()=>void)=>Promise<void>,cancel:()=>void=()=>{}){this.jobs.push({owner,run,cancel});void this.drain();}
  cancel(owner?:symbol){
    this.jobs.filter(j=>!owner || j.owner===owner).forEach(j=>j.cancel());
    this.jobs=owner?this.jobs.filter(j=>j.owner!==owner):[];
    if(this.current && (!owner || this.current.owner===owner))this.current.controller.abort();
  }
  private async drain(){
    if(this.current)return;
    const job=this.jobs.shift();if(!job)return;
    const entry={owner:job.owner,controller:new AbortController(),audible:false};this.current=entry;this.notify();
    let abort!:()=>void;
    const cancelled=new Promise<void>(resolve=>{abort=resolve;entry.controller.signal.addEventListener("abort",abort,{once:true});});
    try{await Promise.race([job.run(entry.controller.signal,()=>{if(!entry.controller.signal.aborted){entry.audible=true;this.notify();}}),cancelled]);}catch{/* The job reports errors in its own UI. */}
    finally{entry.controller.signal.removeEventListener("abort",abort);if(entry.controller.signal.aborted)job.cancel();if(entry.audible)this.mutedUntil=performance.now()+350;this.current=null;this.notify();void this.drain();}
  }
}
export const companionPlayback=new PlaybackQueue();
