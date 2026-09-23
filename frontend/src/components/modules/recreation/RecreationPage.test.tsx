import React from "react";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import RecreationPage from "./RecreationPage";
import { recreationApi, RecreationProject } from "@/lib/recreation";

vi.mock("@/lib/recreation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/recreation")>(),
  recreationApi: { list: vi.fn(), get: vi.fn(), confirm: vi.fn(), analyze: vi.fn(), upload: vi.fn(), evidence: vi.fn(), media: vi.fn(), searchMedia: vi.fn(), bindShot: vi.fn(), uploadImage: vi.fn(), models: vi.fn(), keyframeTasks: vi.fn(), generationTasks: vi.fn(), assemblyTasks: vi.fn() },
}));

const project: RecreationProject = {
  id: "source", title: "Original.mp4", source_url: "/source.mp4", revision: 3, analysis_id: "analysis",
  status: "review", error: null, timeline: null,
  analysis: { time_base: "1/60000", start_pts: 0, end_pts: 900000,
    frame_pts: [0, 1000, 241000, 545000, 624000, 899000], duration_seconds: 15,
    width: 1080, height: 1920, audio_streams: 0, contact_sheet_url: "/contact.jpg",
    candidates: [{ pts: 241000, before_pts: 1000, before_url: "/before.jpg", after_url: "/after.jpg", source: "detected" }] },
};

beforeEach(() => {
  vi.mocked(recreationApi.list).mockResolvedValue([project]);
  vi.mocked(recreationApi.get).mockResolvedValue(project);
  vi.mocked(recreationApi.media).mockResolvedValue({ media_id: "image", project_id: "source", kind: "evidence_frame", display_name: "Evidence", storage_path: "/image.png", sha256: "hash", created_at: 1, metadata: {} });
  vi.mocked(recreationApi.models).mockResolvedValue({ provider: "uniart", source: "static", defaults: { image_model: "uniart/gpt-image-2", video_model: "uniart/minimax-h3-vip" }, image_models: [{ id: "uniart/gpt-image-2", display_name: "GPT Image 2", capabilities: ["i2i"] }], video_models: [{ id: "uniart/minimax-h3-vip", display_name: "MiniMax H3", capabilities: ["r2v"] }] });
  vi.mocked(recreationApi.keyframeTasks).mockResolvedValue([]);
  vi.mocked(recreationApi.generationTasks).mockResolvedValue([]);
  vi.mocked(recreationApi.assemblyTasks).mockResolvedValue([]);
  vi.mocked(recreationApi.confirm).mockResolvedValue({ ...project, status: "confirmed",
    timeline: { cuts: [], shots: [{ id: "confirmed-shot", start_pts: 0, end_pts: 900000 }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

async function open() {
  render(<NextIntlClientProvider locale="en" messages={messages}><RecreationPage /></NextIntlClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Original.mp4/ }));
  await screen.findByRole("button", { name: "Confirm timeline" });
}

describe("recreation confirmation", () => {
  it("navigates the six workflow stages and keeps asset management available", async () => {
    await open();
    const navigation = screen.getByRole("navigation", { name: "Recreation project stages" });
    expect(navigation.querySelectorAll("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Assets" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByText("Available now: frame sampling and contact sheet. ASR transcription and subtitle cleanup are not integrated in this workflow yet.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Contact sheet" })).toBeInTheDocument();
  });

  it("shows a recoverable error when the project API rejects an invalid response", async () => {
    vi.mocked(recreationApi.list).mockRejectedValueOnce(new Error("Invalid recreation project list response"));
    render(<NextIntlClientProvider locale="en" messages={messages}><RecreationPage /></NextIntlClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.recreation.requestFailed);
  });
  it("never confirms on analysis load, submits exact imported PTS only on user action", async () => {
    await open();
    expect(recreationApi.confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Cut times in seconds" }), { target: { value: "4.016667, 9.083333, 10.400000" } });
    fireEvent.click(screen.getByRole("button", { name: "Import cuts" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm timeline" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirm timeline" }));
    await waitFor(() => expect(recreationApi.confirm).toHaveBeenCalledWith(project, [241000, 545000, 624000]));
  });
  it("rejects an off-frame import and retains the detected cut", async () => {
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Cut times in seconds" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Import cuts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("source-frame times");
    expect(screen.getAllByText(/4.016667 s/).length).toBeGreaterThan(0);
    expect(recreationApi.confirm).not.toHaveBeenCalled();
  });
  it("can remove all candidates and confirm a single continuous shot", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Remove cut" }));
    expect(screen.getByText("One continuous shot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm timeline" }));
    await waitFor(() => expect(recreationApi.confirm).toHaveBeenCalledWith(project, []));
  });

  it("keeps the source video URL stable while analysis polling refreshes signatures", async () => {
    vi.useFakeTimers();
    const processing = { ...project, status: "analyzing" as const, analysis: null, source_url: "/source-initial.mp4" };
    vi.mocked(recreationApi.list).mockResolvedValueOnce([processing]);
    vi.mocked(recreationApi.get)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce({ ...project, source_url: "/source-rotated.mp4" });

    render(<NextIntlClientProvider locale="en" messages={messages}><RecreationPage /></NextIntlClientProvider>);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: /Original.mp4/ }));
    await act(async () => { await Promise.resolve(); });
    const initialSource = document.querySelector("video")?.getAttribute("src");
    expect(initialSource).toContain("/source-initial.mp4");

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(document.querySelector("video")?.getAttribute("src")).toBe(initialSource);
  });
});
