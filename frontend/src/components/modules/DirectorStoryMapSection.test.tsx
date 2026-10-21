// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import DirectorStoryMapSection from "./DirectorStoryMapSection";

it("starts with the core on the left and level two only, then expands deeper nodes on demand", () => {
    const profile = { story_map: { source_revision: 1, source_revision_id: "r1", phases: [{ phase_id: "p1", order: 0, label: "Phase one", events: [{ event_id: "e1", title: "Event one", description: "Existing event" }] }] } };
    const { container } = render(<NextIntlClientProvider locale="en" messages={messages}><DirectorStoryMapSection profile={profile} onChange={vi.fn()} sourceRevision={1} characters={[]} facts={[]} factLedgerRevision={null} factsLoading={false} factsError="" onReloadFacts={vi.fn()} /></NextIntlClientProvider>);
    const core = container.querySelector('[data-graph-node="core"]')!;
    const timeline = container.querySelector<HTMLButtonElement>('[data-graph-node="timeline"]')!;
    expect(core.parentElement?.className).toContain("items-center");
    expect(core.nextElementSibling?.getAttribute("data-graph-depth")).toBe("2");
    expect(timeline.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-graph-depth="3"]')).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(timeline.parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(messages.artDirection.directorEditor.storyMap.mindMapTimelineHint);
    expect(timeline).not.toHaveTextContent(messages.artDirection.directorEditor.storyMap.mindMapTimelineHint);
    fireEvent.mouseLeave(timeline.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(timeline);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(timeline, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(timeline);
    const phase = container.querySelector<HTMLButtonElement>('[data-graph-node="timeline-p1"]')!;
    expect(phase).not.toBeNull();
    expect(phase.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-graph-node="event-e1"]')).toBeNull();
    fireEvent.click(phase);
    expect(container.querySelector('[data-graph-node="event-e1"]')).not.toBeNull();
    expect(screen.getByLabelText("脑图节点详情")).toBeInTheDocument();
    fireEvent.click(timeline);
    expect(container.querySelector('[data-graph-depth="3"]')).toBeNull();
    expect(container.querySelector('[data-graph-depth="4"]')).toBeNull();
});
