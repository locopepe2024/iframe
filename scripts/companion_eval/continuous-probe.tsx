import React from "react";
import {createRoot} from "react-dom/client";
import {useContinuousCapture} from "../../frontend/src/components/companion/agent/useContinuousCapture";
const probe:any={texts:[],tracks:[],requests:[],frames:0};(window as any).probe=probe;
const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await native(constraints);probe.tracks.push(...stream.getTracks());return stream;};
const request=window.fetch.bind(window);window.fetch=async(input,options)=>{const started=performance.now();const result=await request(input,options);probe.requests.push({status:result.status,ms:Math.round(performance.now()-started)});return result;};
function App(){const voice=useContinuousCapture(text=>probe.texts.push(text));probe.voice=voice;return <button onClick={voice.toggleListening}>{voice.listening?"停止":"开始"}</button>;}
const root=createRoot(document.getElementById("root")!);root.render(<App/>);probe.ready=true;probe.unmount=()=>{root.unmount();return {tracks:probe.tracks.map((t:MediaStreamTrack)=>t.readyState)};};
