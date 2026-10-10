import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import AvatarWorkbench from "./AvatarWorkbench";

const listLibraryAssets = vi.fn();
const createLibraryAsset = vi.fn();
const listAvatarCharacters = vi.fn();
const createAvatarCharacter = vi.fn();
const updateAvatarDesign = vi.fn();
const getAvatarCharacter = vi.fn();
const agentRequest = vi.fn();
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ api: {
  listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args),
  createLibraryAsset: (...args: unknown[]) => createLibraryAsset(...args),
  listAvatarCharacters: (...args: unknown[]) => listAvatarCharacters(...args),
  createAvatarCharacter: (...args: unknown[]) => createAvatarCharacter(...args),
  updateAvatarDesign: (...args: unknown[]) => updateAvatarDesign(...args),
  getAvatarCharacter: (...args: unknown[]) => getAvatarCharacter(...args),
}, agentRequest: (...args: unknown[]) => agentRequest(...args) }));

it("creates an Avatar identity independently while reading library references", async () => {
  listAvatarCharacters.mockResolvedValue({ characters: [] });
  listLibraryAssets.mockResolvedValue({ characters: [] });
  agentRequest.mockResolvedValue({ models: [] });
  createAvatarCharacter.mockResolvedValue({ character_id: "avatar_1", name: "Mira", profile: "", design_revision: 1, character_design: { design_draft: { route: "realistic-modern", identity: { face: "oval" } }, design_revisions: [] }, review_status: "draft" });
  render(<AvatarWorkbench />);

  fireEvent.change(screen.getByRole("textbox", { name: "Character name" }), { target: { value: "Mira" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Face structure" }), { target: { value: "oval" } });

  expect(screen.getByRole("textbox", { name: "Character name" })).toHaveValue("Mira");
  expect(screen.getByRole("textbox", { name: "Face structure" })).toHaveValue("oval");
  fireEvent.click(screen.getByRole("button", { name: "Create character" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Mira.*draft/ })).toBeInTheDocument());
  expect(createAvatarCharacter).toHaveBeenCalledWith({ name: "Mira", profile: "", character_design: expect.objectContaining({ identity: { face: "oval" } }) });
  expect(listLibraryAssets).toHaveBeenCalled();
});

it("applies a concrete feature suggestion to the editable draft only", async () => {
  createAvatarCharacter.mockClear();
  listAvatarCharacters.mockResolvedValue({ characters: [] });
  listLibraryAssets.mockResolvedValue({ characters: [] });
  agentRequest.mockResolvedValue({ models: [] });
  render(<AvatarWorkbench />);

  expect(screen.getByRole("button", { name: "Oval face" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Oval face" }));
  expect(screen.getByRole("textbox", { name: "Face structure" })).toHaveValue("Oval face");
  expect(screen.getByRole("button", { name: "Oval face" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Almond-shaped eyes" }));
  expect(screen.getByRole("textbox", { name: "Eye shape" })).toHaveValue("Almond-shaped eyes");
  expect(createAvatarCharacter).not.toHaveBeenCalled();
});

it("saves a design draft and confirms it without using the media library", async () => {
  const base = { character_id: "avatar_1", name: "Mira", profile: "Original profile", design_revision: 1,
    character_design: { design_draft: { route: "realistic-modern", identity: { face: "oval" } }, design_revisions: [] }, review_status: "draft" };
  listAvatarCharacters.mockResolvedValue({ characters: [base] });
  listLibraryAssets.mockResolvedValue({ characters: [] });
  agentRequest.mockResolvedValue({ models: [] });
  updateAvatarDesign.mockImplementation((_id, input) => Promise.resolve({ ...base, design_revision: input.expected_revision + 1,
    character_design: { design_draft: input.character_design, design_revisions: input.confirmed ? [{ revision: 3, design: input.character_design }] : [] },
    review_status: input.confirmed ? "confirmed" : "draft" }));
  render(<AvatarWorkbench />);
  fireEvent.click(await screen.findByRole("button", { name: /Mira.*draft/ }));
  expect(screen.getByRole("textbox", { name: "Character profile" })).toHaveValue("Original profile");
  fireEvent.change(screen.getByRole("textbox", { name: "Character profile" }), { target: { value: "Updated profile" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Identity visual notes" }), { target: { value: "Oval face, narrow eyes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(updateAvatarDesign).toHaveBeenCalledWith("avatar_1", expect.objectContaining({ expected_revision: 1, confirmed: false, profile: "Updated profile" })));
  await waitFor(() => expect(screen.getByRole("button", { name: /Mira.*v2/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Confirm design" }));
  await waitFor(() => expect(updateAvatarDesign).toHaveBeenCalledWith("avatar_1", expect.objectContaining({ expected_revision: 2, confirmed: true })));
  expect(createLibraryAsset).not.toHaveBeenCalled();
});

it("shows a historical design without replacing the current editor", async () => {
  listAvatarCharacters.mockResolvedValue({ characters: [{ character_id: "avatar_1", name: "Mira", profile: "Profile", design_revision: 2,
    character_design: { design_draft: { identity: { visual_notes: "Current face" } }, design_revisions: [] },
    revision_history: [{ design_revision: 1, review_status: "draft" }], review_status: "draft" }] });
  agentRequest.mockResolvedValue({ models: [] });
  listLibraryAssets.mockResolvedValue({ characters: [] });
  getAvatarCharacter.mockResolvedValue({ character_id: "avatar_1", name: "Mira", design_revision: 1,
    character_design: { design_draft: { identity: { visual_notes: "Old face" } }, design_revisions: [] }, review_status: "draft" });
  render(<AvatarWorkbench />);
  fireEvent.click(await screen.findByRole("button", { name: /Mira.*v2/ }));
  fireEvent.click(screen.getByRole("button", { name: "v1 · draft" }));
  expect(await screen.findByRole("region", { name: "Historical design preview" })).toHaveTextContent("Old face");
  expect(screen.getByRole("textbox", { name: "Identity visual notes" })).toHaveValue("Current face");
});

it("uses an explicit material reference and publishes only the confirmed design", async () => {
  const confirmedDesign = { route: "realistic-modern", identity: { visual_notes: "Confirmed face" } };
  listAvatarCharacters.mockResolvedValue({ characters: [{ character_id: "avatar_1", name: "Mira", profile: "Profile", design_revision: 3,
    character_design: { design_draft: confirmedDesign, design_revisions: [{ revision: 3, design: confirmedDesign }] }, review_status: "confirmed" }] });
  listLibraryAssets.mockResolvedValue({ characters: [{ id: "ref_1", name: "Reference A", description: "Reference description" }] });
  agentRequest.mockResolvedValue({ models: [{ id: "m", api_model_id: "m", display_name: "Model" }] });
  createLibraryAsset.mockResolvedValue({ id: "lib_2", name: "Mira", description: "Confirmed face" });
  render(<AvatarWorkbench />);
  fireEvent.click(await screen.findByRole("button", { name: /Mira.*v3/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Reference A" }));
  expect(screen.getByRole("button", { name: "Reference A" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByRole("textbox", { name: "Identity visual notes" }), { target: { value: "Unsaved face" } });
  fireEvent.click(screen.getByRole("button", { name: "Add character material" }));
  await waitFor(() => expect(createLibraryAsset).toHaveBeenCalledWith("character", {
    name: "Mira", description: "Confirmed face", persona: "Profile",
  }));
});
