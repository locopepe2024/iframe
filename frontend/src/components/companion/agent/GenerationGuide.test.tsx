import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import GenerationGuide, { createGenerationDraft, type GenerationDraft } from "./GenerationGuide";
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("../photos/PhotoImage", () => ({ default: ({id}:{id:string}) => <img alt={`照片 ${id}`} /> }));
beforeEach(()=>{ vi.resetAllMocks(); api.list.mockResolvedValue({ photos: [{photo_id:"first"},{photo_id:"second"}] }); });
function Harness(){
  const [value,setValue]=useState<GenerationDraft>(createGenerationDraft("video","花朵开放"));
  return <><GenerationGuide value={value} disabled={false} onChange={setValue} onEdit={()=>{}} onCancel={()=>{}} /><output aria-label="reference id">{value.reference}</output></>;
}
it("loads album on demand, binds the selected photo ID and preserves it through recommended settings",async()=>{
  render(<Harness/>); expect(api.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"从相册添加"}));
  await screen.findByRole("button",{name:/选择照片 2/});
  fireEvent.click(screen.getByRole("button",{name:/选择照片 2/}));
  expect(screen.getByLabelText("reference id")).toHaveTextContent("second");
  expect(screen.getByAltText("照片 second")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"用推荐设置"}));
  fireEvent.click(screen.getByRole("button",{name:"返回修改"}));
  fireEvent.click(screen.getByRole("button",{name:"返回修改"}));
  expect(screen.getByRole("button",{name:/选择照片 2/})).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByRole("button",{name:"用推荐设置"}));
  fireEvent.click(screen.getByRole("button",{name:"确认设置"}));
  expect(screen.getByLabelText("reference id")).toHaveTextContent("second");
  expect(screen.getByText("已确认本次设置，尚未开始生成。")).toBeInTheDocument();
  expect(api.list).toHaveBeenCalledOnce();
});
it("lets an album read failure retry without clearing the description",async()=>{
  api.list.mockRejectedValueOnce(new Error("offline"));render(<Harness/>);
  fireEvent.click(screen.getByRole("button",{name:"从相册添加"}));await screen.findByRole("alert");
  await waitFor(()=>expect(screen.getByRole("button",{name:"从相册添加"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"从相册添加"}));await screen.findByRole("button",{name:/选择照片 1/});
  expect(screen.getByText("花朵开放")).toBeInTheDocument();
});
