import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AgentChat from "./AgentChat";
import {diaryPrompt,today} from "./DiaryCard";
const api=vi.hoisted(()=>({mediaDrafts:vi.fn(),startMediaDraft:vi.fn(),updateMediaDraft:vi.fn(),mediaEvent:vi.fn(),session:vi.fn(),messages:vi.fn(),chat:vi.fn(),turn:vi.fn(),tool:vi.fn(),confirm:vi.fn(),cancel:vi.fn(),diaries:vi.fn(),saveDiary:vi.fn()}));
const focusFetch=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",async importOriginal=>({...await importOriginal<typeof import("@/lib/api")>(),authenticatedFetch:focusFetch}));
const playback=vi.hoisted(()=>vi.fn());
vi.mock("./OpenTalkingReply",()=>({default:(props:unknown)=>{playback(props);return null;}}));
const photoApi=vi.hoisted(()=>({list:vi.fn(),image:vi.fn()}));
vi.mock("./UniArtSettings",()=>({default:()=> <section aria-label="UniArt 渠道设置"/>}));
vi.mock("@/lib/companionApi",()=>({companionApi:api}));
vi.mock("@/lib/photoApi",()=>({photoApi}));
vi.mock("../photos/PhotoImage",()=>({default:()=> <img alt="照片缩略图"/>}));
vi.mock("../PhotoConversationCard",()=>({default: ({label}:{label:string})=><article>{label}</article>}));
const preview={status:"pending_confirmation",preview_token:"token",action:"save",preview:{content:"喜欢散步",quote:"喜欢散步",source_text:"请记住我喜欢散步",source_message_id:"m",type:"preference",importance:3}};
beforeEach(()=>{
  localStorage.clear();vi.resetAllMocks();api.mediaDrafts.mockResolvedValue({tasks:[]});focusFetch.mockResolvedValue({ok:true,json:async()=>({revision:0})});photoApi.image.mockResolvedValue(new Blob());api.diaries.mockResolvedValue({diaries:[]});photoApi.list.mockResolvedValue({photos:[]});api.session.mockResolvedValue({session_id:"s"});api.messages.mockResolvedValue({messages:[],next_before:null});
  api.chat.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"confirmation",...preview}});
  api.confirm.mockResolvedValue({action:"save",memory_id:"memory"});api.cancel.mockResolvedValue({status:"preview_closed"});
});
async function start(){
  render(<AgentChat/>);fireEvent.click(screen.getByRole("button",{name:"更多"}));await waitFor(()=>expect(screen.getByRole("button",{name:"新建会话"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"新建会话"}));await screen.findByText(/已开始新的聊天/);
  fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"请记住我喜欢散步"}});
}
function allowText(){
  const more=screen.getByRole("button",{name:"更多"});
  if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
  fireEvent.click(screen.getByLabelText("允许发送文字，开始聊天"));
  fireEvent.click(more);
}
it("offers large guided cards without sending automatically",async()=>{
  await start();
  fireEvent.click(screen.getByRole("button",{name:/说说今天的生活/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("聊聊今天发生的事情");
  expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/整理今天的回忆/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("聊聊今天发生的事情");
});
it("selects photos into an unsent attachment draft",async()=>{
  await start();
  photoApi.list.mockResolvedValue({photos:[{photo_id:"photo-1",batch_id:"batch",date:{date:null,status:"pending_confirmation",reason:"missing",source:"none",revision:0}}]});
  fireEvent.click(screen.getByRole("button",{name:"相册"}));
  await screen.findByRole("button",{name:/查看照片 1/});
  fireEvent.click(screen.getByRole("button",{name:/查看照片 1/}));
  fireEvent.click(screen.getByRole("button",{name:"使用这张照片"}));
  expect(screen.getByRole("region",{name:"待发送附件"})).toHaveTextContent("相册照片");
  expect(within(screen.getByRole("region",{name:"会话消息"})).queryByText("相册照片")).not.toBeInTheDocument();
  expect(photoApi.list).toHaveBeenCalledWith("all","","","", {date_prefix:"",order:"id",limit:12});
});
it("requires external text consent and final explicit button before saving",async()=>{
  await start();fireEvent.click(screen.getByRole("button",{name:"发送"}));expect(api.chat).not.toHaveBeenCalled();
  allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("region",{name:"记忆操作确认"});expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"更多"}));
  expect(screen.getByRole("button",{name:"新建会话"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"确认保存记忆"}));await screen.findByText("个人记忆已保存。");
  expect(api.confirm).toHaveBeenCalledOnce();expect(api.chat.mock.calls[0][1].allow_external_text).toBe(true);
});
it("cancels without saving and edits through a new preview",async()=>{
  await start();allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("region",{name:"记忆操作确认"});
  api.tool.mockResolvedValue({...preview,preview_token:"edited",preview:{...preview.preview,content:"喜欢慢慢散步"}});
  fireEvent.change(screen.getByLabelText(/修改拟保存内容/),{target:{value:"喜欢慢慢散步"}});
  expect(screen.getByRole("button",{name:"确认保存记忆"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"重新预览修改后的记忆"}));await screen.findByText("拟保存：喜欢慢慢散步");
  expect(api.cancel).toHaveBeenCalledWith("token");expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"取消，不执行"}));await screen.findByText(/已关闭预览/);
  expect(api.cancel).toHaveBeenLastCalledWith("edited");expect(api.confirm).not.toHaveBeenCalled();
});
it("retains same request after uncertain response and paginates actual memories",async()=>{
  api.chat.mockRejectedValueOnce(new Error("暂不可用"));
  await start();allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
  await screen.findByRole("region",{name:"记忆操作确认"});expect(api.chat.mock.calls[0]).toEqual(api.chat.mock.calls[1]);
  fireEvent.click(screen.getByRole("button",{name:"取消，不执行"}));await screen.findByText(/已关闭预览/);
  api.tool.mockResolvedValueOnce({memories:[{id:"one",content:"第一条",quote:"原话"}],next_cursor:"next"})
    .mockResolvedValueOnce({memories:[{id:"two",content:"第二条",quote:"原话"}],next_cursor:null})
    .mockResolvedValueOnce({...preview,action:"delete",preview:{memory:{id:"two",content:"第二条",quote:"原话"}}});
  fireEvent.click(screen.getByRole("button",{name:"更多"}));
  fireEvent.click(screen.getByText("我的记忆", {selector:"summary"}));
  fireEvent.click(screen.getByRole("button",{name:"列出全部记忆"}));await screen.findByText("第一条");
  fireEvent.click(screen.getByRole("button",{name:"更多个人记忆"}));await screen.findByText("第二条");
  expect(api.tool.mock.calls[1]).toEqual(["memory.list",{cursor:"next",limit:20}]);
  fireEvent.click(screen.getAllByRole("button",{name:"删除这条记忆"})[1]);await screen.findByRole("button",{name:"确认删除记忆"});
  expect(api.confirm).not.toHaveBeenCalled();expect(screen.getByText(/只删除这条记忆/)).toBeInTheDocument();
});
it("keeps retry actionable when consent was turned off",async()=>{
 api.chat.mockRejectedValueOnce(new Error("暂不可用"));
 await start();allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await screen.findByRole("alert");
 fireEvent.click(screen.getByRole("button",{name:"更多"}));
 fireEvent.click(screen.getByLabelText("允许发送文字，开始聊天"));
 fireEvent.click(screen.getByRole("button",{name:"更多"}));
 fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
 expect(screen.getAllByRole("status").some(node => /允许发送文字/.test(node.textContent || ""))).toBe(true);
 expect(screen.getByRole("button",{name:"重试原请求"})).not.toBeDisabled();
});
it("opens channel settings instead of retrying when the personal channel is missing",async()=>{
 api.chat.mockRejectedValueOnce(new Error("请先在创作台配置当前用户的 UniArt 渠道。"));
 await start();allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await screen.findByRole("alert");
 fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
 expect(screen.getByText(/配置当前移动端身份/)).toBeInTheDocument();
 expect(api.chat).toHaveBeenCalledOnce();
});
it("restores server history and latest result from identifiers only",async()=>{
  localStorage.setItem("iframe-companion-agent-session-v1","s");localStorage.setItem("iframe-companion-agent-turn-v1","t");
  api.messages.mockResolvedValueOnce({messages:[{id:"m",sequence:1,text:"历史用户原话"}],next_before:1}).mockResolvedValueOnce({messages:[{id:"m2",sequence:2,text:"下一页"}],next_before:null});
  api.turn.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"confirmation",status:"preview_closed",preview_token:"old"}});
  render(<AgentChat/>);await screen.findByText("历史用户原话");
  await waitFor(()=>expect(screen.getByRole("button",{name:"更多历史消息"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"更多历史消息"}));await screen.findByText("下一页");
  expect(api.messages).toHaveBeenLastCalledWith("s",1);expect(screen.queryByRole("region",{name:"记忆操作确认"})).not.toBeInTheDocument();
});

