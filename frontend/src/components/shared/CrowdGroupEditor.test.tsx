import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CrowdGroupEditor from "./CrowdGroupEditor";

const mocks = vi.hoisted(() => ({ getSeries: vi.fn(), updateSeries: vi.fn(), createSeriesCharacter: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks }));

it("opens a crowd template and saves its edits to the series roster", async () => {
  const series = { id: "series", characters: [], extra_roster: [] } as any;
  mocks.getSeries.mockResolvedValue(series);
  mocks.updateSeries.mockResolvedValue({ ...series, extra_roster: [{ extra_id: "crowd-1", label: "街市百姓", kind: "extra_template", wardrobe: "暮秋布衣" }] });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<CrowdGroupEditor group={{ extra_id: "crowd-1", label: "街市百姓", kind: "extra_template" }} series={series} onSaved={onSaved} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("服装与识别点"), { target: { value: "暮秋布衣" } });
  fireEvent.click(screen.getByRole("button", { name: "保存群演" }));
  await waitFor(() => expect(mocks.updateSeries).toHaveBeenCalledWith("series", { extra_roster: [
    { extra_id: "crowd-1", label: "街市百姓", kind: "extra_template", wardrobe: "暮秋布衣" },
  ] }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});
