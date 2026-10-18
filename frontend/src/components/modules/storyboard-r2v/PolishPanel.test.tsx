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
