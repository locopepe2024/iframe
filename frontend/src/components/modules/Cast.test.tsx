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

it("shows crowd performers as normal character cards in Cast", () => {
    useProjectStore.setState({
        currentProject: {
            id: "episode", title: "第一幕", series_id: "series",
            characters: [{ id: "suyan", name: "苏砚（雪痕客）", source: "series" },
                { id: "bandits", name: "流民匪寇" }],
            scenes: [], props: [], frames: [], crowd_group_candidates: [],
        } as any,
        currentSeries: {
            id: "series", title: "青溪镇",
            extra_roster: [],
        } as any,
        generatingTasks: [],
    });

    render(<NextIntlClientProvider locale="zh" messages={messages}><Cast /></NextIntlClientProvider>);

    expect(screen.getByText("苏砚（雪痕客）")).toBeTruthy();
    expect(screen.getByText("流民匪寇")).toBeTruthy();
    expect(screen.queryByText("背景群演")).toBeNull();
});


it("refreshes newly extracted crowd characters when the project response changes", async () => {
    useProjectStore.setState({
        currentProject: {
            id: "episode-refresh", title: "第一幕", series_id: "series",
            characters: [{ id: "crowd_001", name: "流民匪寇" }], scenes: [], props: [], frames: [],
            crowd_group_candidates: [],
        } as any,
        currentSeries: null,
        generatingTasks: [],
    });

    render(<NextIntlClientProvider locale="zh" messages={messages}><Cast /></NextIntlClientProvider>);
    expect(screen.queryByText("玄宸阁随行探子")).toBeNull();
    expect(screen.queryByText("往来江湖客")).toBeNull();

    await act(async () => {
        useProjectStore.getState().updateProject("episode-refresh", {
            characters: [{ id: "crowd_001", name: "流民匪寇" },
                { id: "crowd_003", name: "玄宸阁随行探子" },
                { id: "crowd_005", name: "往来江湖客" }],
        } as any);
    });

    expect(screen.getByText("玄宸阁随行探子")).toBeTruthy();
    expect(screen.getByText("往来江湖客")).toBeTruthy();
});
