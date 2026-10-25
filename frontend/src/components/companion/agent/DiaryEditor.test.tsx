import {act,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import DiaryEditor from "./DiaryEditor";
let current: Recognition;
const instances:Recognition[]=[];
class Recognition {
 lang="";continuous=false;interimResults=false;
 onresult:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((e:{error:string})=>void)|null=null;
 start=vi.fn();abort=vi.fn();stop=vi.fn();
 constructor(){current=this;instances.push(this);}
}
function say(...texts:string[]){act(()=>current.onresult?.({resultIndex:0,results:texts.map(text=>Object.assign([{transcript:text}],{isFinal:true}))}));}
function start(){
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 fireEvent.click(screen.getByRole("button",{name:"开始或继续语音记录"}));
 fireEvent.click(screen.getByRole("button",{name:"同意并开始记录"}));
}
afterEach(()=>{vi.useRealTimers();delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;instances.length=0;});
it("keeps appending across browser ends, stops explicitly and saves latest text only on command",()=>{
 vi.useFakeTimers();const save=vi.fn();render(<DiaryEditor initialText="今天" busy={false} error="" onSave={save} onCancel={()=>{}}/>);start();
 say("我们要开发语音图片和视频功能");
 expect(screen.getByLabelText("日记内容")).toHaveValue("今天\n我们要开发语音图片和视频功能");
 act(()=>current.onend?.());act(()=>vi.advanceTimersByTime(300));
 expect(instances).toHaveLength(2);expect(save).not.toHaveBeenCalled();
 say("我说停止记录的时候才停");expect(save).not.toHaveBeenCalled();
 say("停止记录");
 expect(screen.getByRole("status")).toHaveTextContent("麦克风已关闭");
 expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"开始或继续语音记录"}));
 say("下午继续测试","保存日记");
 expect(save).toHaveBeenCalledOnce();
 expect(save).toHaveBeenCalledWith("今天\n我们要开发语音图片和视频功能\n我说停止记录的时候才停\n下午继续测试");
 act(()=>vi.advanceTimersByTime(1000));expect(instances).toHaveLength(3);
});
it("uses resultIndex so repeated result lists do not duplicate text and unmount stops mic",()=>{
 const view=render(<DiaryEditor initialText="" busy={false} error="" onSave={()=>{}} onCancel={()=>{}}/>);start();say("第一句");
 act(()=>current.onresult?.({resultIndex:1,results:[Object.assign([{transcript:"第一句"}],{isFinal:true}),Object.assign([{transcript:"第二句"}],{isFinal:true})]}));
 expect(screen.getByLabelText("日记内容")).toHaveValue("第一句\n第二句");
 const mic=current;view.unmount();expect(mic.abort).toHaveBeenCalled();expect(mic.onend).toBeNull();
});
it("retains draft after an error and does not reconnect permission failures",()=>{
 vi.useFakeTimers();const save=vi.fn();render(<DiaryEditor initialText="原文" busy={false} error="" onSave={save} onCancel={()=>{}}/>);start();say("新增事实");
 act(()=>current.onerror?.({error:"not-allowed"}));act(()=>vi.advanceTimersByTime(1000));
 expect(instances).toHaveLength(1);expect(screen.getByLabelText("日记内容")).toHaveValue("原文\n新增事实");expect(save).not.toHaveBeenCalled();
});
