// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ExtraRosterPanel } from "@/components/series/SeriesDetailPage";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/zh.json";

vi.mock("@/components/modules/CharacterWorkbench", () => ({ default: ({ asset }: any) => <div data-testid="character-editor">{asset.name}</div> }));
vi.mock("@/lib/api", () => ({ api: { updateSeries: vi.fn(), createSeriesCharacter: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("binds an existing series character and opens the canonical editor", async () => {
  vi.mocked(api.updateSeries).mockResolvedValue({} as any);
  const series = {
    id: "series", characters: [{ id: "character-1", name: "群演一" }],
    extra_roster: [{ extra_id: "extra-1", label: "街边行人", kind: "fixed_extra" }],
  } as any;
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<NextIntlClientProvider locale="zh" messages={messages}><ExtraRosterPanel series={series} seriesId="series" onSaved={onSaved} /></NextIntlClientProvider>);
  fireEvent.change(screen.getByLabelText("关联角色资产"), { target: { value: "character-1" } });
  await waitFor(() => expect(api.updateSeries).toHaveBeenCalledWith("series", {
    extra_roster: [{ extra_id: "extra-1", label: "街边行人", kind: "fixed_extra", visual_asset_id: "character-1" }],
  }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  fireEvent.click(screen.getByText("编辑角色"));
  expect(screen.getByTestId("character-editor").textContent).toBe("群演一");
});