it("renders an upload guide for the live upload-help result",async()=>{
  api.chat.mockResolvedValue({turn_id:"upload-turn",status:"completed",result:{kind:"upload_guide"}});
  await start();
  allowText();
  fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"怎么发"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  const card=await screen.findByRole("article",{name:"上传素材引导"});
  expect(card).toHaveTextContent("怎么加入照片或视频？");
  expect(within(card).getByRole("button",{name:"从手机添加照片或视频"})).toBeInTheDocument();
  expect(within(card).getByRole("button",{name:"从已有相册添加"})).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button",{name:"返回聊天"}));
  expect(screen.queryByRole("article",{name:"上传素材引导"})).not.toBeInTheDocument();
  expect(api.tool).not.toHaveBeenCalled();
});

it("restores an upload guide attached to a historical user message",async()=>{
  localStorage.setItem("iframe-companion-agent-session-v1","s");
  api.messages.mockResolvedValue({messages:[{id:"m-upload",sequence:1,text:"怎么发",turn:{turn_id:"upload-turn",status:"completed",result:{kind:"upload_guide"}}}],next_before:null});
  render(<AgentChat/>);
  const card=await screen.findByRole("article",{name:"上传素材引导"});
  expect(card).toHaveTextContent("怎么加入照片或视频？");
  expect(screen.getByText("怎么发")).toBeInTheDocument();
});

