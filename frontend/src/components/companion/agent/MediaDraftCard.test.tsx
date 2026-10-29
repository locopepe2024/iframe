import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MediaDraftCard from "./MediaDraftCard";
import type { MediaDraft } from "@/lib/companionApi";
const api = vi.hoisted(()=>({models:vi.fn(),generate:vi.fn(),job:vi.fn(),media:vi.fn()}));
vi.mock("@/lib/companionServices",async importOriginal=>({...await importOriginal<typeof import("@/lib/companionServices")>(),companionServices:api}));
vi.mock("../photos/PhotoImage",()=>({default:()=> <img alt="参考照片"/>}));
vi.mock("./AlbumPicker",()=>({default:({onPhoto,onClose}:{onPhoto:(photo:{photo_id:string})=>void;onClose:()=>void})=><section aria-label="任务选图"><button onClick={()=>onPhoto({photo_id:"selected"})}>选中测试照片</button><button onClick={onClose}>关闭选图</button></section>}));
const task:MediaDraft={kind:"media_draft",task_id:"creative",session_id:"session",revision:3,status:"active",step:"configuring",type:"image_edit",brief:"调亮，其他不变",photo_id:"mine",setting:"方形 1:1",spoken_text:"要求记下了。"};
const sourceTask:MediaDraft={...task,photo_id:null,brief:"",step:"awaiting_asset",ui_card:{protocol:"companion.ui.v1",component:"choice_card",card_id:"creative:3:source",task:{id:"creative",revision:3},status:"active",spoken_text:"选照片",props:{title:"想修改哪张照片？",options:[{id:"upload",label:"上传照片",action:"media.open_upload"},{id:"album",label:"从相册选择",action:"media.open_album"},{id:"back",label:"返回聊天",action:"media.pause"}]}}};
beforeEach(()=>{vi.resetAllMocks();api.models.mockResolvedValue({models:[{id:"editor",display_name:"图片编辑",capabilities:["i2i"]},{id:"text",display_name:"文字生成",capabilities:["t2i"]}]});api.generate.mockResolvedValue({id:"job",status:"running"});});
it("routes declarative choices through the server without opening local files on response",async()=>{
 const choose=vi.fn().mockResolvedValue(true),upload=vi.fn();
 const props={disabled:false,onAction:vi.fn(),onUpload:upload,onChooseSource:choose};
 const view=render(<MediaDraftCard {...props} task={sourceTask}/>);
 fireEvent.click(screen.getByRole("button",{name:"上传照片"}));
 await waitFor(()=>expect(choose).toHaveBeenCalledWith(expect.objectContaining({card_id:"creative:3:source",option_id:"upload"})));
 expect(upload).toHaveBeenCalledOnce();
 view.rerender(<MediaDraftCard {...props} task={{...sourceTask,ui_action:"open_upload",ui_event_id:"upload"}}/>);
 expect(upload).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole("button",{name:"重新选择上传照片"}));
 expect(upload).toHaveBeenCalledTimes(2);
});
it("does not reopen a dismissed album when the same navigation receipt rerenders",async()=>{
 const props={disabled:false,onAction:vi.fn(),onUpload:vi.fn(),onChooseSource:vi.fn()};
 const opened={...sourceTask,ui_action:"open_album" as const,ui_event_id:"album-1"};
 const view=render(<MediaDraftCard {...props} task={opened}/>);
 fireEvent.click(await screen.findByRole("button",{name:"关闭选图"}));
 view.rerender(<MediaDraftCard {...props} task={{...opened}}/>);
 expect(screen.queryByRole("region",{name:"任务选图"})).not.toBeInTheDocument();
 view.rerender(<MediaDraftCard {...props} task={{...opened,ui_event_id:"album-2"}}/>);
 expect(await screen.findByRole("region",{name:"任务选图"})).toBeInTheDocument();
});
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
it("opens a model-requested album in the current task and binds the selected photo",async()=>{
 const action=vi.fn().mockResolvedValue(true); const event=vi.fn().mockResolvedValue(true);
 render(<MediaDraftCard task={{...sourceTask,ui_action:"open_album"}} disabled={false} onAction={action} onAssetSelected={event} onUpload={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:"选中测试照片"}));
 await waitFor(()=>expect(event).toHaveBeenCalledWith("selected","source","creative:3:source"));
 await waitFor(()=>expect(screen.queryByRole("region",{name:"任务选图"})).not.toBeInTheDocument());
 expect(api.generate).not.toHaveBeenCalled();
});
it("shows upload as a user action instead of silently opening local files",()=>{
 const upload=vi.fn();
 render(<MediaDraftCard task={{...task,photo_id:null,brief:"",step:"awaiting_asset",ui_action:"open_upload"}} disabled={false} onAction={vi.fn()} onUpload={upload}/>);
 expect(upload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"上传照片"}));
 expect(upload).toHaveBeenCalledOnce();
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

it("filters video models by the selected reference mode",async()=>{
 api.models.mockResolvedValue({models:[{id:"h3-f2v",display_name:"首尾帧",capabilities:["f2v"]},{id:"h3-t2v",display_name:"文字生成",capabilities:["t2v"]}]});
 const video:MediaDraft={kind:"media_draft",task_id:"video",session_id:"session",revision:4,status:"active",step:"configuring",type:"video_generate",brief:"从白天到夜晚",photo_id:null,first_photo_id:"first",last_photo_id:"last",reference_photo_ids:[],video_mode:"f2v",setting:"5 秒",spoken_text:"要求记下了。"};
 render(<MediaDraftCard task={video} disabled={false} onAction={vi.fn()} onUpload={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"读取我的可用模型"}));
 await screen.findByRole("option",{name:"首尾帧"});
 expect(within(screen.getByRole("combobox",{name:"生成模型"})).queryByRole("option",{name:"文字生成"})).not.toBeInTheDocument();
});

it("reports expired selection cards without calling the legacy action",async()=>{
 const action=vi.fn(),event=vi.fn();
 render(<MediaDraftCard task={task} disabled={false} onAction={action} onAssetSelected={event} onUpload={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"换一张照片"}));
 fireEvent.click(await screen.findByRole("button",{name:"选中测试照片"}));
 expect(screen.getByRole("alert")).toHaveTextContent("选图卡片已失效");
 expect(action).not.toHaveBeenCalled();expect(event).not.toHaveBeenCalled();
});
it.each(["first_frame","last_frame"] as const)("replaces the requested %s with its own current card",async slot=>{
 const event=vi.fn().mockResolvedValue(true);
 render(<MediaDraftCard task={{...task,type:"video_generate",video_mode:"f2v",first_photo_id:"first",last_photo_id:"last",selection_cards:{first_frame:"creative:3:first_frame",last_frame:"creative:3:last_frame"}}} disabled={false} onAction={vi.fn()} onAssetSelected={event} onUpload={()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:slot==="first_frame"?"更换首帧":"更换尾帧"}));
 fireEvent.click(await screen.findByRole("button",{name:"选中测试照片"}));
 await waitFor(()=>expect(event).toHaveBeenCalledWith("selected",slot,`creative:3:${slot}`));
});
