import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AgentChat from "./AgentChat";
const api=vi.hoisted(()=>({session:vi.fn(),messages:vi.fn(),chat:vi.fn(),turn:vi.fn(),tool:vi.fn(),confirm:vi.fn(),cancel:vi.fn()}));
const photoApi=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("@/lib/companionApi",()=>({companionApi:api}));
vi.mock("@/lib/photoApi",()=>({photoApi}));
vi.mock("../PhotoConversationCard",()=>({default: ({label,onOpen}:{label:string;onOpen:()=>void})=><button onClick={onOpen}>{label}</button>}));
const preview={status:"pending_confirmation",preview_token:"token",action:"save",preview:{content:"喜欢散步",quote:"喜欢散步",source_text:"请记住我喜欢散步",source_message_id:"m",type:"preference",importance:3}};
beforeEach(()=>{
  localStorage.clear();vi.resetAllMocks();photoApi.list.mockResolvedValue({photos:[]});api.session.mockResolvedValue({session_id:"s"});api.messages.mockResolvedValue({messages:[],next_after:null});
  api.chat.mockResolvedValue({turn_id:"t",status:"completed",result:{kind:"confirmation",...preview}});
  api.confirm.mockResolvedValue({action:"save",memory_id:"memory"});api.cancel.mockResolvedValue({status:"preview_closed"});
});
async function start(){
  render(<AgentChat/>);await waitFor(()=>expect(screen.getByRole("button",{name:"新建会话"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"新建会话"}));await screen.findByText(/已打开新会话/);
  fireEvent.change(screen.getByLabelText("和我聊聊天"),{target:{value:"请记住我喜欢散步"}});
}
it("offers large guided cards without sending automatically",async()=>{
  await start();
  fireEvent.click(screen.getByRole("button",{name:/聊聊今天/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("聊聊今天发生的事情");
  expect(api.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/整理今天的回忆/}));
  expect(screen.getByLabelText("和我聊聊天")).toHaveValue("请把我们今天聊的内容整理成一篇回忆日记");
});
it("loads recent photos into the conversation card stream on demand",async()=>{
  await start();
  photoApi.list.mockResolvedValue({photos:[{photo_id:"photo-1",batch_id:"batch",date:{date:null,status:"pending_confirmation",reason:"missing",source:"none",revision:0}}]});
  fireEvent.click(screen.getByRole("button",{name:"看看最近照片"}));
  await screen.findByRole("button",{name:"最近照片 1"});
  expect(photoApi.list).toHaveBeenCalledWith("all","","","");
});
it("requires external text consent and final explicit button before saving",async()=>{
  await start();expect(screen.getByRole("button",{name:"发送给陪伴助手"})).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送给陪伴助手"}));
  await screen.findByRole("region",{name:"记忆操作确认"});expect(api.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"新建会话"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"确认保存记忆"}));await screen.findByText("个人记忆已保存。");
  expect(api.confirm).toHaveBeenCalledOnce();expect(api.chat.mock.calls[0][1].allow_external_text).toBe(true);
});
it("cancels without saving and edits through a new preview",async()=>{
  await start();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送给陪伴助手"}));
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
  await start();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"发送给陪伴助手"}));
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));
  await screen.findByRole("region",{name:"记忆操作确认"});expect(api.chat.mock.calls[0]).toEqual(api.chat.mock.calls[1]);
  fireEvent.click(screen.getByRole("button",{name:"取消，不执行"}));await screen.findByText(/已关闭预览/);
  api.tool.mockResolvedValueOnce({memories:[{id:"one",content:"第一条",quote:"原话"}],next_cursor:"next"})
    .mockResolvedValueOnce({memories:[{id:"two",content:"第二条",quote:"原话"}],next_cursor:null})
    .mockResolvedValueOnce({...preview,action:"delete",preview:{memory:{id:"two",content:"第二条",quote:"原话"}}});
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
  await waitFor(()=>expect(screen.getByRole("button",{name:"更多历史原话"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"更多历史原话"}));await screen.findByText("下一页");
  expect(api.messages).toHaveBeenLastCalledWith("s",1);expect(screen.queryByRole("region",{name:"记忆操作确认"})).not.toBeInTheDocument();
});
