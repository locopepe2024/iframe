import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SoundOutputCheck from "./SoundOutputCheck";

it("tests output with a local WAV and replays only on explicit request", async () => {
  const replay = vi.fn(), fetch = vi.fn();
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-tone");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetch);
  const view = render(<SoundOutputCheck disabled={false} snapshot={() => "音轨有效"} replay={replay} />);
  fireEvent.click(screen.getByRole("button", { name: "检查声音" }));
  expect(screen.getByText("音轨有效")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "播放测试音" }));
  expect(screen.getByLabelText("本地测试音")).toHaveAttribute("src", "blob:local-tone");
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  const data = await (create.mock.calls[0][0] as Blob).arrayBuffer();
  expect(new TextDecoder().decode(data.slice(0, 4))).toBe("RIFF");
  expect(new Int16Array(data.slice(44)).some(sample => sample !== 0)).toBe(true);
  expect(fetch).not.toHaveBeenCalled(); expect(replay).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重播上一条回复" }));
  expect(replay).toHaveBeenCalledOnce();
  view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:local-tone");
  play.mockRestore(); create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals();
});
