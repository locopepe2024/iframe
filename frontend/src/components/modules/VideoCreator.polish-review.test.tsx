import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import VideoCreator from "./VideoCreator";
import { api } from "@/lib/api";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/store/projectStore", () => ({ useProjectStore: (selector: (state: any) => unknown) => selector({
    currentProject: { id: "project", characters: [], scenes: [], props: [], frames: [], video_tasks: [] },
    updateProject: vi.fn(),
}) }));
vi.mock("@/lib/api", () => ({ api: { polishVideoPrompt: vi.fn(), polishR2VPrompt: vi.fn() }, API_URL: "", VideoTask: {} }));
vi.mock("./PromptBuilder", () => ({ default: React.forwardRef<HTMLTextAreaElement, any>(({ segments, onChange }, ref) => <textarea ref={ref} aria-label="镜头提示词"
    value={segments.map((item: any) => item.value).join(" ")}
    onChange={(event) => onChange([{ type: "text", value: event.target.value, id: "test" }])} />) }));
vi.mock("./storyboard-r2v/OptimizerSelector", () => ({ default: () => null }));

const props = {
    onTaskCreated: vi.fn(), remixData: null, onRemixClear: vi.fn(),
    params: {} as any, onParamsChange: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

it("keeps legacy video polish behind editable preview and explicit confirmation", async () => {
    vi.mocked(api.polishVideoPrompt)
        .mockResolvedValueOnce({ messages: { system: "残阳染红街面", user: "长街" }, media: [],
            review_token: "review-token", format_note: "双语 JSON" } as any)
        .mockResolvedValueOnce({ prompt_cn: "中文结果", prompt_en: "English result" } as any);
    render(<VideoCreator {...props} />);
    fireEvent.change(screen.getByLabelText("镜头提示词"), { target: { value: "长街" } });
    fireEvent.click(screen.getByText("查看并确认润色输入"));
    await screen.findByText("提交前检查模型输入");
    expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("系统／任务文字"), { target: { value: "冷灰蓝环境光" } });
    fireEvent.click(screen.getByText("确认输入并润色"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[1][16]).toEqual({
        messages: { system: "冷灰蓝环境光", user: "长街" }, token: "review-token",
    });
    expect(await screen.findByText("English result")).toBeInTheDocument();
});

it("does not submit a preview after its prompt changes", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "", user: "长街" }, media: [],
        review_token: "review-token", format_note: "" } as any);
    render(<VideoCreator {...props} />);
    fireEvent.change(screen.getByLabelText("镜头提示词"), { target: { value: "长街" } });
    fireEvent.click(screen.getByText("查看并确认润色输入"));
    await screen.findByText("提交前检查模型输入");
    fireEvent.change(screen.getByLabelText("镜头提示词"), { target: { value: "另一条街" } });
    fireEvent.click(screen.getByText("确认输入并润色"));
    expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("请重新预览模型输入");
});

it("requires the same review for the independent R2V mode", async () => {
    vi.mocked(api.polishR2VPrompt)
        .mockResolvedValueOnce({ messages: { system: "角色说明", user: "角色入场" }, media: [],
            review_token: "r2v-token", format_note: "双语 JSON" } as any)
        .mockResolvedValueOnce({ prompt_cn: "中文", prompt_en: "English R2V" } as any);
    render(<VideoCreator {...props} params={{ generationMode: "r2v" } as any} />);
    fireEvent.change(screen.getByLabelText("镜头提示词"), { target: { value: "角色入场" } });
    fireEvent.click(screen.getByText("查看并确认润色输入"));
    await screen.findByText("提交前检查模型输入");
    expect(api.polishR2VPrompt).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("确认输入并润色"));
    await waitFor(() => expect(api.polishR2VPrompt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.polishR2VPrompt).mock.calls[1][16]).toMatchObject({ token: "r2v-token" });
    expect(await screen.findByText("English R2V")).toBeInTheDocument();
});
