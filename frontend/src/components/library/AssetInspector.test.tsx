import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AssetInspector from "./AssetInspector";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ api: { selectAssetVariant: vi.fn() } }));

const original = {
  id: "character-1",
  name: "Test character",
  description: "",
  reference_sheet: {
    selected_image_id: "cover-1",
    image_variants: [
      { id: "cover-1", url: "cover-1.png" },
      { id: "candidate-2", url: "candidate-2.png" },
    ],
  },
};

const selected = {
  ...original,
  reference_sheet: { ...original.reference_sheet, selected_image_id: "candidate-2" },
};

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    currentProject: { id: "project-1", characters: [original], scenes: [], props: [] } as any,
    projects: [{ id: "project-1", characters: [original], scenes: [], props: [] } as any],
  });
  vi.mocked(api.selectAssetVariant).mockResolvedValue({
    id: "project-1",
    characters: [selected],
    scenes: [],
    props: [],
  } as any);
});

it("persists a generated candidate as the library cover only after explicit selection", async () => {
  const onAssetUpdated = vi.fn();
  render(
    <AssetInspector
      asset={original as any}
      type="characters"
      sourceName="Episode 1"
      sourceId="project-project-1"
      sourceKind="project"
      starred={false}
      onClose={vi.fn()}
      onToggleStar={vi.fn()}
      onAssetUpdated={onAssetUpdated}
    />,
  );

  fireEvent.click(screen.getAllByRole("button", { name: "variantAlt" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "setAsCover" }));

  await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledWith(
    "project-1", "character-1", "character", "candidate-2", "reference_sheet",
  ));
  expect(onAssetUpdated).toHaveBeenCalledWith(selected);
  expect(useProjectStore.getState().projects[0].characters?.[0]?.reference_sheet?.selected_image_id)
    .toBe("candidate-2");
});
