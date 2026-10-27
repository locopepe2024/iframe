// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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

it("shows merged characters and series crowd groups in Cast", () => {
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
    expect(screen.getByText("流民匪寇")).toBeTruthy();
    expect(screen.getByText("青溪镇市井百姓")).toBeTruthy();
});
