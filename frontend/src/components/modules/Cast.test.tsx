// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "../../../messages/zh.json";
import Cast from "./Cast";
import { useProjectStore } from "@/store/projectStore";

vi.mock("@/components/shared/preview/LightboxProvider", () => ({ useLightbox: () => ({ open: vi.fn() }) }));
vi.mock("@/components/shared/preview/PreviewImage", () => ({ default: () => null }));
vi.mock("./cast/VoicePickerModal", () => ({ default: () => null }));
vi.mock("./cast/CastWorkbenchModal", () => ({ default: () => null, activePolls: new Map() }));
vi.mock("./cast/CharacterWorkbenchBridge", () => ({ default: () => null }));

afterEach(() => cleanup());

it("renders regular character cards without a separate crowd panel", () => {
    useProjectStore.setState({
        currentProject: {
            id: "episode", title: "第一幕", series_id: "series",
            characters: [{ id: "suyan", name: "苏砚（雪痕客）", source: "series" }],
            scenes: [], props: [], frames: [], crowd_group_candidates: [],
        } as any,
        currentSeries: {
            id: "series", title: "青溪镇",
            extra_roster: [
                { extra_id: "bandits", label: "流民匪寇", kind: "extra_template" },
                { extra_id: "townspeople", label: "青溪镇市井百姓", kind: "extra_template" },
            ],
        } as any,
        generatingTasks: [],
    });

    render(<NextIntlClientProvider locale="zh" messages={messages}><Cast /></NextIntlClientProvider>);

    expect(screen.getByText("苏砚（雪痕客）")).toBeTruthy();
    expect(screen.queryByText("流民匪寇")).toBeNull();
    expect(screen.queryByText("青溪镇市井百姓")).toBeNull();
    expect(screen.queryByRole("dialog", { name: /群演/ })).toBeNull();
});


it("does not surface legacy crowd roster entries as standalone cards", async () => {
    useProjectStore.setState({
        currentProject: {
            id: "episode-refresh", title: "第一幕", series_id: "series",
            characters: [], scenes: [], props: [], frames: [],
            crowd_groups: [
                { extra_id: "crowd_001", label: "流民匪寇", kind: "extra_template" },
                { extra_id: "crowd_002", label: "江湖打手", kind: "extra_template" },
                { extra_id: "crowd_004", label: "青溪镇市井百姓", kind: "extra_template" },
            ],
            crowd_group_candidates: [],
        } as any,
        currentSeries: null,
        generatingTasks: [],
    });

    render(<NextIntlClientProvider locale="zh" messages={messages}><Cast /></NextIntlClientProvider>);
    expect(screen.queryByText("流民匪寇")).toBeNull();
    expect(screen.queryByText("江湖打手")).toBeNull();

    await act(async () => {
        useProjectStore.getState().updateProject("episode-refresh", {
            crowd_groups: [
                { extra_id: "crowd_001", label: "流民匪寇", kind: "extra_template" },
                { extra_id: "crowd_002", label: "江湖打手", kind: "extra_template" },
                { extra_id: "crowd_003", label: "玄宸阁随行探子", kind: "extra_template" },
                { extra_id: "crowd_004", label: "青溪镇市井百姓", kind: "extra_template" },
                { extra_id: "crowd_005", label: "往来江湖客", kind: "extra_template" },
            ],
        } as any);
    });

    expect(screen.queryByText("玄宸阁随行探子")).toBeNull();
    expect(screen.queryByText("往来江湖客")).toBeNull();
});