it("keeps debugging controls off the main screen and restores paired replies",async()=>{
  localStorage.setItem("iframe-companion-agent-session-v1","s");
  api.messages.mockResolvedValue({messages:[{id:"m",sequence:1,text:"今天女儿来看我了",turn:{turn_id:"t",status:"completed",result:{kind:"text",text:"你们一起做了什么？"}}}],next_before:null});
  render(<AgentChat/>);
  await screen.findByText("你们一起做了什么？");
  expect(screen.getByText("今天女儿来看我了")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"新建会话"})).not.toBeInTheDocument();
  expect(screen.queryByText("已保存的用户原话")).not.toBeInTheDocument();
  expect(screen.queryByText(/文字聊天测试/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"重新读取本会话原话"})).not.toBeInTheDocument();
});

const creative = {kind:"media_draft",task_id:"creative",session_id:"s",revision:1,status:"active",step:"awaiting_asset",type:"image_edit",brief:"",photo_id:null,spoken_text:"想修改哪张照片？可以上传，或从相册选择。"};
it("keeps one conversational input and opens a creative card without interpreting the unsent draft as a prompt",async()=>{
 api.startMediaDraft.mockResolvedValue(creative);
 await start();
 expect(screen.queryByRole("button",{name:/创作类型：/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("创作",{selector:"summary"}));
 fireEvent.click(screen.getByRole("button",{name:"修改照片"}));
 await screen.findByRole("region",{name:"当前创作任务"});
 expect(screen.getByLabelText("和我聊聊天")).toHaveValue("请记住我喜欢散步");
 expect(screen.queryByRole("button",{name:"查看生成设置"})).not.toBeInTheDocument();
 expect(api.chat).not.toHaveBeenCalled();
 expect(api.startMediaDraft).toHaveBeenCalledWith("s",expect.objectContaining({type:"image_edit"}));
});
it("uses a model tool result to wait for a concrete brief instead of displaying intent as generation settings",async()=>{
 api.chat.mockResolvedValue({turn_id:"creative-turn",status:"completed",result:creative});
 await start();allowText();
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"我们编辑一张图片吧"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await screen.findByRole("region",{name:"当前创作任务"});
 expect(screen.queryByText("设置已确认")).not.toBeInTheDocument();
 expect(screen.getByLabelText("和我聊聊天")).toHaveValue("");
});
it("offers explicit slash shortcuts while preserving the conversational input",async()=>{
 await start();
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"/"}});
 fireEvent.click(screen.getByRole("button",{name:"/图像编辑"}));
 expect(screen.getByLabelText("和我聊聊天")).toHaveValue("/图像编辑 ");
 expect(api.chat).not.toHaveBeenCalled();
});
it("restores a creative brief after reload and preserves it when pausing",async()=>{
 localStorage.setItem("iframe-companion-agent-session-v1","s");
 api.mediaDrafts.mockResolvedValue({tasks:[creative]});
 api.updateMediaDraft.mockResolvedValue({...creative,revision:2,status:"paused",spoken_text:"创作要求已保留，先回到聊天。"});
 render(<AgentChat/>);
 fireEvent.click(await screen.findByRole("button",{name:"先聊会儿"}));
 await screen.findByRole("button",{name:"继续这次创作"});
 expect(api.updateMediaDraft).toHaveBeenCalledWith("s",expect.objectContaining({task_id:"creative",expected_revision:1,action:"pause"}));
});

