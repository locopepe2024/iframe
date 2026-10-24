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
  const [mode,setMode]=useState<ComposerMode>("chat"),[text,setText]=useState("原有草稿");
  return <CompanionComposer mode={mode} value={text} disabled={false} busy={false} allowed inputRef={createRef()} onMode={setMode} onChange={setText} onSend={send} onUpload={()=>{}} onAllow={()=>{}} onRequestConsent={()=>{}} retry={null}/>;
}
beforeEach(()=>{send.mockReset();Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:FakeRecognition});});
afterEach(()=>{delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;});
it("explains browser dictation first, locks switching while listening, and only appends a draft",()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByRole("button",{name:"对话中"}));
  expect(screen.getByRole("region",{name:"语音输入说明"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
  expect(screen.getByRole("button",{name:"创作类型：聊天"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"发送"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"停止"}));
  expect(recognition.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("button",{name:"正在整理"})).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});
it("adds final dictation text without sending and aborts capture on unmount",async()=>{
  const {act}=await import("@testing-library/react");
  const view=render(<Harness/>);
  fireEvent.click(screen.getByRole("button",{name:"对话中"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
  act(()=>{recognition.onresult?.({results:[[{transcript:"今天很开心"}]]});recognition.onend?.();});
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("原有草稿 今天很开心");
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"对话中"}));view.unmount();
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
  expect(screen.getByText("和我聊聊天", {selector:"span"}).className).toMatch(/visuallyHidden/);
});
