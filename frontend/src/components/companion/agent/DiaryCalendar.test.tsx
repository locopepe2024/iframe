import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import DiaryCalendar from "./DiaryCalendar";
import DiaryCard,{today} from "./DiaryCard";
const api=vi.hoisted(()=>({diaries:vi.fn(),saveDiary:vi.fn()}));
vi.mock("@/lib/companionApi",()=>({companionApi:api}));
beforeEach(()=>{vi.resetAllMocks();api.diaries.mockResolvedValue({diaries:[]});});
it("defaults to today, marks only saved days and browses a different month",async()=>{
  const day=today(),saved={day,text:"和女儿一起喝茶。",source_turn_id:"turn",revision:1,updated_at:1};
  api.diaries.mockResolvedValueOnce({diaries:[saved]}).mockResolvedValue({diaries:[]});
  const create=vi.fn();render(<DiaryCalendar onClose={()=>{}} onCreate={create}/>);
  expect(await screen.findByRole("button",{name:day+"，已有日记"})).toHaveAttribute("aria-pressed","true");
  expect(screen.getByText("和女儿一起喝茶。")).toBeInTheDocument();
  const markedDay = screen.getByRole("button",{name:day+"，已有日记"});
  expect(within(markedDay).getByText("✅")).toHaveClass(/calendarDayMark/);
  fireEvent.change(screen.getByLabelText("选择年月"),{target:{value:"2025-02"}});
  fireEvent.click(await screen.findByRole("button",{name:"2025-02-14"}));
  fireEvent.click(await screen.findByRole("button",{name:"整理这一天的日记"}));
  expect(create).toHaveBeenCalledWith("2025-02-14");
  expect(screen.queryByRole("button",{name:/2025-02-29/})).not.toBeInTheDocument();
  expect(api.diaries).toHaveBeenLastCalledWith("2025-02");
});
it("edits explicitly, preserves failed content and retries the same save without auto saving",async()=>{
  const saved=vi.fn();api.saveDiary.mockRejectedValueOnce(new Error("网络断开")).mockResolvedValueOnce({day:"2026-10-23",text:"一起喝茶",source_turn_id:"turn",revision:1});
  render(<DiaryCard day="2026-10-23" text="原始日记" sourceTurn="turn" onSaved={saved}
    context={[{id:"m1",role:"user",text:"女儿今天来看我了。"},{id:"m1-reply",role:"assistant",text:"听起来今天很开心。"}]}
    media={[{id:"p1",kind:"photo",name:"客厅照片"}]}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"继续写日记"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"继续写日记"}));
  expect(screen.getByRole("dialog",{name:"日记编辑器"})).toBeInTheDocument();
  expect(screen.getByText("女儿今天来看我了。")).toBeInTheDocument();
  expect(screen.getByText("照片 · 客厅照片")).toBeInTheDocument();
  expect(screen.getByText(/不会发送给聊天助手/)).toBeInTheDocument();
  expect(screen.getByRole("region",{name:"日记编辑工作域"})).toHaveAttribute("data-diary-editor", "true");
  fireEvent.change(screen.getByLabelText("日记内容"),{target:{value:"取消的内容"}});
  fireEvent.click(screen.getByRole("button",{name:"取消编辑"}));expect(api.saveDiary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"继续写日记"}));
  fireEvent.change(screen.getByLabelText("日记内容"),{target:{value:"一起喝茶"}});
  fireEvent.click(within(screen.getByRole("dialog",{name:"日记编辑器"})).getByRole("button",{name:"保存日记"}));
  await screen.findByText("网络断开");expect(screen.getByLabelText("日记内容")).toHaveValue("一起喝茶");
  fireEvent.click(within(screen.getByRole("dialog",{name:"日记编辑器"})).getByRole("button",{name:"保存日记"}));
  await screen.findByRole("article",{name:"已保存日记"});
  expect(api.saveDiary.mock.calls[0]).toEqual(api.saveDiary.mock.calls[1]);expect(saved).toHaveBeenCalledOnce();
});
it("saves unedited text only with the explicit button and restores saved content on remount",async()=>{
  const entry={day:today(),text:"今天的日记",source_turn_id:"t",revision:1};api.saveDiary.mockResolvedValue(entry);
  const view=render(<DiaryCard day={today()} text="今天的日记" sourceTurn="t"/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"保存日记"})).toBeEnabled());
  expect(api.saveDiary).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"保存日记"}));
  await screen.findByRole("article",{name:"已保存日记"});view.unmount();api.diaries.mockResolvedValue({diaries:[entry]});
  render(<DiaryCard day={today()} text="今天的日记" sourceTurn="t"/>);
  await screen.findByRole("article",{name:"已保存日记"});expect(screen.queryByRole("button",{name:"保存日记"})).not.toBeInTheDocument();
});