it("opens daily sample plans without calling the model and preserves an existing draft",async()=>{
  await start();
  fireEvent.click(screen.getByRole("button",{name:"看看安排"}));
  expect(screen.getByRole("region",{name:"计划对话"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"稍后提醒"}));
  expect(api.chat).not.toHaveBeenCalled();expect(api.tool).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"返回今日计划"}));
  fireEvent.click(screen.getByRole("button",{name:"聊聊今天"}));
  fireEvent.click(screen.getByRole("button",{name:"开始记录"}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("请记住我喜欢散步");
  expect(screen.getByText(/输入框里还有未发送的话/)).toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();
});
it("explains the text consent before sending a diary draft",async()=>{
  await start();
  fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:""}});
  fireEvent.click(screen.getByRole("button",{name:"日记"}));
  fireEvent.click(await screen.findByRole("button",{name:"整理这一天的日记"}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue(diaryPrompt(today()));
  expect(screen.getByText(/日记草稿已写入/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(screen.getByText("请在“更多 → 聊天设置”中允许发送文字。")).toBeInTheDocument();
  expect(screen.getByRole("region",{name:"聊天设置"})).toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("允许发送文字，开始聊天"));
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await waitFor(()=>expect(api.chat).toHaveBeenCalledOnce());
});

async function selectPhoto() {
  photoApi.list.mockResolvedValue({photos:[{photo_id:"p"}],next_after_id:null});
  fireEvent.click(screen.getByRole("button",{name:"相册"}));
  fireEvent.click(await screen.findByRole("button",{name:/查看照片 1/}));
  fireEvent.click(screen.getByRole("button",{name:"使用这张照片"}));
}
it("removes a selected photo without sending or deleting the original",async()=>{
  await start();await selectPhoto();
  fireEvent.click(screen.getByRole("button",{name:"移除附件：相册照片"}));
  expect(screen.queryByRole("region",{name:"待发送附件"})).not.toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();expect(api.tool).not.toHaveBeenCalled();
});
it("adds an attachment-only message locally without making a model request",async()=>{
  await start();fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:""}});await selectPhoto();
  expect(screen.getByText(/助手暂时看不到/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(within(screen.getByRole("region",{name:"会话消息"})).getByText("相册照片")).toBeInTheDocument();
  expect(screen.queryByRole("region",{name:"待发送附件"})).not.toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();expect(api.session).toHaveBeenCalledTimes(1);
});
it("retains attachments through an uncertain text request and only clears them after a successful retry",async()=>{
  api.chat.mockRejectedValueOnce(new Error("网络中断"));
  await start();await selectPhoto();
  allowText();
  expect(screen.getByRole("button",{name:"发送"})).toBeDisabled();
  fireEvent.click(screen.getByLabelText("我知道本次只发送文字给助手"));fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("region",{name:"待发送附件"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"移除附件：相册照片"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));await screen.findByRole("region",{name:"记忆操作确认"});
  expect(screen.queryByRole("region",{name:"待发送附件"})).not.toBeInTheDocument();
  expect(api.chat.mock.calls[0]).toEqual(api.chat.mock.calls[1]);
  expect(Object.keys(api.chat.mock.calls[0][1]).sort()).toEqual(["allow_external_text","operation_id","text"]);
  expect(within(screen.getByRole("region",{name:"会话消息"})).getAllByText("相册照片")).toHaveLength(1);
});
it("keeps unsent chat attachments when opening a creative task",async()=>{
 api.startMediaDraft.mockResolvedValue(creative);
 await start();await selectPhoto();
 fireEvent.click(screen.getByText("创作",{selector:"summary"}));
 fireEvent.click(screen.getByRole("button",{name:"修改照片"}));
 await screen.findByRole("region",{name:"当前创作任务"});
 expect(screen.getByRole("region",{name:"待发送附件"})).toBeInTheDocument();
 expect(api.chat).not.toHaveBeenCalled();
});
it("shows an explicit diary card for a completed diary request without auto saving",async()=>{
  const day=today(),prompt=diaryPrompt(day);
  api.chat.mockResolvedValue({turn_id:"diary-turn",status:"completed",result:{kind:"text",text:"今天和女儿一起喝茶。"}});
  await start();fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:""}});
  fireEvent.click(screen.getByRole("button",{name:"日记"}));fireEvent.click(await screen.findByRole("button",{name:"整理这一天的日记"}));
  api.messages.mockResolvedValue({messages:[{id:"dm",text:prompt,turn:{turn_id:"diary-turn",result:{kind:"text",text:"今天和女儿一起喝茶。"}}}],next_before:null});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));allowText();fireEvent.click(screen.getByRole("button",{name:"发送"}));
  const card=await screen.findByRole("article",{name:"日记草稿"});
  await waitFor(()=>expect(within(card).getByRole("button",{name:"继续写日记"})).toBeEnabled());
  expect(card).toHaveTextContent("今天和女儿一起喝茶。");expect(api.saveDiary).not.toHaveBeenCalled();
});

it("gives a natural-language diary request save actions and calendar retrieval",async()=>{
 const day=today(),body=`**${day} · 日记**\n今天和女儿一起喝茶。`;
 api.chat.mockResolvedValue({turn_id:"natural-diary",status:"completed",result:{kind:"text",text:body}});
 const saved={day,text:body,source_turn_id:"natural-diary",revision:1};
 api.saveDiary.mockResolvedValue(saved);
 await start();allowText();
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"写一下今天的日记吧"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 const card=await screen.findByRole("article",{name:"日记草稿"});
 await waitFor(()=>expect(within(card).getByRole("button",{name:"保存日记"})).toBeEnabled());
 expect(api.chat.mock.calls[0][1].text).toBe(diaryPrompt(day));
 expect(api.saveDiary).not.toHaveBeenCalled();
 fireEvent.click(within(card).getByRole("button",{name:"保存日记"}));
 await screen.findByRole("article",{name:"已保存日记"});
 api.diaries.mockResolvedValue({diaries:[saved]});
 fireEvent.click(screen.getByRole("button",{name:"查看已保存日记"}));
 await screen.findByRole("button",{name:`${day}，已有日记`});
 expect(screen.getAllByRole("article",{name:"已保存日记"})).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:`${day}，已有日记`}));
  expect(screen.getAllByRole("article",{name:"已保存日记"})).toHaveLength(2);
});

