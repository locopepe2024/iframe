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

    fireEvent.click(screen.getByTitle("polish"));

    await waitFor(() => {
        expect(screen.getByText("模型调用失败：UniArt API Key 无效，请更新个人配置。")).toBeInTheDocument();
    });
});

it("sends assembled constraints before optimization", async () => {
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({ prompt_cn: "中文结果", prompt_en: "English result" } as any);
    render(<PolishPanel prompt="原始镜头" optimizationDraft="原始镜头；黄昏光影；远景" tabMode="t2i_i2v" scriptId="project-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByTitle("polish"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalled());
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][0]).toBe("原始镜头；黄昏光影；远景");
});

it("shows and applies current lighting when a polish response finishes after a field edit", async () => {
    let finish!: (value: any) => void;
    vi.mocked(api.polishVideoPrompt).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onApply = vi.fn();
    const { rerender } = render(<PolishPanel prompt="action" tabMode="t2i_i2v" scriptId="project" shotOverrides={{ style: "", lighting: "old light" }} onApply={onApply} />);
    fireEvent.click(screen.getByTitle("polish"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalled());
    rerender(<PolishPanel prompt="action" tabMode="t2i_i2v" scriptId="project" shotOverrides={{ style: "", lighting: "current light" }} onApply={onApply} />);
    finish({ prompt_cn: "detailed_description: old light; 中文动作\noverall_soundscape: N/A", prompt_en: "detailed_description: old light; action\noverall_soundscape: N/A" });
    await waitFor(() => expect(screen.getAllByText(/current light/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("polishApply")[0]);
    expect(onApply.mock.calls[0][0]).toContain("current light");
    expect(onApply.mock.calls[0][0]).not.toContain("old light");
});
