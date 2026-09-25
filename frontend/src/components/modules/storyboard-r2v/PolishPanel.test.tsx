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
