import { describe, expect, it, vi } from "vitest";
import { importCuts, seconds, SourceAnalysis, recreationApi } from "@/lib/recreation";

const analysis: SourceAnalysis = {
  time_base: "1/60000", start_pts: 1000, end_pts: 901000,
  frame_pts: [1000, 2000, 3500, 242000, 546000, 625000, 900000],
  duration_seconds: 15, width: 1080, height: 1920, audio_streams: 0,
  candidates: [], contact_sheet_url: "",
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
