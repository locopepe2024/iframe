// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import { useDirectorSkills } from "@/lib/directorSkills";
vi.mock("axios");
vi.mock("@/lib/api", () => ({ API_URL: "/api" }));
const selected = [{ id: "people-relations", revision: "a".repeat(64) }];
const task = { ...selected[0], label: "人物与关系", category: "故事与人物分析" };
beforeEach(() => vi.resetAllMocks());
it("loads object selection, persists clearing without generation, restores on reopen", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { catalog: [task], skills: selected } });
    vi.mocked(axios.put).mockResolvedValue({ data: { skills: [] } });
    const { result, unmount } = renderHook(() => useDirectorSkills("film", "episode"));
    expect(result.current.canRun).toBe(false);
    await waitFor(() => expect(result.current.selected).toEqual(selected));
    expect(result.current.canRun).toBe(true);
    await act(() => result.current.update([]));
    expect(axios.put).toHaveBeenCalledWith("/api/projects/film/director-skills/episode", { skills: [] }, { timeout: 15000 });
    expect(result.current.selected).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
    unmount();
    vi.mocked(axios.get).mockResolvedValue({ data: { catalog: [task], skills: [] } });
    const reopened = renderHook(() => useDirectorSkills("film", "episode"));
    await waitFor(() => expect(reopened.result.current.loading).toBe(false));
    expect(reopened.result.current.selected).toEqual([]);
});
it("preserves last saved selection on save failure", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { catalog: [task], skills: selected } });
    vi.mocked(axios.put).mockRejectedValue(new Error("failed"));
    const { result } = renderHook(() => useDirectorSkills("film", "episode"));
    await waitFor(() => expect(result.current.canRun).toBe(true));
    await act(() => result.current.update([]));
    expect(result.current.selected).toEqual(selected);
    expect(result.current.error).toContain("选择保存失败");
});
it("ignores delayed responses after object switch and rejects stale revisions", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(axios.get).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    vi.mocked(axios.get).mockResolvedValue({ data: { catalog: [task], skills: [{ ...selected[0], revision: "old" }] } });
    const { result, rerender } = renderHook(({ id }) => useDirectorSkills(id, "episode"), { initialProps: { id: "old" } });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolve({ data: { catalog: [], skills: [] } }));
    expect(result.current.selected[0].revision).toBe("old");
    expect(result.current.canRun).toBe(false);
});
