import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import ShotCard, { type ShotNode } from "./ShotCard";
import { api } from "@/lib/api";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: any) => unknown) => selector({ currentProject: { id: "project-1" } }),
}));
vi.mock("@/lib/api", () => ({
    api: {
        polishVideoPrompt: vi.fn(),
        polishR2VPrompt: vi.fn(),
    },
}));
vi.mock("./AssetChipBar", () => ({ default: () => null }));
vi.mock("./PromptExpandModal", () => ({ default: () => null }));
vi.mock("./FieldTagChip", () => ({
    default: () => null,
    AddFieldButton: () => null,
}));
vi.mock("@/components/shared/preview/PreviewImage", () => ({ default: () => null }));
vi.mock("@/components/shared/preview/PreviewVideo", () => ({ default: () => null }));
vi.mock("@/components/shared/PendingTaskAffordance", () => ({ PendingTaskAffordance: () => null }));
vi.mock("@/components/shared/BorderGlow/BorderGlow", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/shared/WorkflowActionButton", () => ({
    default: ({ children, leftIcon: _leftIcon, ...props }: any) => <button {...props}>{children}</button>,
}));

const shot: ShotNode = {
    id: "shot-1",
    prompt: "女主播举起产品并看向镜头",
    tabMode: "t2i_i2v",
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.polishVideoPrompt).mockResolvedValue({
        prompt_cn: "integrated_multimodal_description: 中文",
        prompt_en: "integrated_multimodal_description: English",
    });
});

it("sends the selected shot video model when polishing", async () => {
    render(
        <ShotCard
            shot={shot}
            videoModel="uniart/minimax-h3-vip"
            index={0}
            totalShots={1}
            characters={[]}
            scenes={[]}
            props={[]}
            onUpdatePrompt={vi.fn()}
            onUpdateField={vi.fn()}
            onGenerateT2I={vi.fn()}
            onGenerateVideo={vi.fn()}
            onDelete={vi.fn()}
            onMoveUp={vi.fn()}
            onMoveDown={vi.fn()}
            onDuplicate={vi.fn()}
            onSetTabMode={vi.fn()}
            onOpenDrawer={vi.fn()}
            onInsertAsset={vi.fn()}
            expanded={false}
            onToggleExpanded={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByTitle("polish"));

    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledOnce());
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][6]).toBe("uniart/minimax-h3-vip");
});
