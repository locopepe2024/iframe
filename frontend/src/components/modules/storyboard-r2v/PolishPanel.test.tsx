import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import PolishPanel from "./PolishPanel";
import { api } from "@/lib/api";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({
    api: {
        polishVideoPrompt: vi.fn(),
        polishR2VPrompt: vi.fn(),
    },
}));
vi.mock("@/components/shared/BorderGlow/BorderGlow", () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/WorkflowActionButton", () => ({
    default: ({ children, leftIcon: _leftIcon, ...props }: any) => <button {...props}>{children}</button>,
}));

beforeEach(() => vi.clearAllMocks());

it("shows the provider diagnostic returned by the backend", async () => {
    vi.mocked(api.polishVideoPrompt).mockRejectedValue({
        response: {
            data: {
                detail: {
                    reason: "api_error",
                    message_zh: "模型调用失败：UniArt API Key 无效，请更新个人配置。",
                    message_en: "Model call failed: invalid UniArt API key.",
                },
            },
        },
    });

    render(
        <PolishPanel
            prompt="女主播展示药盒"
            tabMode="t2i_i2v"
            scriptId="project-1"
            onApply={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByTitle("查看并确认模型输入"));

    await waitFor(() => {
        expect(screen.getByText("模型调用失败：UniArt API Key 无效，请更新个人配置。")).toBeInTheDocument();
    });
});

it("shows editable compiled input and waits for confirmation before optimization", async () => {
    vi.mocked(api.polishVideoPrompt)
        .mockResolvedValueOnce({ messages: { system: "残阳如血", user: "原始镜头；黄昏光影；远景" }, media: [], review_token: "token", format_note: "格式要求" } as any)
        .mockResolvedValueOnce({ prompt_cn: "中文结果", prompt_en: "English result" } as any);
    render(<PolishPanel prompt="原始镜头" optimizationDraft="原始镜头；黄昏光影；远景" tabMode="t2i_i2v" scriptId="project-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await screen.findByText("提交前检查模型输入");
    expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("系统／任务文字"), { target: { value: "冷灰蓝环境光" } });
    fireEvent.click(screen.getByText("确认输入并润色"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[1][16]).toEqual({
        messages: { system: "冷灰蓝环境光", user: "原始镜头；黄昏光影；远景" }, token: "token",
    });
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][0]).toBe("原始镜头；黄昏光影；远景");
});

it("flushes pending shot edits before compiling model input", async () => {
    const sequence: string[] = [];
    vi.mocked(api.polishVideoPrompt).mockImplementation(async () => {
        sequence.push("preview");
        return { messages: { system: "current", user: "shot" }, media: [], review_token: "token", format_note: "" } as any;
    });
    render(<PolishPanel prompt="镜头" tabMode="t2i_i2v" scriptId="project"
        onBeforePreview={async () => { sequence.push("flush"); }} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await screen.findByText("提交前检查模型输入");
    expect(sequence).toEqual(["flush", "preview"]);
});

it("rejects confirmation after the shot lighting changes", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "old light", user: "action" }, media: [], review_token: "token", format_note: "" } as any);
    const { rerender } = render(<PolishPanel prompt="action" tabMode="t2i_i2v" scriptId="project" shotOverrides={{ style: "", lighting: "old light" }} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await screen.findByText("提交前检查模型输入");
    rerender(<PolishPanel prompt="action" tabMode="t2i_i2v" scriptId="project" shotOverrides={{ style: "", lighting: "current light" }} onApply={vi.fn()} />);
    fireEvent.click(screen.getByText("确认输入并润色"));
    expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("镜头或素材已变化，请重新查看模型输入。")).toBeInTheDocument();
});

it("switches the default skill when the target video model changes", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "system", user: "shot" }, media: [], review_token: "token", format_note: "" } as any);
    const props = { prompt: "镜头", tabMode: "t2i_i2v" as const, scriptId: "project", onApply: vi.fn() };
    const { rerender } = render(<PolishPanel {...props} videoModel="uniart/minimax-h3-vip" />);
    expect(screen.getByText("当前镜头目标模型：", { exact: false })).toHaveTextContent("MiniMax");
    expect(screen.getByLabelText("MiniMax H3 导演")).toBeChecked();
    expect(screen.queryByLabelText("Seedance 提示词")).not.toBeInTheDocument();

    rerender(<PolishPanel {...props} videoModel="uniart/seedance-2.5-vip" />);
    await waitFor(() => expect(screen.getByLabelText("Seedance 提示词")).toBeChecked());
    expect(screen.queryByLabelText("MiniMax H3 导演")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1));
    expect(screen.getByText("当前镜头目标模型：", { exact: false })).toHaveTextContent("Seedance");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][10]).toBe("qwen");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][11]).toEqual(["seedance-prompt"]);
    expect(screen.queryByRole("option", { name: "MiniMax 官方 IR" })).not.toBeInTheDocument();
});

it("submits the H3 model and its matching skill for preview", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "H3 contract", user: "shot" }, media: [], review_token: "token", format_note: "" } as any);
    render(<PolishPanel prompt="镜头" videoModel="uniart/minimax-h3-vip" tabMode="t2i_i2v" scriptId="project" onApply={vi.fn()} />);
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await screen.findByText("提交前检查模型输入");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][6]).toBe("uniart/minimax-h3-vip");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][11]).toEqual(["minimax-h3-director"]);
    expect(screen.getByText("当前镜头目标模型：", { exact: false })).toHaveTextContent("MiniMax");
});

it("closes a stale preview when the shot target model changes", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "Seedance contract", user: "shot" }, media: [], review_token: "token", format_note: "" } as any);
    const props = { prompt: "镜头", tabMode: "t2i_i2v" as const, scriptId: "project", onApply: vi.fn() };
    const { rerender } = render(<PolishPanel {...props} videoModel="uniart/seedance-2.5-vip" />);
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await screen.findByText("提交前检查模型输入");
    rerender(<PolishPanel {...props} videoModel="uniart/minimax-h3-vip" />);
    await waitFor(() => expect(screen.queryByText("提交前检查模型输入")).not.toBeInTheDocument());
    expect(screen.getByLabelText("MiniMax H3 导演")).toBeChecked();
    expect(screen.getByText("当前镜头目标模型：", { exact: false })).toHaveTextContent("MiniMax");
});

it("hides optional skills and submits none with the official IR optimizer", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ messages: { system: "", user: "shot" }, media: [], review_token: "token", format_note: "" } as any);
    render(<PolishPanel prompt="镜头" videoModel="uniart/minimax-h3-vip" tabMode="t2i_i2v" scriptId="project" onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("选择提示词优化器"), { target: { value: "minimax_context_ir" } });
    expect(screen.queryByLabelText("MiniMax H3 导演")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][10]).toBe("minimax_context_ir");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][11]).toEqual([]);
});

it("leaves the H3-only IR optimizer when switching to Seedance", async () => {
    const props = { prompt: "镜头", tabMode: "t2i_i2v" as const, scriptId: "project", onApply: vi.fn() };
    const { rerender } = render(<PolishPanel {...props} videoModel="uniart/minimax-h3-vip" />);
    fireEvent.change(screen.getByLabelText("选择提示词优化器"), { target: { value: "minimax_context_ir" } });
    rerender(<PolishPanel {...props} videoModel="uniart/seedance-2.5-vip" />);
    await waitFor(() => expect(screen.getByLabelText("选择提示词优化器")).toHaveValue("qwen"));
    expect(screen.getByLabelText("Seedance 提示词")).toBeChecked();
});
