import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCompanionVoice } from "./useCompanionVoice";

function Controls({ name }: { name: string }) {
  const voice = useCompanionVoice(() => {});
  return <div><button onClick={voice.toggleListening}>{name} listen</button><button onClick={() => voice.speak("描述", true)}>{name} speak</button><span>{name}: {voice.listening ? "listening" : voice.speaking ? "speaking" : "idle"}</span></div>;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("hands off microphone and speech between controls and ignores stale results", () => {
  const instances: any[] = [];
  vi.stubGlobal("SpeechRecognition", class {
    abort = vi.fn(); stop = vi.fn(); start = vi.fn();
    constructor() { instances.push(this); }
  });
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn() });
  render(<><Controls name="date" /><Controls name="description" /></>);
  fireEvent.click(screen.getByText("date listen"));
  expect(screen.getByText("date: listening")).toBeInTheDocument();
  fireEvent.click(screen.getByText("description listen"));
  expect(instances[0].abort).toHaveBeenCalled();
  expect(instances[0].onresult).toBeNull();
  expect(screen.getByText("date: idle")).toBeInTheDocument();
  fireEvent.click(screen.getByText("date speak"));
  expect(instances[1].abort).toHaveBeenCalled();
  expect(screen.getByText("description: idle")).toBeInTheDocument();
  expect(screen.getByText("date: speaking")).toBeInTheDocument();
  fireEvent.click(screen.getByText("description speak"));
  expect(screen.getByText("date: idle")).toBeInTheDocument();
  expect(screen.getByText("description: speaking")).toBeInTheDocument();
});

function Continuous({received}:{received:(text:string)=>void}) {
 const voice=useCompanionVoice(()=>{}, {continuous:true,onFinalTranscript:received});
 return <button onClick={voice.toggleListening}>{voice.listening ? "stop continuous" : "start continuous"}</button>;
}
function setupContinuous() {
 vi.useFakeTimers();const instances:any[]=[];
 vi.stubGlobal("SpeechRecognition",class {start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}});
 const received=vi.fn();const view=render(<Continuous received={received}/>);
 fireEvent.click(screen.getByText("start continuous"));return {instances,received,view};
}
it("resumes multiple browser-ended sessions beyond 60 seconds and delivers every final exactly once",()=>{
 const {instances,received}=setupContinuous();
 for(let n=0;n<3;n++){
  const current=instances[n],event={resultIndex:0,results:[Object.assign([{transcript:`${n}-one`}],{isFinal:true}),Object.assign([{transcript:`${n}-two`}],{isFinal:true})]};
  act(()=>{current.onresult(event);current.onresult(event);current.onend();vi.advanceTimersByTime(300);});
 }
 expect(received.mock.calls.flat()).toEqual(["0-one","0-two","1-one","1-two","2-one","2-two"]);
 act(()=>vi.advanceTimersByTime(61000));expect(instances[3].abort).not.toHaveBeenCalled();
 expect(screen.getByText("stop continuous")).toBeInTheDocument();
});
it("stop during reconnect cancels intent and ignores stale end/result callbacks",()=>{
 const {instances,received}=setupContinuous(),old=instances[0],late=old.onresult,oldEnd=old.onend;
 act(()=>old.onend());fireEvent.click(screen.getByText("stop continuous"));
 act(()=>{oldEnd();late({results:[[{transcript:"late"}]]});vi.advanceTimersByTime(5000);});
 expect(instances).toHaveLength(1);expect(received).not.toHaveBeenCalled();
 expect(screen.getByText("start continuous")).toBeInTheDocument();
});
it("error plus end cannot create competing recognizers and permission denial stops retry",()=>{
 const {instances}=setupContinuous(),end=instances[0].onend;
 act(()=>{instances[0].onerror({error:"network"});end();vi.advanceTimersByTime(500);});
 expect(instances).toHaveLength(2);
 act(()=>{instances[1].onerror({error:"not-allowed"});vi.advanceTimersByTime(10000);});
 expect(instances).toHaveLength(2);expect(screen.getByText("start continuous")).toBeInTheDocument();
});
it("bounds consecutive service errors and cancels pending restart on unmount",()=>{
 const {instances,view}=setupContinuous();
 for(let n=0;n<4;n++) act(()=>{instances[n].onerror({error:"network"});vi.advanceTimersByTime(2000);});
 expect(instances).toHaveLength(4);expect(screen.getByText("start continuous")).toBeInTheDocument();
 fireEvent.click(screen.getByText("start continuous"));act(()=>instances[4].onend());view.unmount();
 act(()=>vi.advanceTimersByTime(10000));expect(instances).toHaveLength(5);
});
