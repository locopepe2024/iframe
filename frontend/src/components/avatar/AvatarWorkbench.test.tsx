import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import AvatarWorkbench from "./AvatarWorkbench";

const listLibraryAssets = vi.fn();
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ api: { listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args) } }));

it("starts with creating an identity without treating the iFrame library as its source", () => {
  render(<AvatarWorkbench />);

  fireEvent.change(screen.getByRole("textbox", { name: "Character name" }), { target: { value: "Mira" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Face structure" }), { target: { value: "oval" } });

  expect(screen.getByRole("textbox", { name: "Character name" })).toHaveValue("Mira");
  expect(screen.getByRole("textbox", { name: "Face structure" })).toHaveValue("oval");
  expect(screen.getByRole("button", { name: "Create character" })).toBeDisabled();
  expect(screen.getByText(/creation is not connected/)).toBeInTheDocument();
  expect(listLibraryAssets).not.toHaveBeenCalled();
});
