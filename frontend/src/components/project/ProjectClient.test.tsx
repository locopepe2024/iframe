import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import ProjectClient from "./ProjectClient";

const mocks = vi.hoisted(() => ({ getSeries: vi.fn(), selectProject: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/api", () => ({ api: { getSeries: mocks.getSeries } }));
vi.mock("@/components/layout/PipelineSidebar", () => ({ default: ({ steps, onStepChange }: any) =>
    <nav aria-label="Pipeline">{steps.map((step: any) => <button key={step.id} onClick={() => onStepChange(step.id)}>{step.label}</button>)}</nav> }));
vi.mock("@/components/layout/EpisodeMiniList", () => ({ default: () => null }));
vi.mock("@/components/modules/ScriptProcessor", () => ({ default: () => <div>Script workbench</div> }));
vi.mock("@/components/modules/ConsistencyVault", () => ({ default: () => <div>Canonical asset workbench</div> }));
vi.mock("@/components/modules/VideoAssembly", () => ({ default: () => null }));
vi.mock("@/components/modules/ArtDirection", () => ({ default: () => null }));
vi.mock("@/components/modules/StoryboardComposer", () => ({ default: () => null }));
vi.mock("@/components/modules/StoryboardR2V", () => ({ default: () => null }));
vi.mock("@/components/common/ModelSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/project/EnvConfigDialog", () => ({ default: () => null }));
vi.mock("@/components/project/PromptConfigModal", () => ({ default: () => null }));
vi.mock("@/components/modules/EntityConfirmModal", () => ({ default: () => null }));

beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ selectProject: mocks.selectProject, pendingExtraction: null,
        currentProject: { id: "episode", title: "Episode", characters: [], scenes: [], props: [], frames: [] } as never });
});

it.each(["r2v", "i2v_legacy", undefined])("exposes one Assets stage and opens the shared workbench (%s)", mode => {
    useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject, workflow_mode: mode } as never });
    render(<ProjectClient id="episode" />);
    expect(screen.queryByRole("button", { name: /Cast/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "3. Assets" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "3. Assets" }));
    expect(screen.getByText("Canonical asset workbench")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1. Script" }));
    act(() => document.dispatchEvent(new CustomEvent("lumenx:navigateStep", { detail: "assets" })));
    expect(screen.getByText("Canonical asset workbench")).toBeInTheDocument();
});

it("keeps one renumbered Assets stage in freeform series", async () => {
    mocks.getSeries.mockResolvedValue({ content_mode: "freeform" });
    useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject, workflow_mode: "r2v", series_id: "series" } as never });
    render(<ProjectClient id="episode" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "2. Assets" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Script|Cast/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2. Assets" }));
    expect(screen.getByText("Canonical asset workbench")).toBeInTheDocument();
});
