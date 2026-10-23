import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import TodayPlanCards from "./TodayPlanCards";

it("labels sample plans, pages without automatic action and supports keyboard navigation",()=>{
  const photos=vi.fn(),diary=vi.fn();render(<TodayPlanCards disabled={false} onPhotos={photos} onDiary={diary}/>);
  expect(screen.getByText(/尚未读取您的真实安排/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"上一张计划"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"下一张计划"}));expect(screen.getByText("第 2 / 3 张")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("region",{name:"今日计划卡片"}),{key:"ArrowRight"});expect(screen.getByText("第 3 / 3 张")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"下一张计划"})).toBeDisabled();expect(photos).not.toHaveBeenCalled();expect(diary).not.toHaveBeenCalled();
});
it("opens a plan conversation and keeps all reminder actions explicitly simulated",()=>{
  render(<TodayPlanCards disabled={false} onPhotos={()=>{}} onDiary={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"看看安排"}));expect(screen.getByRole("region",{name:"计划对话"})).toBeInTheDocument();
  expect(screen.queryByRole("region",{name:"今日计划卡片"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"稍后提醒"}));expect(screen.getByRole("status")).toHaveTextContent("尚未创建真实提醒");
  fireEvent.click(screen.getByRole("button",{name:"今天跳过"}));expect(screen.getByRole("status")).toHaveTextContent("没有修改真实计划");
  fireEvent.click(screen.getByRole("button",{name:"返回今日计划"}));expect(screen.getByRole("region",{name:"今日计划卡片"})).toBeInTheDocument();
});
it("only invokes whitelisted photo and diary actions after an explicit second button",()=>{
  const photos=vi.fn(),diary=vi.fn();render(<TodayPlanCards disabled={false} onPhotos={photos} onDiary={diary}/>);
  fireEvent.click(screen.getByRole("button",{name:"一起看看"}));expect(photos).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"从相册选择照片"}));expect(photos).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button",{name:"返回今日计划"}));fireEvent.click(screen.getByRole("button",{name:"聊聊今天"}));expect(diary).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"开始记录"}));expect(diary).toHaveBeenCalledOnce();
});
it("disables task actions during an outstanding operation",()=>{
  const {rerender}=render(<TodayPlanCards disabled={false} onPhotos={()=>{}} onDiary={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"看看安排"}));rerender(<TodayPlanCards disabled onPhotos={()=>{}} onDiary={()=>{}}/>);
  expect(screen.getByRole("button",{name:"按原计划"})).toBeDisabled();expect(screen.getByRole("button",{name:"返回今日计划"})).toBeDisabled();
});
