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
  await screen.findByText("image first");fireEvent.click(screen.getByRole("button",{name:"视频"}));await screen.findByText("选择视频：garden.mp4");
  expect(videos.list).toHaveBeenCalledWith("","");expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"选择视频：garden.mp4"}));expect(select).toHaveBeenCalledWith({video_id:"v",name:"garden.mp4"});
  fireEvent.click(screen.getByRole("button",{name:"关闭相册"}));expect(close).toHaveBeenCalledOnce();
});
