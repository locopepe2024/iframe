// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { api } from "@/lib/api";
import SeriesDirectorProfilePanel from "@/components/series/SeriesDirectorProfilePanel";

const profile = {
    setting: { premise: "A healer searches for her missing brother", era: "Fictional dynasty" },
    timeline: [{ order: 2, event: "The alliance breaks" }, { order: 1, event: "The siblings are separated" }],
    relationships: [{ description: "The siblings trust each other" }],
    key_events: [{ title: "The hidden letter is found" }],
    continuity_constraints: ["The letter remains with Lin"],
    unresolved_questions: ["Who sent the letter?"],
    emotional_arc: "private execution note",
    visual_language: "visual style directive",
    execution_summary: "CURRENT_DIRECTOR_EDITS: private downstream context",
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getSeriesDirectorProfile").mockResolvedValue({
        series_id: "series-1", source_context: { text: "whole-work source" },
        profile: null, draft: profile, draft_revision: 2, confirmed_revisions: [{ revision: 1 }],
        style_review_required: false,
    } as any);
    vi.spyOn(api, "saveSeriesSourceContext").mockResolvedValue({} as any);
    vi.spyOn(api, "saveSeriesDirectorDraft").mockResolvedValue({ draft: profile, draft_revision: 2 } as any);
    vi.spyOn(api, "confirmSeriesDirectorProfile").mockResolvedValue({ revision: 2 } as any);
});

it("shows readable whole-series context as an unadopted draft, excluding execution and style fields", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><SeriesDirectorProfilePanel seriesId="series-1" onSaved={vi.fn()} /></NextIntlClientProvider>);

    expect(await screen.findByText("A healer searches for her missing brother")).toBeInTheDocument();
    expect(screen.getByText("Unadopted draft")).toBeInTheDocument();
    expect(screen.getByText("The siblings are separated")).toBeInTheDocument();
    expect(screen.getByText("The alliance breaks")).toBeInTheDocument();
    const report = screen.getByRole("heading", { name: "Series understanding" }).parentElement?.parentElement;
    expect(report?.textContent).not.toMatch(/CURRENT_DIRECTOR_EDITS|visual style directive|private execution note/);
    expect(screen.getByText(/Per-episode coverage, sourced cross-episode events/)).toBeInTheDocument();
    expect(screen.getByLabelText("Global Director draft")).toBeInTheDocument();
  });

it("marks the report adopted after explicit confirmation", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><SeriesDirectorProfilePanel seriesId="series-1" onSaved={vi.fn()} /></NextIntlClientProvider>);

    const confirm = await screen.findByRole("button", { name: "Confirm series understanding" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText("Adopted global v2")).toBeInTheDocument();
  });
