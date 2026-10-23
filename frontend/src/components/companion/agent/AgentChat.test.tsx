import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AgentChat from "./AgentChat";
const api=vi.hoisted(()=>({session:vi.fn(),messages:vi.fn(),chat:vi.fn(),turn:vi.fn(),tool:vi.fn(),confirm:vi.fn(),cancel:vi.fn()}));
const photoApi=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("@/lib/companionApi",()=>({companionApi:api}));
vi.mock("@/lib/photoApi",()=>({photoApi}));
vi.mock("../photos/PhotoImage",()=>({default:()=> <img alt="照片缩略图"/>}));
vi.mock("../PhotoConversationCard",()=>({default: ({label}:{label:string})=><article>{label}</article>}));
const preview={status:"pending_confirmation",preview_token:"token",action:"save",preview:{content:"喜欢散步",quote:"喜欢散步",source_text:"请记住我喜欢散步",source_message_id:"m",type:"preference",importance:3}};
beforeEach(()=>{
  localStorage.clear();vi.resetAllMocks();photoApi.list.mockResolvedValue({photos:[]});api.session.mockResolvedValue({session_id:"s"});api.messages.mockResolvedValue({messages:[],next_after:null});
  api.chat.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"confirmation",...preview}});
  api.confirm.mockResolvedValue({action:"save",memory_id:"memory"});api.cancel.mockResolvedValue({status:"preview_closed"});
});
async function start(){
  render(<AgentChat/>);fireEvent.click(screen.getByRole("button",{name:"更多"}));await waitFor(()=>expect(screen.getByRole("button",{name:"新建会话"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"新建会话"}));await screen.findByText(/已开始新的聊天/);
  fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"请记住我喜欢散步"}});
}
it("offers large guided cards without sending automatically",async()=>{
  await start();
  fireEvent.click(screen.getByRole("button",{name:/说说今天的生活/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("聊聊今天发生的事情");
  expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/整理今天的回忆/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("请把我们今天聊的内容整理成一篇回忆日记");
});
it("selects photos into an unsent attachment draft",async()=>{
  await start();
  photoApi.list.mockResolvedValue({photos:[{photo_id:"photo-1",batch_id:"batch",date:{date:null,status:"pending_confirmation",reason:"missing",source:"none",revision:0}}]});
  fireEvent.click(screen.getByRole("button",{name:"相册"}));
  await screen.findByRole("button",{name:/选择照片 1/});
  fireEvent.click(screen.getByRole("button",{name:/选择照片 1/}));
  expect(screen.getByRole("region",{name:"待发送附件"})).toHaveTextContent("相册照片");
  expect(within(screen.getByRole("region",{name:"会话消息"})).queryByText("相册照片")).not.toBeInTheDocument();
  expect(photoApi.list).toHaveBeenCalledWith("all","","","");
});
it("requires external text consent and final explicit button before saving",async()=>{
  await start();expect(screen.getByRole("button",{name:"发送"})).toBeDisabled();
  fireEvent.click(screen.getByText("开始聊天前，请确认文字发送范围", {selector:"summary"}));fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByRole("region",{name:"记忆操作确认"});expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"更多"}));
  expect(screen.getByRole("button",{name:"新建会话"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"确认保存记忆"}));await screen.findByText("个人记忆已保存。");
  expect(api.confirm).toHaveBeenCalledOnce();expect(api.chat.mock.calls[0][1].allow_external_text).toBe(true);
});
it("cancels without saving and edits through a new preview",async()=>{
  await start();fireEvent.click(screen.getByText("开始聊天前，请确认文字发送范围", {selector:"summary"}));fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送"}));
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
  await start();fireEvent.click(screen.getByText("开始聊天前，请确认文字发送范围", {selector:"summary"}));fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送"}));
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
it("restores server history and latest result from identifiers only",async()=>{
  localStorage.setItem("iframe-companion-agent-session-v1","s");localStorage.setItem("iframe-companion-agent-turn-v1","t");
  api.messages.mockResolvedValueOnce({messages:[{id:"m",sequence:1,text:"历史用户原话"}],next_after:1}).mockResolvedValueOnce({messages:[{id:"m2",sequence:2,text:"下一页"}],next_after:null});
  api.turn.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"confirmation",status:"preview_closed",preview_token:"old"}});
  render(<AgentChat/>);await screen.findByText("历史用户原话");
  await waitFor(()=>expect(screen.getByRole("button",{name:"更多历史消息"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"更多历史消息"}));await screen.findByText("下一页");
  expect(api.messages).toHaveBeenLastCalledWith("s",1);expect(screen.queryByRole("region",{name:"记忆操作确认"})).not.toBeInTheDocument();
});

