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
    dialogueStructured: {
        speaker: "女主播",
        line: "今天这款穿心莲分散片，我们决定给大家随机立减！",
    },
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
            shot={{ ...shot, lightingOverride: "current unsaved light", stylePromptOverride: "current style" }}
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
            onSetVideoMode={vi.fn()}
            onOpenDrawer={vi.fn()}
            onInsertAsset={vi.fn()}
            expanded={false}
            onToggleExpanded={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByTitle("查看并确认模型输入"));

    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledOnce());
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][6]).toBe("uniart/minimax-h3-vip");
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][9]).toEqual({
        speaker: "女主播",
        line: "今天这款穿心莲分散片，我们决定给大家随机立减！",
    });
    expect(vi.mocked(api.polishVideoPrompt).mock.calls[0][14]).toEqual({ style: "current style", lighting: "current unsaved light" });
});

it("sends the selected first and last variants in order for FL2V polish", async () => {
    render(
        <ShotCard
            shot={{ ...shot, videoMode: "first_last_frame", t2iImageUrls: ["first-a", "first-b"], t2iSelectedIndex: 1,
                lastFrameImageUrls: ["last-a", "last-b"], lastFrameSelectedIndex: 1 }}
            videoModel="uniart/minimax-h3-vip"
            index={0} totalShots={1} characters={[]} scenes={[]} props={[]}
            onUpdatePrompt={vi.fn()} onUpdateField={vi.fn()} onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()}
            onDelete={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} onDuplicate={vi.fn()}
            onSetVideoMode={vi.fn()} onOpenDrawer={vi.fn()} onInsertAsset={vi.fn()}
            expanded={false} onToggleExpanded={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByTitle("查看并确认模型输入"));
    await waitFor(() => expect(api.polishVideoPrompt).toHaveBeenCalledOnce());
    const args = vi.mocked(api.polishVideoPrompt).mock.calls[0];
    expect(args[4]).toEqual(["first-b", "last-b"]);
    expect(args[15]).toBe("first_last_frame");
});

it("uses one four-mode tab control for video input selection", () => {
    const onSetVideoMode = vi.fn();
    render(
        <ShotCard
            shot={{ ...shot, videoMode: "first_last_frame" }}
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
            onSetVideoMode={onSetVideoMode}
            onOpenDrawer={vi.fn()}
            onInsertAsset={vi.fn()}
            expanded={false}
            onToggleExpanded={vi.fn()}
        />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "tabFirstLastFrame" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("combobox", { name: "视频生成模式" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "tabTextVideo" }));
    expect(onSetVideoMode).toHaveBeenCalledWith("t2v");
});

it("applies only the selected director field to the shot", () => {
    const onUpdateField = vi.fn();
    const onUpdatePrompt = vi.fn();
    render(<ShotCard
        shot={{ ...shot, cameraAngle: "平视", directorShotContext: { shot: {
            camera_angle: "低角度", camera_movement: "缓慢推进", performance_action: "前镜动作",
        } } }}
        index={0} totalShots={1} characters={[]} scenes={[]} props={[]}
        onUpdatePrompt={onUpdatePrompt} onUpdateField={onUpdateField}
        onGenerateT2I={vi.fn()} onGenerateVideo={vi.fn()} onDelete={vi.fn()}
        onMoveUp={vi.fn()} onMoveDown={vi.fn()} onDuplicate={vi.fn()}
        onSetVideoMode={vi.fn()} onOpenDrawer={vi.fn()} onInsertAsset={vi.fn()}
        expanded={false} onToggleExpanded={vi.fn()}
    />);
    fireEvent.click(screen.getByText(/拍摄计划字段/));
    fireEvent.click(screen.getByRole("button", { name: "采用机位" }));
    expect(onUpdateField).toHaveBeenCalledExactlyOnceWith("cameraAngle", "低角度");
    expect(onUpdatePrompt).not.toHaveBeenCalled();
});
