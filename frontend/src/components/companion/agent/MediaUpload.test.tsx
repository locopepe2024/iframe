import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MediaUpload from "./MediaUpload";
const photo=vi.hoisted(()=>({upload:vi.fn()}));const video=vi.hoisted(()=>({upload:vi.fn()}));
vi.mock("@/lib/photoApi",()=>({photoApi:photo}));vi.mock("@/lib/companionMediaApi",()=>({companionMediaApi:video}));
beforeEach(()=>{vi.resetAllMocks();photo.upload.mockResolvedValue({photo_id:"p"});video.upload.mockResolvedValue({video_id:"v"});});
it("shows a local thumbnail before the file is uploaded",()=>{
  vi.stubGlobal("URL",{...URL,createObjectURL:vi.fn(()=>"blob:preview"),revokeObjectURL:vi.fn()});
  render(<MediaUpload files={[new File(["photo"],"images (16).jpeg",{type:"image/jpeg"})]} disabled={false} onUploaded={()=>{}} onClose={()=>{}}/>);
  expect(screen.getByAltText("images (16).jpeg 缩略图")).toBeInTheDocument();
});
it("uploads only after confirmation and retries the failed file with its original operation ID",async()=>{
  video.upload.mockRejectedValueOnce(new Error("网络中断"));const done=vi.fn();
  render(<MediaUpload files={[new File(["photo"],"one.png",{type:"image/png"}),new File(["video"],"two.mp4",{type:"video/mp4"})]} disabled={false} onUploaded={done} onClose={()=>{}}/>);
  expect(photo.upload).not.toHaveBeenCalled();expect(video.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"确认上传"}));await screen.findByText("网络中断");
  await waitFor(()=>expect(screen.getByRole("button",{name:"重试未完成的上传"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"重试未完成的上传"}));await screen.findByRole("button",{name:"完成"});
  expect(photo.upload).toHaveBeenCalledOnce();expect(video.upload.mock.calls[0]).toEqual(video.upload.mock.calls[1]);
  expect(done.mock.calls).toEqual([[{kind:"photo",id:"p",name:"one.png"}],[{kind:"video",id:"v",name:"two.mp4"}]]);
});
it("closing a selection makes no upload or analysis request",()=>{
  const close=vi.fn();render(<MediaUpload files={[new File(["p"],"p.png")]} disabled={false} onUploaded={()=>{}} onClose={close}/>);
  fireEvent.click(screen.getByRole("button",{name:"关闭上传"}));expect(close).toHaveBeenCalledOnce();expect(photo.upload).not.toHaveBeenCalled();expect(video.upload).not.toHaveBeenCalled();
});
