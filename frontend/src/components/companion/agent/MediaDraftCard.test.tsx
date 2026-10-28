import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MediaDraftCard from "./MediaDraftCard";
import type { MediaDraft } from "@/lib/companionApi";
const api = vi.hoisted(()=>({models:vi.fn(),generate:vi.fn(),job:vi.fn(),media:vi.fn()}));
vi.mock("@/lib/companionServices",async importOriginal=>({...await importOriginal<typeof import("@/lib/companionServices")>(),companionServices:api}));
vi.mock("../photos/PhotoImage",()=>({default:()=> <img alt="参考照片"/>}));
const task:MediaDraft={kind:"media_draft",task_id:"creative",session_id:"session",revision:3,status:"active",step:"configuring",type:"image_edit",brief:"调亮，其他不变",photo_id:"mine",setting:"方形 1:1",spoken_text:"要求记下了。"};
beforeEach(()=>{vi.resetAllMocks();api.models.mockResolvedValue({models:[{id:"editor",display_name:"图片编辑",capabilities:["i2i"]},{id:"text",display_name:"文字生成",capabilities:["t2i"]}]});api.generate.mockResolvedValue({id:"job",status:"running"});});
it("waits for explicit paid confirmation and binds the current draft and photo",async()=>{
 const refresh=vi.fn();
 render(<MediaDraftCard task={task} disabled={false} onAction={vi.fn()} onUpload={()=>{}} onRefresh={refresh}/>);
 expect(api.generate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"读取我的可用模型"}));
 await screen.findByRole("option",{name:"图片编辑"});
 expect(screen.queryByRole("option",{name:"文字生成"})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole("combobox",{name:"生成模型"}),{target:{value:"editor"}});
 expect(api.generate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"确认生成（可能计费）"}));
 await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
 expect(api.generate).toHaveBeenCalledWith(expect.objectContaining({task_id:"creative",expected_revision:3,reference:"mine",prompt:"调亮，其他不变",model:"editor",allow_external_generation:true}));
 expect(screen.getByRole("button",{name:"换一张照片"})).toBeDisabled();
});
it("does not offer generation before a concrete editing brief",()=>{
 render(<MediaDraftCard task={{...task,brief:"",step:"awaiting_brief"}} disabled={false} onAction={vi.fn()} onUpload={()=>{}}/>);
 expect(screen.queryByRole("button",{name:"确认生成（可能计费）"})).not.toBeInTheDocument();
});
it("updates parameters through the versioned draft action",()=>{
 const action=vi.fn().mockResolvedValue(true);
 render(<MediaDraftCard task={task} disabled={false} onAction={action} onUpload={()=>{}}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"创作参数"}),{target:{value:"横向 16:9"}});
 expect(action).toHaveBeenCalledWith("setting","横向 16:9");
});
it("restores a submitted job without a second paid submission",()=>{
 render(<MediaDraftCard task={{...task,status:"submitted",step:"submitted",job_id:"existing"}} disabled={false} onAction={vi.fn()} onUpload={()=>{}}/>);
 expect(screen.getByRole("status")).toHaveTextContent("正在生成");
 expect(screen.queryByRole("button",{name:"确认生成（可能计费）"})).not.toBeInTheDocument();
 expect(api.generate).not.toHaveBeenCalled();
});

it("keeps an uncertain paid operation frozen and retries the same request",async()=>{
 api.generate.mockRejectedValueOnce(new Error("timeout"));
 render(<MediaDraftCard task={task} disabled={false} onAction={vi.fn()} onUpload={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"读取我的可用模型"}));
 await screen.findByRole("option",{name:"图片编辑"});
 fireEvent.change(screen.getByRole("combobox",{name:"生成模型"}),{target:{value:"editor"}});
 fireEvent.click(screen.getByRole("button",{name:"确认生成（可能计费）"}));
 await screen.findByRole("alert");
 expect(screen.getByRole("combobox",{name:"创作参数"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"查询或重试原生成请求"}));
 await waitFor(()=>expect(api.generate).toHaveBeenCalledTimes(2));
 expect(api.generate.mock.calls[0][0]).toEqual(api.generate.mock.calls[1][0]);
});
