import {companionApi} from "./companionApi";

/** Metadata only. Browser monotonic durations never depend on server clock sync. */
export type VoiceTrace = {id:string;started:number};
export function newVoiceTrace():VoiceTrace {return {id:crypto.randomUUID(),started:performance.now()};}
export function voiceStage(trace:VoiceTrace|undefined, stage:string, fields:{duration_ms?:number;operation_id?:string;command_id?:string;session_id?:string;server_ms?:number;inference_ms?:number;rtt_ms?:number;jitter_ms?:number;jitter_buffer_ms?:number}={}) {
 if(!trace)return;
 try {void companionApi.voiceDiagnostic({connection:trace.id,trace_id:trace.id,event:"stage",state:stage,
   elapsed_ms:Math.min(86400000,Math.max(0,Math.round(performance.now()-trace.started))),session_id:"",...fields}).catch(()=>{});} catch { /* diagnostics never block the turn */ }
}
