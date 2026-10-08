import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import AvatarWorkbench from "./AvatarWorkbench";

const listLibraryAssets = vi.fn();
const listAvatarCharacters = vi.fn();
const createAvatarCharacter = vi.fn();
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ api: {
  listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args),
  listAvatarCharacters: (...args: unknown[]) => listAvatarCharacters(...args),
  createAvatarCharacter: (...args: unknown[]) => createAvatarCharacter(...args),
} }));

it("creates an Avatar identity without treating the iFrame library as its source", async () => {
  listAvatarCharacters.mockResolvedValue({ characters: [] });
  createAvatarCharacter.mockResolvedValue({ character_id: "avatar_1", name: "Mira", identity_revision: 1, identity: { face: "oval" }, reference_assets: [], review_status: "draft" });
  render(<AvatarWorkbench />);

  fireEvent.change(screen.getByRole("textbox", { name: "Character name" }), { target: { value: "Mira" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Face structure" }), { target: { value: "oval" } });

  expect(screen.getByRole("textbox", { name: "Character name" })).toHaveValue("Mira");
  expect(screen.getByRole("textbox", { name: "Face structure" })).toHaveValue("oval");
  fireEvent.click(screen.getByRole("button", { name: "Create character" }));
  await waitFor(() => expect(screen.getByText("avatar_1")).toBeInTheDocument());
  expect(createAvatarCharacter).toHaveBeenCalledWith({ name: "Mira", identity: { face: "oval" } });
  expect(listLibraryAssets).not.toHaveBeenCalled();
});