it("restores save actions for a historical natural diary reply with a dated heading",async()=>{
 localStorage.setItem("iframe-companion-agent-session-v1","s");
 api.messages.mockResolvedValue({messages:[{id:"old",text:"写一下今天的日记吧",turn:{turn_id:"old-turn",result:{kind:"text",text:"**2026年10月24日 · 日记**\n今天喝茶。"}}}],next_before:null});
 render(<AgentChat/>);
 const card=await screen.findByRole("article",{name:"日记草稿"});
 expect(card).toHaveTextContent("2026-10-24");
});

it("queues voice sentences while sending and preserves a failed request until retry",async()=>{
 const {act}=await import("@testing-library/react");
 let recognition: {onresult:((event:unknown)=>void)|null};
 class Recognition {
   onresult=null;onerror=null;onend=null;lang="";continuous=false;interimResults=false;
   constructor(){recognition=this;} start(){} stop(){} abort(){}
 }
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 try {
   let rejectFirst!:(error:Error)=>void;
   api.chat.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectFirst=reject;})).mockResolvedValue({turn_id:"voice-turn",status:"completed",result:{kind:"text",text:"收到"}});
   await start();allowText();
   fireEvent.click(screen.getByRole("button",{name:"语音输入"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始聊天"}));
   act(()=>recognition.onresult?.({results:[[{transcript:"第一句"}]]}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(1));
   act(()=>recognition.onresult?.({results:[[{transcript:"第一句"}],[{transcript:"第二句"}],[{transcript:"第三句"}]]}));
   expect(api.chat).toHaveBeenCalledTimes(1);
   await act(async()=>rejectFirst(new Error("连接中断")));
   expect(api.chat).toHaveBeenCalledTimes(1);
   fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(4));
   expect(api.chat.mock.calls.map(call=>call[1].text)).toEqual(["第一句","第一句","第二句","第三句"]);
   expect(api.chat.mock.calls[0][1].operation_id).toBe(api.chat.mock.calls[1][1].operation_id);
 } finally {delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;}
});

it("persists the preferred reply mode and exposes automatic audio playback setting",async()=>{
 await start();
 const more=screen.getByRole("button",{name:"更多"});if(more.getAttribute("aria-expanded")!=="true")fireEvent.click(more);
 expect(screen.getByRole("button",{name:"保存设置"})).not.toBeDisabled();
 const audio=screen.getByRole("radio",{name:/方案 1/});fireEvent.click(audio);expect(audio).toBeChecked();expect(localStorage.getItem("iframe-companion-agent-response-mode-v1")).toBe("audio");
 const text=screen.getByRole("radio",{name:/方案 2/});fireEvent.click(text);expect(text).toBeChecked();expect(localStorage.getItem("iframe-companion-agent-response-mode-v1")).toBe("text");
 fireEvent.click(screen.getByRole("button",{name:"保存设置"}));
 expect(screen.getByText("✓ 设置已保存")).toBeInTheDocument();
});

