import { describe, expect, it, vi } from "vitest";
import { buildRecreationFrameManifest, importCuts, seconds, SourceAnalysis, recreationApi, RecreationMedia, validateRecreationFrameManifest } from "@/lib/recreation";

const analysis: SourceAnalysis = {
  time_base: "1/60000", start_pts: 1000, end_pts: 901000,
  frame_pts: [1000, 2000, 3500, 242000, 546000, 625000, 900000],
  duration_seconds: 15, width: 1080, height: 1920, audio_streams: 0,
  candidates: [], contact_sheet_url: "",
  source_fingerprint: "a".repeat(64),
};

describe("recreation timestamp import", () => {
  it("keeps source ticks, including a nonzero origin and six-decimal exports", () => {
    expect(importCuts("4.016667, 9.083333, 10.400000", analysis)).toEqual([242000, 546000, 625000]);
    expect(seconds(analysis, 1000)).toBe(0);
  });
  it("rejects unsorted, repeated, off-frame or boundary times", () => {
    for (const text of ["4", "0", "15", "9.083333,4.016667", "4.016667,4.016667", "NaN", "Infinity"]) {
      expect(() => importCuts(text, analysis)).toThrow("invalidTimeline");
    }
  });
  it("allows a single-shot timeline", () => expect(importCuts("", analysis)).toEqual([]));
});

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
import axios from "axios";
it("rejects an HTML fallback instead of returning it as a project list", async () => {
  vi.mocked(axios.get).mockResolvedValueOnce({ data: "<!DOCTYPE html><html></html>" });
  await expect(recreationApi.list()).rejects.toThrow("Invalid recreation project list response");
});
it("accepts an empty project list", async () => {
  vi.mocked(axios.get).mockResolvedValueOnce({ data: [] });
  await expect(recreationApi.list()).resolves.toEqual([]);
});

const sourceMedia: RecreationMedia = {
  media_id: "source-media", project_id: "project", kind: "source_video", display_name: "fight.mp4",
  storage_path: "projects/project/fight.mp4", sha256: "a".repeat(64), created_at: 1, metadata: {},
};

function evidenceMedia(mediaId: string, pts: number, role = "sample"): RecreationMedia {
  return {
    media_id: mediaId, project_id: "project", kind: role === "sample" ? "sample_frame" : "evidence_frame",
    display_name: mediaId, storage_path: `projects/project/${mediaId}.jpg`, sha256: `${mediaId}-hash`, created_at: 1,
    metadata: { parent_media_id: "source-media", analysis_id: "analysis", pts, time_base: "1/60000", role },
  };
}

describe("recreation frame manifest", () => {
  it("sorts indexed media by exact source PTS and preserves provenance", () => {
    const manifest = buildRecreationFrameManifest({
      manifest_id: "manifest-1", analysis_id: "analysis", analysis, source_media: sourceMedia,
      frames: [evidenceMedia("late", 546000, "after"), evidenceMedia("early", 242000, "before")], review_state: "reviewed",
    });
    expect(manifest).toMatchObject({
      schema_version: "recreation.frame-manifest.v1", source_media_id: "source-media", source_checksum: "a".repeat(64),
      analysis_id: "analysis", time_base: "1/60000", review_state: "reviewed",
    });
    expect(manifest.frames.map((frame) => [frame.evidence_media_id, frame.source_pts])).toEqual([["early", 242000], ["late", 546000]]);
    expect(manifest.frames.map((frame) => frame.source_seconds)).toEqual([4.016666666666667, 9.083333333333334]);
    expect(manifest.frames[0]).toMatchObject({ evidence_media_path: "projects/project/early.jpg", width: 1080, height: 1920, extraction_method: "before" });
  });

  it("rejects duplicate, non-source, and wrong-analysis frames without snapping", () => {
    expect(() => buildRecreationFrameManifest({
      manifest_id: "manifest-duplicate", analysis_id: "analysis", analysis, source_media: sourceMedia,
      frames: [evidenceMedia("a", 242000), evidenceMedia("b", 242000)],
    })).toThrow("duplicatePts");
    expect(() => buildRecreationFrameManifest({
      manifest_id: "manifest-nearest", analysis_id: "analysis", analysis, source_media: sourceMedia,
      frames: [evidenceMedia("off-frame", 242001)],
    })).toThrow("frameOutOfRange");
    expect(() => buildRecreationFrameManifest({
      manifest_id: "manifest-analysis", analysis_id: "other-analysis", analysis, source_media: sourceMedia,
      frames: [evidenceMedia("wrong-analysis", 242000)],
    })).toThrow("analysisMismatch");
  });

  it("rejects stale source checksum and unrelated media identity", () => {
    expect(() => buildRecreationFrameManifest({
      manifest_id: "manifest-checksum", analysis_id: "analysis", analysis: { ...analysis, source_fingerprint: "b".repeat(64) }, source_media: sourceMedia,
      frames: [evidenceMedia("frame", 242000)],
    })).toThrow("sourceChecksumMismatch");
    expect(() => buildRecreationFrameManifest({
      manifest_id: "manifest-source", analysis_id: "analysis", analysis, source_media: sourceMedia,
      frames: [{ ...evidenceMedia("foreign", 242000), metadata: { ...evidenceMedia("foreign", 242000).metadata, parent_media_id: "other-source" } }],
    })).toThrow("sourceMediaMismatch");
  });

  it("validates the serialized read-only shape and keeps no pose-track fields", () => {
    const manifest = buildRecreationFrameManifest({
      manifest_id: "manifest-validate", analysis_id: "analysis", analysis, source_media: sourceMedia,
      frames: [evidenceMedia("frame", 242000)],
    });
    expect(validateRecreationFrameManifest(JSON.parse(JSON.stringify(manifest)), analysis)).toEqual(manifest);
    expect(manifest).not.toHaveProperty("tracks");
    expect(() => validateRecreationFrameManifest({ ...manifest, frames: [{ ...manifest.frames[0], source_pts: 242001 }] }, analysis)).toThrow("frameOutOfRange");
    expect(() => validateRecreationFrameManifest({ ...manifest, frames: [
      { ...manifest.frames[0], source_pts: 546000, source_seconds: seconds(analysis, 546000) },
      { ...manifest.frames[0], source_pts: 242000, source_seconds: seconds(analysis, 242000) },
    ] }, analysis)).toThrow("frameOrder");
  });
});
