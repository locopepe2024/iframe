import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { recreationApi, RecreationProject, ShotReview } from "@/lib/recreation";
import ShotReviewTimeline from "./ShotReviewTimeline";

vi.mock("@/lib/recreation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/recreation")>(),
  recreationApi: { getShotReview: vi.fn(), saveShotReview: vi.fn(), models: vi.fn(), runSecondPass: vi.fn() },
}));
vi.mock("./DetailReviewPanel", () => ({ default: () => null }));

const review: ShotReview = {
  schema_version: "shot-review.v1", analysis_id: "analysis", source_fingerprint: "source",
  timeline_key: "timeline", review_revision: 3, updated_at: 0,
  items: [
    { id: "action:first", kind: "action", shot_id: "shot", frame_span: [1, 2], evidence_frames: [1],
      candidate: "left leg unknown", edited_text: "", decision: "pending", actor_id: "A1", source: {} },
    { id: "camera:second", kind: "camera", shot_id: "shot", frame_span: [2, 3], evidence_frames: [2],
      candidate: "fixed camera", edited_text: "", decision: "pending", actor_id: "", source: {} },
  ],
};
const project: RecreationProject = {
  id: "project", title: "Source", source_url: "/source.mp4", revision: 3, analysis_id: "analysis",
  source_fingerprint: "source", status: "confirmed", error: null,
  analysis: { time_base: "1/25", start_pts: 0, end_pts: 3, frame_pts: [0, 1, 2],
    duration_seconds: 0.12, width: 960, height: 540, audio_streams: 0, candidates: [], contact_sheet_url: "" },
  timeline: { cuts: [], shots: [{ id: "shot", start_pts: 0, end_pts: 3 }] }, shot_review: review,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(complete: boolean) {
  vi.mocked(recreationApi.models).mockResolvedValue({ provider: "uniart", source: "live",
    defaults: { image_model: "", video_model: "" }, image_models: [], video_models: [],
    vision_models: [
      { id: "uniart/qwen3-vl-plus", display_name: "Qwen3 VL Plus", capabilities: ["chat"] },
      { id: "uniart/gpt-5.6-sol", display_name: "GPT 5.6 Sol", capabilities: ["chat"] },
    ] });
  vi.mocked(recreationApi.getShotReview).mockResolvedValue({
    timeline_key: "timeline", review, stale: false, candidate_digest: "digest", completion_valid: complete,
    completion: { schema_version: complete ? "shot-candidate-completion.v2" : "shot-candidate-completion.v1",
      status: "completed", source_fingerprint: "source", analysis_id: "analysis", timeline_key: "timeline",
      candidate_digest: "digest", run_id: "pass-2", model: "vision", prompt_revision: "v2",
      items: [{ item_id: "action:first", status: "predicted", prediction: "left leg kicks", reason: "adjacent frames",
        method: "temporal review", evidence_frames: [1, 2] },
      ...(complete ? [{ item_id: "camera:second", status: "predicted" as const, prediction: "fixed camera",
        reason: "background tracks", method: "temporal review", evidence_frames: [2, 3] }] : [])],
    },
  });
  vi.mocked(recreationApi.saveShotReview).mockResolvedValue({ ...project, shot_review: { ...review,
    review_revision: 4, items: review.items.map(item => item.id === "action:first"
      ? { ...item, decision: "edit", edited_text: "left leg kicks" } : item) } });
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <ShotReviewTimeline project={project} onSaved={vi.fn()} seek={vi.fn()} currentFrame={1} viewer={<div>Viewer</div>} />
  </NextIntlClientProvider>);
}

it("runs second analysis with the selected UniArt vision model", async () => {
  setup(false);
  vi.mocked(recreationApi.runSecondPass).mockResolvedValue({ ...project,
    candidate_completion_run: { run_id: "run-1", status: "queued", model: "uniart/gpt-5.6-sol",
      completed_items: 0, total_items: 2, error: "" } });
  const select = await screen.findByRole("combobox", { name: "Second analysis model" });
  fireEvent.change(select, { target: { value: "uniart/gpt-5.6-sol" } });
  fireEvent.click(screen.getByRole("button", { name: "Run second analysis (model call)" }));
  await waitFor(() => expect(recreationApi.runSecondPass).toHaveBeenCalledWith(
    project, "timeline", "uniart/gpt-5.6-sol"));
  expect(await screen.findByRole("status")).toHaveTextContent("queued");
});

it("compares both analyses and saves the chosen second-pass text", async () => {
  setup(true);
  expect(await screen.findByText(/2\/2 model candidates have a second pass/)).toBeInTheDocument();
  expect(screen.getByText("2 pending decisions")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /camera:second/ }));
  expect(screen.getByText("#camera:second")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /action:first/ }));
  expect(screen.getAllByText(/left leg unknown/)).toHaveLength(2);
  expect(screen.getByText(/left leg kicks/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm second analysis" }));
  await waitFor(() => expect(recreationApi.saveShotReview).toHaveBeenCalledWith(project, "timeline", 3,
    { items: [expect.objectContaining({ id: "action:first", decision: "edit", edited_text: "left leg kicks" }), review.items[1]] }));
  expect(await screen.findByText("1 pending decisions")).toBeInTheDocument();
});

it("keeps confirmation closed when the second pass covers only uncertainties", async () => {
  setup(false);
  expect(await screen.findByText(/1\/2 model candidates have a second pass/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm second analysis" })).toBeDisabled();
  expect(screen.getByText(/1 awaiting second pass/)).toBeInTheDocument();
});

it("confirms only matching second-pass items together", async () => {
  setup(true);
  const summary = await screen.findByText("Unchanged · 1");
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Confirm 1 unchanged items" }));
  await waitFor(() => expect(recreationApi.saveShotReview).toHaveBeenCalledWith(project, "timeline", 3,
    { items: [review.items[0], expect.objectContaining({ id: "camera:second", decision: "accept" })] }));
});
