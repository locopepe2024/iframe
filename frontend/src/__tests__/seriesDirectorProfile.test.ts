import { beforeEach, afterEach, expect, it, vi } from "vitest";
import axios from "axios";
import { analyzeSeriesDirectorProfile } from "../lib/seriesDirectorProfile";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    isAxiosError: (error: any) => error?.isAxiosError === true,
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("returns the profile and source audit from the durable result", async () => {
  const profile = { setting: { geography: "西安" } };
  const sourceAudit = { source_mode: "map_reduce", chunk_count: 3, raw_response_received: true };
  vi.mocked(axios.post).mockResolvedValue({
    data: { id: "series-job", status: "running" },
  });
  vi.mocked(axios.get).mockResolvedValue({
    data: { id: "series-job", status: "completed", result: { profile, source_audit: sourceAudit } },
  });

  const pending = analyzeSeriesDirectorProfile("/api", "series-1");
  await vi.runAllTimersAsync();

  await expect(pending).resolves.toEqual({ profile, sourceAudit });
});

it("does not discard a profile when the worker exposes it before terminal status", async () => {
  const profile = { setting: { geography: "北京" } };
  vi.mocked(axios.post).mockResolvedValue({
    data: { id: "series-job", status: "running", result: { profile } },
  });

  await expect(analyzeSeriesDirectorProfile("/api", "series-1")).resolves.toEqual({ profile });
  expect(axios.get).not.toHaveBeenCalled();
});
