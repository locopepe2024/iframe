import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import PoseReview from "./PoseReview";
import { poseReviewApi, PoseReviewFrame, RecreationProject } from "@/lib/recreation";
vi.mock("@/lib/recreation", async original => ({ ...await original<typeof import("@/lib/recreation")>(), poseReviewApi: { list: vi.fn(), frame: vi.fn(), save: vi.fn() } }));
const project: RecreationProject = { id: "p", title: "video", source_url: "/v.mp4", revision: 5, analysis_id: "a", status: "review", timeline: null, error: null,
  analysis: { frame_pts: [0, 1000], time_base: "1/25000", start_pts: 0, end_pts: 2000, duration_seconds: .08, width: 1920, height: 1080, audio_streams: 0, candidates: [], contact_sheet_url: "/c.jpg" } };
const frame: PoseReviewFrame = { analysis_id: "a", pts: 0, source_frame: 1, time_base: "1/25000", source_checksum: "source", media_id: "m", image_sha256: "hash", image_url: "/frame.jpg", width: 960, height: 540, revision: 0,
  joints: { left_knee: { xy: [50, 60], visibility: "uncertain" } }, status: "draft", contact: "uncertain", depth_order: "uncertain" };
beforeEach(() => {
  vi.mocked(poseReviewApi.list).mockResolvedValue({ analysis_id: "a", frames: [] });
  vi.mocked(poseReviewApi.frame).mockImplementation(async () => structuredClone(frame));
  vi.mocked(poseReviewApi.save).mockImplementation(async (_id, f) => ({ ...f, revision: f.revision + 1 }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
function mount() { render(<NextIntlClientProvider locale="en" messages={messages}><PoseReview project={project} /></NextIntlClientProvider>); }
async function load() {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Annotate motion" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Load frame" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Load frame" }));
  const editor = await screen.findByRole("img", { name: /Joint editor/ });
  fireEvent.load(editor.querySelector("image")!); return editor;
}
describe("project motion review", () => {
  it("loads on demand and uses exact source PTS", async () => {
    mount(); expect(poseReviewApi.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Annotate motion" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Load frame" })).not.toBeDisabled());
    fireEvent.change(screen.getByRole("spinbutton", { name: "Source frame" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Load frame" }));
    await waitFor(() => expect(poseReviewApi.frame).toHaveBeenCalledWith("p", "a", 1000));
  });
  it("edits a joint, reviews relative depth and saves to the project", async () => {
    const editor = await load(); fireEvent.keyDown(editor, { key: "ArrowRight" });
    fireEvent.change(screen.getByRole("combobox", { name: "Leg depth order" }), { target: { value: "right_front" } });
    fireEvent.click(screen.getByRole("button", { name: "Save annotations" }));
    await screen.findByText("Annotations saved to this project.");
    expect(poseReviewApi.save).toHaveBeenCalledWith("p", expect.objectContaining({ revision: 0, depth_order: "right_front", joints: { left_knee: { xy: [51, 60], visibility: "uncertain", semantic: "uncertain" } } }));
    expect(screen.getByRole("button", { name: "Export saved annotations" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Save annotations" })).toBeDisabled();
  });
  it("keeps a draft after failed save and warns before discarding", async () => {
    const editor = await load(); fireEvent.keyDown(editor, { key: "ArrowLeft" });
    vi.mocked(poseReviewApi.save).mockRejectedValueOnce(new Error("conflict"));
    fireEvent.click(screen.getByRole("button", { name: "Save annotations" }));
    await screen.findByRole("alert"); expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Load frame" }));
    expect(confirm).toHaveBeenCalled(); expect(poseReviewApi.frame).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save annotations" }));
    await screen.findByText("Annotations saved to this project.");
  });
  it("keeps outline semantics separate from visibility and preserves coordinates", async () => {
    await load();
    fireEvent.change(screen.getByRole("combobox", { name: "Point meaning" }), { target: { value: "body_contour" } });
    fireEvent.click(screen.getByRole("button", { name: "Save annotations" }));
    await screen.findByText("Annotations saved to this project.");
    expect(poseReviewApi.save).toHaveBeenCalledWith("p", expect.objectContaining({ joints: { left_knee: { xy: [50, 60], visibility: "uncertain", semantic: "body_contour" } } }));
  });
  it("restores saved frame links without claiming recomputation", async () => {
    vi.mocked(poseReviewApi.list).mockResolvedValue({ analysis_id: "a", frames: [{ ...frame, revision: 1 }] });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Annotate motion" }));
    fireEvent.click(await screen.findByRole("button", { name: "Frame 1 · Draft" }));
    await screen.findByRole("img", { name: /Joint editor/ });
    expect(screen.getByText("Annotations are saved separately. 3D motion has not been recalculated.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Leg depth order" })).toHaveValue("uncertain");
  });
});