it("keeps debugging controls off the main screen and restores paired replies",async()=>{
  localStorage.setItem("iframe-companion-agent-session-v1","s");
  api.messages.mockResolvedValue({messages:[{id:"m",sequence:1,text:"今天女儿来看我了",turn:{turn_id:"t",status:"completed",result:{kind:"text",text:"你们一起做了什么？"}}}],next_after:null});
  render(<AgentChat/>);
  await screen.findByText("你们一起做了什么？");
  expect(screen.getByText("今天女儿来看我了")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"新建会话"})).not.toBeInTheDocument();
  expect(screen.queryByText("已保存的用户原话")).not.toBeInTheDocument();
  expect(screen.queryByText(/文字聊天测试/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"重新读取本会话原话"})).not.toBeInTheDocument();
});

async function switchMode(label: string) {
  fireEvent.click(screen.getByRole("button", {name: /^创作类型：/}));
  fireEvent.click(screen.getByRole("menuitemradio", {name: label}));
}
it("keeps chat, image and video drafts independent without sending a media request to chat", async () => {
  await start();
  await switchMode("图片");
  fireEvent.change(screen.getByLabelText("想生成的图片"), {target:{value:"一朵花"}});
  await switchMode("视频");
  fireEvent.change(screen.getByLabelText("想生成的视频"), {target:{value:"花朵慢慢开放"}});
  await switchMode("聊天");
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("请记住我喜欢散步");
  await switchMode("图片");
  expect(screen.getByLabelText("想生成的图片")).toHaveValue("一朵花");
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(screen.getByRole("region",{name:"图片创作引导"})).toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();
  expect(photoApi.list).not.toHaveBeenCalled();
  await switchMode("视频");
  expect(screen.getByLabelText("想生成的视频")).toHaveValue("花朵慢慢开放");
  await switchMode("图片");
  expect(screen.getByRole("region",{name:"图片创作引导"})).toBeInTheDocument();
});
it("previews recommended media settings honestly and can go back or cancel", async () => {
  await start(); await switchMode("视频");
  fireEvent.change(screen.getByLabelText("想生成的视频"),{target:{value:"老街骑马"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  fireEvent.click(screen.getByRole("button",{name:"不加参考图片"}));
  fireEvent.click(screen.getByRole("button",{name:"10 秒"}));
  expect(screen.getByText("老街骑马",{selector:"dd"})).toBeInTheDocument();
  expect(screen.getByText("10 秒",{selector:"dd"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"返回修改"}));
  fireEvent.click(screen.getByRole("button",{name:"用推荐设置"}));
  expect(screen.getByText("5 秒",{selector:"dd"})).toBeInTheDocument();
  expect(screen.getByText("尚未报价")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"确认生成（暂未开放）"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"确认设置"}));
  expect(screen.getByText("已确认本次设置，尚未开始生成。")).toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"取消创作"}));
  expect(screen.getByLabelText("想生成的视频")).toHaveValue("老街骑马");
  expect(screen.queryByRole("region",{name:"视频创作引导"})).not.toBeInTheDocument();
});
it("does not reuse an already-sent chat draft when switching modes",async()=>{
  api.chat.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"text",text:"您好"}});
  await start();fireEvent.click(screen.getByText("开始聊天前，请确认文字发送范围", {selector:"summary"}));fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送"}));
  await screen.findByText("您好"); await switchMode("图片"); await switchMode("聊天");
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("");
});
it("supports Escape and arrow navigation in the mode menu",async()=>{
  await start(); const trigger=screen.getByRole("button",{name:"创作类型：聊天"});
  fireEvent.click(trigger); expect(screen.getByRole("menuitemradio",{name:"聊天"})).toHaveFocus();
  fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});expect(screen.getByRole("menuitemradio",{name:"图片"})).toHaveFocus();
  fireEvent.keyDown(document.activeElement!,{key:"Escape"});expect(screen.queryByRole("menu")).not.toBeInTheDocument();expect(trigger).toHaveFocus();
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

async function selectPhoto() {
  photoApi.list.mockResolvedValue({photos:[{photo_id:"p"}],next_after_id:null});
  fireEvent.click(screen.getByRole("button",{name:"相册"}));
  fireEvent.click(await screen.findByRole("button",{name:/选择照片 1/}));
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
  fireEvent.click(screen.getByText("开始聊天前，请确认文字发送范围",{selector:"summary"}));
  fireEvent.click(screen.getByLabelText("允许发送文字，开始聊天"));
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
it("keeps attachments independent between types and binds a single photo when submitting a media description",async()=>{
  await start();await selectPhoto();await switchMode("视频");
  expect(screen.queryByRole("region",{name:"待发送附件"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("想生成的视频"),{target:{value:"花园里的光"}});
  await selectPhoto();fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(screen.getByText("已选择参考照片")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"5 秒"})).toBeInTheDocument();
  await switchMode("聊天");expect(screen.getByRole("region",{name:"待发送附件"})).toBeInTheDocument();
  expect(api.chat).not.toHaveBeenCalled();
});