it("plays workflow progress through OpenTalking only in audio mode",async()=>{
  localStorage.setItem("iframe-companion-agent-response-mode-v1","audio");
  await start();allowText();
  api.chat.mockResolvedValue({turn_id:"task-turn",status:"completed",result:{kind:"photo_task",task_id:"task",revision:1,status:"waiting_input",step:"select_photo",photos:[],spoken_text:"没有找到符合条件的照片。"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await waitFor(()=>expect(playback).toHaveBeenLastCalledWith(expect.objectContaining({reply:{id:"task-turn",text:"没有找到符合条件的照片。"}})));
});
it("keeps text mode silent when a workflow responds",async()=>{
  await start();allowText();
  api.chat.mockResolvedValue({turn_id:"task-turn",status:"completed",result:{kind:"photo_task",task_id:"task",revision:1,status:"waiting_input",step:"select_photo",photos:[],spoken_text:"没有找到符合条件的照片。"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await waitFor(()=>expect(api.chat).toHaveBeenCalledOnce());
  await waitFor(()=>expect(screen.getByLabelText("和我聊聊天")).toHaveValue(""));
  expect(playback).not.toHaveBeenCalled();
});
it("shows the registered diary capability and opens its calendar",async()=>{
  api.messages.mockResolvedValue({messages:[{id:"diary-msg",sequence:1,text:"打开日记",turn:{turn_id:"diary-turn",status:"completed",result:{kind:"diary_read",name:"diary.open",diaries:[],open_calendar:true,spoken_text:"日记入口已经打开，可以查看日历或选择一天写日记。"}}}],next_before:null});
  localStorage.setItem("iframe-companion-agent-session-v1","s");
  render(<AgentChat/>);
  const reopen = await screen.findByRole("button",{name:"打开日记月历"});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(reopen);
  await screen.findByRole("dialog");
  expect(screen.queryByText("实际记忆查询结果")).not.toBeInTheDocument();
});


it("does not offer retry while a request is pending or when only history refresh fails", async () => {
  let complete!: (value: unknown) => void;
  api.chat.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await start(); allowText();
  fireEvent.change(screen.getByLabelText("和我聊聊天"), {target: {value: "梳理相册"}});
  fireEvent.click(screen.getByRole("button", {name: "发送"}));
  await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", {name: "重试原请求"})).not.toBeInTheDocument();
  api.messages.mockRejectedValueOnce(new Error("history unavailable"));
  complete({turn_id: "album-turn", status: "completed", result: {kind: "photo_read", name: "photo.album.list", arguments: {}, photos: [], next_after_id: null}});
  await screen.findByText(/历史消息暂未刷新/);
  expect(screen.queryByRole("button", {name: "重试原请求"})).not.toBeInTheDocument();
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("");
});

it("restores the scope card and starts a durable task only for the explicitly selected photo", async () => {
  localStorage.setItem("iframe-companion-agent-session-v1", "s");
  localStorage.setItem("iframe-companion-agent-text-consent-v1", "true");
  const scope = {turn_id: "scope", status: "completed", result: {kind: "album_guide", browse: false, spoken_text: "想整理哪些照片？"}};
  api.messages.mockResolvedValue({messages: [{id: "m", sequence: 1, text: "梳理相册", turn: scope}], next_before: null});
  photoApi.list.mockResolvedValue({photos: [{photo_id: "selected"}], next_after_id: null});
  render(<AgentChat />);
  await screen.findByRole("article", {name: "选择整理范围"});
  expect(photoApi.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "最近加入"}));
  await screen.findByRole("button", {name: "查看照片 1"});
  const task = {turn_id: "picked", status: "completed", result: {kind: "photo_task", task_id: "task", step: "review_photo", status: "waiting_input", revision: 1, photos: []}};
  api.chat.mockResolvedValue(task);
  api.messages.mockResolvedValue({messages: [{id: "m2", sequence: 2, text: "整理这张照片", turn: task}], next_before: null});
  fireEvent.click(screen.getByRole("button", {name: "查看照片 1"}));
  fireEvent.click(screen.getByRole("button",{name:"使用这张照片"}));
  await screen.findByRole("region", {name: "相册整理任务"});
  expect(api.chat.mock.calls[0][1]).toMatchObject({text: "整理这张照片", selected_photo_id: "selected"});
  expect(screen.queryByRole("dialog", {name: "浏览相册"})).not.toBeInTheDocument();
});

it("keeps the original request when task focus cannot be synchronized",async()=>{
  await start();allowText();focusFetch.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("alert");expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
  await screen.findByRole("region",{name:"记忆操作确认"});
  expect(api.chat).toHaveBeenCalledOnce();
  const put=focusFetch.mock.calls.find(([,options])=>options.method === "PUT");
  expect(JSON.parse(put![1].body).focus).toEqual({kind:"chat",object_id:"",phase:"viewing",draft:""});
});


it("uses the same agent and OpenTalking reply path from the top voice entry",async()=>{
 const {act}=await import("@testing-library/react");
 let recognition!:{onresult:((event:unknown)=>void)|null;stop:ReturnType<typeof vi.fn>};
 class Recognition {
   onresult=null;onerror=null;onend=null;lang="";continuous=false;interimResults=false;
   stop=vi.fn();abort=vi.fn();start=vi.fn();constructor(){recognition=this;}
 }
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 try {
   api.chat.mockResolvedValueOnce({turn_id:"voice-1",status:"completed",result:{kind:"text",text:"我在这里"}})
     .mockResolvedValueOnce({turn_id:"voice-2",status:"completed",result:{kind:"text",text:"一起看看相册"}});
   localStorage.setItem("iframe-companion-agent-response-mode-v1","text");
   await start();allowText();
   fireEvent.click(screen.getByRole("button",{name:"打开语音聊天"}));
   expect(await screen.findByRole("button",{name:"同意并开始聊天"})).toBeInTheDocument();
   fireEvent.click(screen.getByRole("button",{name:"同意并开始聊天"}));
   expect(screen.getByRole("button",{name:"停止"})).toBeInTheDocument();
   act(()=>recognition.onresult?.({results:[[{transcript:"小安你好"}]]}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(1));
   await waitFor(()=>expect(playback.mock.calls.some(([props])=>props.reply?.text === "我在这里")).toBe(true));
   act(()=>recognition.onresult?.({results:[[{transcript:"小安你好"}],[{transcript:"看看相册"}]]}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(2));
   await waitFor(()=>expect(playback.mock.calls.some(([props])=>props.reply?.text === "一起看看相册")).toBe(true));
   expect(api.chat.mock.calls.map(([id])=>id)).toEqual(["s","s"]);
   expect(localStorage.getItem("iframe-companion-agent-response-mode-v1")).toBe("text");
   fireEvent.click(screen.getByRole("button",{name:"停止语音聊天"}));
   expect(recognition.stop).toHaveBeenCalledOnce();
 } finally {delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;}
});


it("cancels the top voice prompt without enabling audio replies",async()=>{
  await start();allowText();
  fireEvent.click(screen.getByRole("button",{name:"打开语音聊天"}));
  fireEvent.click(await screen.findByRole("button",{name:"先用文字"}));
  playback.mockClear();
  api.chat.mockResolvedValue({turn_id:"text-only",status:"completed",result:{kind:"text",text:"文字回复"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByText("文字回复");
  expect(playback).not.toHaveBeenCalled();
});

it("cancels the shared microphone when starting a new session",async()=>{
 const {act}=await import("@testing-library/react");
 let recognition!:{onresult:((event:unknown)=>void)|null;abort:ReturnType<typeof vi.fn>};
 class Recognition {
   onresult=null;onerror=null;onend=null;lang="";continuous=false;interimResults=false;
   stop=vi.fn();abort=vi.fn();start=vi.fn();constructor(){recognition=this;}
 }
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 try {
   await start();allowText();
   fireEvent.click(screen.getByRole("button",{name:"打开语音聊天"}));
   fireEvent.click(await screen.findByRole("button",{name:"同意并开始聊天"}));
   const late=recognition.onresult;
   fireEvent.click(screen.getByRole("button",{name:"更多"}));
   fireEvent.click(screen.getByRole("button",{name:"新建会话"}));
   await waitFor(()=>expect(recognition.abort).toHaveBeenCalled());
   act(()=>late?.({results:[[{transcript:"旧会话的录音"}]]}));
   expect(api.chat).not.toHaveBeenCalled();
 } finally {delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;}
});


it("keeps the diary focus of a queued voice sentence after the editor closes",async()=>{
 const {act}=await import("@testing-library/react");
 let recognition!:{onresult:((event:unknown)=>void)|null};
 class Recognition {
   onresult=null;onerror=null;onend=null;lang="";continuous=false;interimResults=false;
   stop=vi.fn();abort=vi.fn();start=vi.fn();constructor(){recognition=this;}
 }
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 try {
   let complete!:(value:unknown)=>void;
   api.chat.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}))
     .mockResolvedValue({turn_id:"diary-voice",status:"completed",result:{kind:"text",text:"可以接着讲"}});
   await start();allowText();
   fireEvent.click(screen.getByRole("button",{name:"语音输入"}));
   fireEvent.click(screen.getByRole("button",{name:"同意并开始聊天"}));
   act(()=>recognition.onresult?.({results:[[{transcript:"你好"}]]}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(1));
   fireEvent.click(screen.getByRole("button",{name:"日记"}));
   fireEvent.click(await screen.findByRole("button",{name:"开始记录日记"}));
   fireEvent.change(await screen.findByLabelText("日记内容"),{target:{value:"今天女儿来看我"}});
   act(()=>recognition.onresult?.({results:[[{transcript:"你好"}],[{transcript:"女儿教我怎么上传照片"}]]}));
   fireEvent.click(screen.getByRole("button",{name:"取消编辑"}));
   await act(async()=>complete({turn_id:"first-voice",status:"completed",result:{kind:"text",text:"你好"}}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(2));
   const updates=focusFetch.mock.calls.filter(([,options])=>options.method === "PUT").map(([,options])=>JSON.parse(options.body));
   expect(updates[1].focus).toEqual({kind:"diary",object_id:today(),phase:"editing",draft:"今天女儿来看我"});
   expect(api.chat.mock.calls[1][1].text).toBe("女儿教我怎么上传照片");
   expect(api.saveDiary).not.toHaveBeenCalled();
 } finally {delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;}
});


it("speaks upload guidance and pending confirmation through OpenTalking without claiming completion",async()=>{
 localStorage.setItem("iframe-companion-agent-response-mode-v1","audio");
 api.chat.mockResolvedValueOnce({turn_id:"upload-audio",status:"completed",result:{kind:"upload_guide"}})
   .mockResolvedValueOnce({turn_id:"confirmation-audio",status:"completed",result:{kind:"confirmation",...preview}});
 await start();allowText();
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"怎么上传照片"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await waitFor(()=>expect(playback.mock.calls.some(([props])=>props.reply?.text.includes("从手机添加"))).toBe(true));
 await waitFor(()=>expect(screen.getByLabelText("和我聊聊天")).not.toBeDisabled());
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"请记住我喜欢散步"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await waitFor(()=>expect(playback.mock.calls.some(([props])=>props.reply?.id === "confirmation-audio" && props.reply.text.includes("还没有执行"))).toBe(true));
 expect(api.confirm).not.toHaveBeenCalled();
});


it("does not speak a late reply after text mode was selected and audio re-enabled",async()=>{
 const {act}=await import("@testing-library/react");
 let complete!:(value:unknown)=>void;
 api.chat.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 localStorage.setItem("iframe-companion-agent-response-mode-v1","audio");
 await start();allowText();
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await waitFor(()=>expect(api.chat).toHaveBeenCalledOnce());
 fireEvent.click(screen.getByRole("button",{name:"更多"}));
 fireEvent.click(screen.getByRole("radio",{name:/方案 2/}));
 fireEvent.click(screen.getByRole("radio",{name:/方案 1/}));
 playback.mockClear();
 await act(async()=>complete({turn_id:"late-reply",status:"completed",result:{kind:"text",text:"这条只保留文字"}}));
 await screen.findByText("这条只保留文字");
 expect(playback.mock.calls.some(([props])=>props.reply?.id === "late-reply")).toBe(false);
});

it("opens the calendar from a fresh diary list reply without dumping saved entries into chat",async()=>{
 api.chat.mockResolvedValue({turn_id:"calendar-new",status:"completed",result:{kind:"diary_read",name:"diary.list",open_calendar:true,month:"2025-02",spoken_text:"这个月有1篇已保存日记。",diaries:[{day:"2025-02-14",text:"不应在聊天展示的正文",revision:1,source_turn_id:""}]}});
 await start(); allowText();
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"看一下都哪些天写日记了"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await screen.findByRole("dialog",{name:"日记"});
 expect(screen.getByLabelText("选择年月")).toHaveValue("2025-02");
 expect(screen.queryByText("不应在聊天展示的正文")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"关闭日记"}));
 expect(screen.queryByRole("dialog",{name:"日记"})).not.toBeInTheDocument();
});
it("keeps voice active and opens the requested diary inside the calendar",async()=>{
 const {act}=await import("@testing-library/react");
 let recognition!:{onresult:((event:unknown)=>void)|null;stop:ReturnType<typeof vi.fn>};
 class Recognition {
   onresult=null;onerror=null;onend=null;lang="";continuous=false;interimResults=false;
   stop=vi.fn();abort=vi.fn();start=vi.fn();constructor(){recognition=this;}
 }
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 try {
   const entry={day:"2025-10-28",text:"那天和女儿散步。",revision:1,source_turn_id:"",updated_at:1};
   api.diaries.mockImplementation(async month=>({diaries:month === "2025-10" ? [entry] : []}));
   api.chat.mockResolvedValueOnce({turn_id:"open-calendar",status:"completed",result:{kind:"diary_read",name:"diary.open",open_calendar:true,diaries:[],spoken_text:"日记月历已打开。"}})
     .mockResolvedValueOnce({turn_id:"read-day",status:"completed",result:{kind:"diary_read",name:"diary.read",arguments:{day:entry.day},open_calendar:false,diaries:[entry],spoken_text:"找到这一天的日记了。"}});
   await start();allowText();
   fireEvent.click(screen.getByRole("button",{name:"打开语音聊天"}));
   fireEvent.click(await screen.findByRole("button",{name:"同意并开始聊天"}));
   act(()=>recognition.onresult?.({results:[[{transcript:"打开日记月历"}]]}));
   const calendar=await screen.findByRole("dialog",{name:"日记"});
   act(()=>recognition.onresult?.({results:[[{transcript:"打开日记月历"}],[{transcript:"打开2025年10月28日日记"}]]}));
   await waitFor(()=>expect(api.chat).toHaveBeenCalledTimes(2));
   expect(await within(calendar).findByText(entry.text)).toBeInTheDocument();
   expect(within(calendar).getByRole("button",{name:entry.day+"，已有日记"})).toHaveAttribute("aria-pressed","true");
   expect(recognition.stop).not.toHaveBeenCalled();
   expect(playback.mock.calls.some(([props])=>props.reply?.text === "找到这一天的日记了。")).toBe(true);
 } finally {delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;}
});
it("shows a retained failed sentence and allows resuming a paused task without replaying it",async()=>{
 localStorage.setItem("iframe-companion-agent-session-v1","s");
 const paused={...creative,status:"paused",revision:2,brief:"换黑袍"};
 api.mediaDrafts.mockResolvedValue({tasks:[paused]});
 api.chat.mockRejectedValueOnce(new Error("操作未通过校验"));
 api.updateMediaDraft.mockResolvedValue({...paused,status:"active",revision:3});
 render(<AgentChat/>);
 await screen.findByRole("button",{name:"继续这次创作"});
 allowText();
 api.messages.mockResolvedValue({messages:[{id:"failed",sequence:1,text:"继续之前没有完成的任务"}],next_before:null});
 fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"继续之前没有完成的任务"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 await screen.findByRole("alert");
 expect(screen.getByText("继续之前没有完成的任务",{selector:"p"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"继续这次创作"})).not.toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"继续这次创作"}));
 await waitFor(()=>expect(api.updateMediaDraft).toHaveBeenCalledWith("s",expect.objectContaining({task_id:"creative",expected_revision:2,action:"resume"})));
 await waitFor(()=>expect(screen.queryByRole("button",{name:"重试原请求"})).not.toBeInTheDocument());
 expect(api.chat).toHaveBeenCalledOnce();
});
