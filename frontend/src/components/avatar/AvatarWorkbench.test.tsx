import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import AvatarWorkbench from "./AvatarWorkbench";

const listLibraryAssets = vi.fn();
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ API_URL: "", api: { listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args) } }));

it("reads the real character asset source and shows its image variants", async () => {
  listLibraryAssets.mockResolvedValue({ characters: [
    { id: "char_1", name: "Mira", description: "Actor", reference_sheet: { selected_image_id: "front", image_variants: [{ id: "front", url: "/files/front.png", reference_view_role: "front" }] } },
    { id: "char_2", name: "Noah", description: "Supporting" },
  ] });
  render(<AvatarWorkbench />);

  await waitFor(() => expect(screen.getByRole("button", { name: /Mira/ })).toBeInTheDocument());
  expect(listLibraryAssets).toHaveBeenCalledTimes(1);
  expect(screen.getByText("front")).toBeInTheDocument();
  expect(screen.getByText(/not connected/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Save new revision/ })).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Search characters" }), { target: { value: "Noah" } });
  expect(screen.queryByRole("button", { name: /Mira/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Noah/ }));
  expect(screen.getByRole("heading", { name: "Noah" })).toBeInTheDocument();
});
