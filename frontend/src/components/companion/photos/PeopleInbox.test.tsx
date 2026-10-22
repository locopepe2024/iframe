import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PeopleInbox from "./PeopleInbox";
const api=vi.hoisted(()=>({pendingPeopleReviews:vi.fn()}));
const candidates=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/photoApi",()=>({photoApi:api}));
vi.mock("./PeopleCandidates",()=>({default:(props:{taskId:string;version:number;onReviewed:()=>Promise<void>})=>{
  candidates(props); return <div><p>当前核对任务 {props.taskId}</p><button onClick={()=>void props.onReviewed()}>模拟完成明确核对</button></div>;
}}));
const first={task_id:"first",batch_id:"batch",consent_version:3,pending_groups:2,deferred_groups:1,photo_count:4};
beforeEach(()=>{vi.resetAllMocks();api.pendingPeopleReviews.mockResolvedValue({reviews:[first],next_after_id:null});});
it("loads only on request, opens one scoped task and returns without writes",async()=>{
  render(<PeopleInbox/>);expect(api.pendingPeopleReviews).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"查看人物待确认"}));
  fireEvent.click(await screen.findByRole("button",{name:"核对第 1 次人物建议：待确认 2 组，以后再说 1 组，涉及 4 张照片"}));
  expect(candidates).toHaveBeenLastCalledWith(expect.objectContaining({taskId:"first",version:3}));
  expect(screen.queryByRole("button",{name:"查看人物待确认"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"返回人物待确认列表"}));
  expect(screen.queryByText("当前核对任务 first")).not.toBeInTheDocument();
  expect(api.pendingPeopleReviews).toHaveBeenCalledTimes(1);
});
it("pages then refreshes from the first page after review",async()=>{
  api.pendingPeopleReviews.mockResolvedValueOnce({reviews:[first],next_after_id:"first"})
    .mockResolvedValueOnce({reviews:[{...first,task_id:"second"}],next_after_id:null})
    .mockResolvedValueOnce({reviews:[],next_after_id:null});
  render(<PeopleInbox/>);fireEvent.click(screen.getByRole("button",{name:"查看人物待确认"}));
  fireEvent.click(await screen.findByRole("button",{name:"更多待确认人物"}));
  fireEvent.click(await screen.findByRole("button",{name:/核对第 2 次人物建议/}));
  fireEvent.click(screen.getByRole("button",{name:"模拟完成明确核对"}));
  await screen.findByText(/当前有效授权下没有待确认的人物建议/);
  expect(api.pendingPeopleReviews.mock.calls.map(call=>call[0])).toEqual(["","first",""]);
});
it("shows retryable read failure without inventing empty results",async()=>{
  api.pendingPeopleReviews.mockRejectedValueOnce(new Error("暂时无法读取"));render(<PeopleInbox/>);
  fireEvent.click(screen.getByRole("button",{name:"查看人物待确认"}));await screen.findByRole("alert");
  expect(screen.queryByText(/当前有效授权下没有待确认/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"查看人物待确认"}));
  await screen.findByRole("button",{name:/核对第 1 次人物建议/});
});
