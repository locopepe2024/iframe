import type { Project } from "@/store/projectStore";

export type TaskStatus = { status?: string; error?: string };

export type AssetIndexState = "valid" | "stale" | "empty" | "legacy";

export type AssetTaskResult = TaskStatus & {
  task_id?: string;
  script_id?: string;
  asset_id?: string;
  asset_type?: "character" | "scene" | "prop" | "full_body" | "head_shot";
  asset_source?: "episode" | "series" | "global";
  asset_index_state?: AssetIndexState;
  asset?: Record<string, any>;
};

export class AssetTaskFailure extends Error {
  constructor(message: string, readonly task: AssetTaskResult) {
    super(message);
    this.name = "AssetTaskFailure";
  }
}

/** Merge one task's target-asset snapshot into the current project. */
export function mergeAssetTaskResult(
  project: Project | null | undefined,
  status: AssetTaskResult,
): Partial<Project> | null {
  if (!project || !status.asset || !status.asset_type) return null;
  if (status.asset.id && status.asset_id && status.asset.id !== status.asset_id) return null;

  const collection = status.asset_type === "character"
    ? "characters"
    : status.asset_type === "scene"
      ? "scenes"
      : status.asset_type === "prop"
        ? "props"
        : null;
  if (!collection) return null;
  const assets: any[] = collection === "characters"
    ? project.characters ?? []
    : collection === "scenes"
      ? project.scenes ?? []
      : project.props ?? [];
  const assetId = status.asset_id || status.asset.id;
  if (!assetId) return null;

  const index = assets.findIndex(asset => asset.id === assetId);
  const existing = index >= 0 ? assets[index] : undefined;
  const updated = {
    ...existing,
    ...status.asset,
    id: assetId,
    source: status.asset.source || status.asset_source || existing?.source,
  };
  const nextAssets = [...assets];
  if (index >= 0) nextAssets[index] = updated;
  else nextAssets.push(updated);
  return { [collection]: nextAssets } as Partial<Project>;
}

/** Inspect the selected image pointer without claiming that its file is readable. */
export function getAssetIndexState(asset: Record<string, any> | null | undefined, type: string): AssetIndexState {
  if (!asset) return "empty";
  const containers = type === "character"
    ? [
        asset.reference_sheet,
        asset.full_body,
        asset.three_views,
        asset.head_shot,
        asset.full_body_asset,
        asset.three_view_asset,
        asset.headshot_asset,
      ]
    : [asset.image_asset];

  for (const container of containers) {
    if (!container) continue;
    const selectedId = container.selected_image_id ?? container.selected_id;
    if (!selectedId) continue;
    const variants = container.image_variants ?? container.variants ?? [];
    const selected = variants.find((variant: any) => variant.id === selectedId);
    return selected?.url ? "valid" : "stale";
  }

  const legacyUrls = type === "character"
    ? [asset.full_body_image_url, asset.three_view_image_url, asset.headshot_image_url, asset.image_url, asset.avatar_url]
    : [asset.image_url];
  return legacyUrls.some(Boolean) ? "legacy" : "empty";
}

/** Polling observes server task state; transient transport errors are not terminal. */
export async function waitForAssetTask(
  read: () => Promise<AssetTaskResult>,
  observing: () => boolean,
  failureMessage: string,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 2000)),
): Promise<AssetTaskResult | null> {
  while (observing()) {
    await pause();
    if (!observing()) return null;
    let task: AssetTaskResult;
    try {
      task = await read();
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.status === 404) {
        return { status: "missing", error: "Task is no longer available" };
      }
      continue;
    }
    if (task.status === "completed") return task;
    if (task.status === "cleared") return task;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      throw new AssetTaskFailure(task.error || failureMessage, task);
    }
  }
  return null;
}
