import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AssetInspector from "./AssetInspector";
import { useProjectStore } from "@/store/projectStore";

const mocked = vi.hoisted(() => ({ setAssetCoverVariant: vi.fn(), getAssetRevisions: vi.fn(),
  confirmAssetRevision: vi.fn(), getProject: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ api: mocked, API_URL: "" }));
vi.mock("@/store/toastStore", () => ({ toast: { success: mocked.success, error: mocked.error, progress: vi.fn(), update: vi.fn() } }));

const asset = {
  id: "character-1",
  name: "Test character",
  description: "",
  cover_variant_id: "cover-1",
  reference_sheet: {
    selected_image_id: "cover-1",
    image_variants: [
      { id: "cover-1", url: "assets/cover.png", created_at: 1 },
      { id: "headshot-variant", url: "assets/headshot.png", created_at: 2 },
    ],
  },
};
const result = {
  asset_type: "character" as const,
  asset_id: "character-1",
  cover_variant_id: "headshot-variant",
  variant: { id: "headshot-variant", url: "assets/headshot.png", created_at: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ currentProject: null, projects: [] });
  mocked.setAssetCoverVariant.mockResolvedValue(result);
  mocked.getAssetRevisions.mockResolvedValue({ current_revision: 1, revisions: [] });
  mocked.confirmAssetRevision.mockResolvedValue({ revision: { revision: 2 } });
  mocked.getProject.mockResolvedValue({ id: "project-1" });
});

it("confirms variants across all character image containers", async () => {
  const character = {
    ...asset,
    full_body_asset: { selected_id: "full-body", variants: [
      { id: "full-body", url: "assets/full-body.png", created_at: 3 },
    ] },
  };
  render(<AssetInspector asset={character as any} type="characters" sourceName="Episode 1"
    sourceId="project-project-1" sourceKind="project" starred={false}
    onClose={vi.fn()} onToggleStar={vi.fn()} />);

  await screen.findByRole("button", { name: "confirmAssetRevision" });
  fireEvent.click(screen.getByRole("button", { name: "confirmAssetRevision" }));

  await waitFor(() => expect(mocked.confirmAssetRevision).toHaveBeenCalledWith(
    "project-1", "character", "character-1", 1,
    ["cover-1", "headshot-variant", "full-body"], "cover-1",
  ));
});

it("persists an explicitly chosen cover and reports the saved result", async () => {
  const onCoverUpdated = vi.fn();
  render(
    <AssetInspector
      asset={asset as any}
      type="characters"
      sourceName="Episode 1"
      sourceId="project-project-1"
      sourceKind="project"
      starred={false}
      onClose={vi.fn()}
      onToggleStar={vi.fn()}
      onCoverUpdated={onCoverUpdated}
    />,
  );

  fireEvent.click(screen.getAllByRole("button", { name: "variantAlt" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "setAsCover" }));

  await waitFor(() => expect(mocked.setAssetCoverVariant).toHaveBeenCalledWith(
    "project-1", "character-1", "character", "headshot-variant",
  ));
  expect(onCoverUpdated).toHaveBeenCalledWith(result);
  expect(mocked.success).toHaveBeenCalledWith("coverUpdated");
});
