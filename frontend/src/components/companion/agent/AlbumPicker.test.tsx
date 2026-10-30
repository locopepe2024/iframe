import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AlbumPicker from "./AlbumPicker";
const api=vi.hoisted(()=>({list:vi.fn()}));
const videos=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("@/lib/photoApi",()=>({photoApi:api}));
vi.mock("@/lib/companionMediaApi",()=>({companionMediaApi:videos}));
vi.mock("../photos/PhotoImage",()=>({default:({id}:{id:string})=><span>image {id}</span>}));
vi.mock("./VideoConversationCard",()=>({VideoCover:()=>null}));
beforeEach(()=>{vi.resetAllMocks();api.list.mockResolvedValue({photos:[{photo_id:"first"}],next_after_id:null});videos.list.mockResolvedValue({videos:[{video_id:"v",name:"garden.mp4"}],next_after_id:null});});
it("keeps inclusive range filters in search and does not describe empty matches as an empty library",async()=>{
 api.list.mockResolvedValue({photos:[],next_after_id:null});
 render(<AlbumPicker initialFrom="2026-10-20" initialTo="2026-10-30" onPhoto={()=>{}} onClose={()=>{}}/>);
 expect(await screen.findByText("没有找到符合这些条件的照片。")).toBeInTheDocument();
 expect(screen.getByText("拍摄日期：2026-10-20 至 2026-10-30")).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("搜索照片"),{target:{value:"女儿"}});
 fireEvent.click(screen.getByRole("button",{name:"搜索"}));
 await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith("all","","","女儿",{date_prefix:"",date_from:"2026-10-20",date_to:"2026-10-30",order:"id"}));
});
it("browses without attaching, searches server descriptions, paginates and only selects explicitly",async()=>{
  const select=vi.fn();render(<AlbumPicker onPhoto={select} onClose={()=>{}}/>);
  await screen.findByText("image first");expect(select).not.toHaveBeenCalled();
  api.list.mockResolvedValueOnce({photos:[{photo_id:"match",search_matches:[{excerpt:"女儿来看我"}]}],next_after_id:"cursor"}).mockResolvedValueOnce({photos:[{photo_id:"next"}],next_after_id:null});
  fireEvent.change(screen.getByLabelText("搜索照片"),{target:{value:"女儿"}});fireEvent.click(screen.getByRole("button",{name:"搜索"}));await screen.findByText("女儿来看我");
  expect(screen.queryByText("image first")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"更多照片"}));await screen.findByText("image next");
  expect(api.list).toHaveBeenLastCalledWith("all","","cursor","女儿");
  fireEvent.click(screen.getByRole("button",{name:/选择照片 2/}));expect(select).toHaveBeenCalledWith({photo_id:"next"});
});
it("can browse videos separately and close without choosing",async()=>{
  const select=vi.fn(),close=vi.fn();render(<AlbumPicker onPhoto={()=>{}} onVideo={select} onClose={close}/>);
  await screen.findByText("image first");fireEvent.click(screen.getByRole("button",{name:"视频"}));await screen.findByRole("button",{name:"选择视频：garden.mp4"});
  expect(videos.list).toHaveBeenCalledWith("","");expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"选择视频：garden.mp4"}));expect(select).toHaveBeenCalledWith({video_id:"v",name:"garden.mp4"});
  fireEvent.click(screen.getByRole("button",{name:"关闭相册"}));expect(close).toHaveBeenCalledOnce();
});

it("keeps icon controls accessible and clears a search back to all photos",async()=>{
  render(<AlbumPicker onPhoto={()=>{}} onClose={()=>{}}/>);
  await screen.findByText("image first");
  expect(screen.queryByText("关闭相册")).not.toBeInTheDocument();
  expect(screen.queryByText("搜索照片")).not.toBeInTheDocument();
  expect(screen.queryByText("选择照片 1")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"选择照片 1"})).toBeEnabled();
  fireEvent.change(screen.getByLabelText("搜索照片"),{target:{value:"女儿"}});
  fireEvent.submit(screen.getByRole("button",{name:"搜索"}).closest("form")!);
  await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith("all","","","女儿"));
  await waitFor(()=>expect(screen.getByRole("button",{name:"清除搜索"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"清除搜索"}));
  await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith("all","","",""));
  expect(screen.getByLabelText("搜索照片")).toHaveValue("");
});

it("opens as a dialog sheet and closes from Escape or the backdrop",async()=>{
  const close=vi.fn();render(<AlbumPicker onPhoto={()=>{}} onClose={close}/>);
  await screen.findByRole("dialog",{name:"浏览相册"});
  fireEvent.keyDown(window,{key:"Escape"});
  expect(close).toHaveBeenCalledOnce();
  fireEvent.mouseDown(screen.getByRole("presentation"));
  expect(close).toHaveBeenCalledTimes(2);
});
