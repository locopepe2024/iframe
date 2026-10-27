import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CompanionComposer, { type ComposerMode } from "./CompanionComposer";
let recognition: FakeRecognition;
class FakeRecognition {
  lang="";continuous=false;interimResults=false;
  onresult: ((event: {results: {transcript:string}[][]})=>void)|null=null;
  onend: (()=>void)|null=null;onerror:(()=>void)|null=null;
  start=vi.fn();stop=vi.fn();abort=vi.fn();
  constructor(){recognition=this;}
}
const send=vi.fn();
function Harness(){
  const [mode,setMode]=useState<ComposerMode>("image"),[text,setText]=useState("原有草稿");
  return <CompanionComposer mode={mode} value={text} disabled={false} busy={false} allowed inputRef={createRef()} onMode={setMode} onChange={setText} onSend={send} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>;
}
beforeEach(()=>{send.mockReset();Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:FakeRecognition});});
afterEach(()=>{delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;});
it("explains browser dictation first, locks switching while listening, and only appends a draft",()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByRole("button",{name:"语音输入"}));
  expect(screen.getByRole("dialog",{name:"语音输入说明"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
  expect(screen.getByRole("button",{name:"创作类型：图片"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"发送"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"停止"}));
  expect(recognition.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("button",{name:"正在整理"})).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});
it("adds final dictation text without sending and aborts capture on unmount",async()=>{
  const {act}=await import("@testing-library/react");
  const view=render(<Harness/>);
  fireEvent.click(screen.getByRole("button",{name:"语音输入"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
  act(()=>{recognition.onresult?.({results:[[{transcript:"今天很开心"}]]});recognition.onend?.();});
  expect(screen.getByLabelText("想生成的图片")).toHaveValue("原有草稿 今天很开心");
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"语音输入"}));view.unmount();
  expect(recognition.abort).toHaveBeenCalledOnce();expect(recognition.onresult).toBeNull();
});

it("keeps upload in the composer and leaves album navigation to the bottom bar",()=>{
  const upload=vi.fn();render(<CompanionComposer mode="chat" value="" disabled={false} busy={false} allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={upload} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>);
  fireEvent.click(screen.getByRole("button",{name:"上传"}));expect(upload).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button",{name:"相册"})).not.toBeInTheDocument();
});
it("uses the chat invitation inside the input instead of spending a separate row",()=>{
  render(<CompanionComposer mode="chat" value="" disabled={false} busy={false} allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>);
  expect(screen.getByPlaceholderText("和我聊聊天…")).toBeInTheDocument();
  expect(screen.queryByText("和我聊聊天", {selector:"span"})).not.toBeInTheDocument();
});

it("keeps voice input clickable while a text request is busy",()=>{
 const final=vi.fn();
 render(<CompanionComposer mode="chat" value="" disabled busy allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null} onVoiceFinal={final}/>);
 const button=screen.getByRole("button",{name:"语音输入"});
 expect(button).not.toBeDisabled();
 fireEvent.click(button);
 expect(screen.getByRole("button",{name:"同意并开始聊天"})).toBeInTheDocument();
});

it("offers continuous voice consent in chat mode while retaining text drafts",()=>{
 render(<CompanionComposer mode="chat" value="保留的文字" disabled={false} busy={false} allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>);
 fireEvent.click(screen.getByRole("button",{name:"语音输入"}));
 expect(screen.getByRole("button",{name:"同意并开始聊天"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"先用文字"}));
 expect(screen.getByLabelText("和我聊聊天")).toHaveValue("保留的文字");
});

it("sends new voice sentences alone and allows stopping while busy",async()=>{
 const {act}=await import("@testing-library/react");
 const final=vi.fn(),change=vi.fn();
 const props={mode:"chat" as const,value:"未发送的草稿",disabled:false,busy:false,allowed:true,inputRef:createRef<HTMLTextAreaElement>(),onMode:()=>{},onChange:change,onSend:()=>{},onUpload:()=>{},onAllow:()=>{},onRequestConsent:()=>{},retry:null,onVoiceFinal:final};
 const view=render(<CompanionComposer {...props}/>);
 fireEvent.click(screen.getByRole("button",{name:"语音输入"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始聊天"}));
 act(()=>recognition.onresult?.({results:[[{transcript:"第一句话"}]]}));
 view.rerender(<CompanionComposer {...props} disabled busy/>);
 act(()=>recognition.onresult?.({results:[[{transcript:"第一句话"}],[{transcript:"第二句话"}]]}));
 expect(final.mock.calls).toEqual([["第一句话"],["第二句话"]]);expect(change).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"停止"})).not.toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"停止"}));expect(recognition.stop).toHaveBeenCalledOnce();
});

it("offers explicitly disclosed continuous SenseVoice capture in the demo and keeps browser recognition selectable",()=>{
 vi.stubEnv("NEXT_PUBLIC_API_URL","/companion-demo");
 try{
  render(<CompanionComposer mode="chat" value="" disabled={false} busy={false} allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>);
  fireEvent.click(screen.getByRole("button",{name:"语音输入"}));
  expect(screen.getByLabelText("识别方式")).toHaveValue("local");expect(screen.getByText(/本站 SenseVoice 测试服务/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("识别方式"),{target:{value:"browser"}});expect(screen.getByText(/交给浏览器识别/)).toBeInTheDocument();
 }finally{vi.unstubAllEnvs();}
});

it("keeps voice feedback inside the input panel without changing the draft and restarts on start only",()=>{
 const start=vi.fn(), status=vi.fn();
 render(<CompanionComposer mode="chat" value="保留的草稿" onCaptureStatus={status} onVoiceStart={start} disabled={false} busy={false} allowed inputRef={createRef()} onMode={()=>{}} onChange={()=>{}} onSend={()=>{}} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>);
 const input=screen.getByLabelText("和我聊聊天");
 expect(input).toHaveValue("保留的草稿");
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"语音输入"}));
 fireEvent.click(screen.getByRole("button",{name:"同意并开始聊天"}));
 expect(start).toHaveBeenCalledOnce();
 expect(status).toHaveBeenLastCalledWith("正在听…");
 fireEvent.click(screen.getByRole("button",{name:"停止"}));
 expect(start).toHaveBeenCalledOnce();
});

it("shows voice consent in a modal with an explicit close action without starting capture",()=>{
 render(<Harness/>);
 const mic=screen.getByRole("button",{name:"语音输入"});
 fireEvent.click(mic);
 const dialog=screen.getByRole("dialog",{name:"语音输入说明"});
 expect(dialog.tagName).toBe("DIALOG");
 expect(dialog).toHaveAttribute("open");
 fireEvent.click(screen.getByRole("button",{name:"关闭语音输入说明"}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(screen.getByLabelText("想生成的图片")).toHaveValue("原有草稿");
 expect(screen.getByRole("button",{name:"语音输入"})).toBeEnabled();
});
