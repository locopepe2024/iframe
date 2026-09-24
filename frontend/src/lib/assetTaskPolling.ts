import type { Project } from "@/store/projectStore";

export type TaskStatus = { status?: string; error?: string };

export type AssetIndexState = "valid" | "stale" | "empty" | "legacy";

export const ASSET_TASK_OBSERVATION_TIMEOUT_MS = 30 * 60 * 1000;
const EXPIRED_TASK_STATUS_CHECK_TIMEOUT_MS = 5_000;

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

export type AssetTaskPollingOptions = {
  timeoutMs?: number;
  startedAt?: number;
  now?: () => number;
};

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

/** Poll server task state with transient retries bounded by one absolute deadline. */
export async function waitForAssetTask(
  read: () => Promise<AssetTaskResult>,
  observing: () => boolean,
  failureMessage: string,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 2000)),
  options: AssetTaskPollingOptions = {},
): Promise<AssetTaskResult | null> {
  const now = options.now ?? Date.now;
  const timeoutMs = Math.max(0, options.timeoutMs ?? ASSET_TASK_OBSERVATION_TIMEOUT_MS);
  const startedAt = Number.isFinite(options.startedAt) ? options.startedAt! : now();
  const deadline = startedAt + timeoutMs;
  let attemptedRead = false;

  while (observing()) {
    if (attemptedRead && now() >= deadline) {
      return { status: "timed_out" };
    }

    if (now() < deadline) {
      await pause();
      if (!observing()) return null;
    }

    const remainingMs = deadline - now();
    const readTimeoutMs = remainingMs > 0
      ? remainingMs
      : attemptedRead
        ? 0
        : EXPIRED_TASK_STATUS_CHECK_TIMEOUT_MS;
    if (readTimeoutMs <= 0) return { status: "timed_out" };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      Promise.resolve().then(read).then(
        value => ({ kind: "value" as const, value }),
        error => ({ kind: "error" as const, error }),
      ),
      new Promise<{ kind: "timeout" }>(resolve => {
        timeoutId = setTimeout(() => resolve({ kind: "timeout" }), readTimeoutMs);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });

    if (!observing()) return null;
    attemptedRead = true;

    if (outcome.kind === "timeout") return { status: "timed_out" };
    if (outcome.kind === "error") {
      const error = outcome.error as any;
      if (error?.response?.status === 404 || error?.status === 404) {
        return { status: "missing", error: "Task is no longer available" };
      }
      if (now() >= deadline) return { status: "timed_out" };
      continue;
    }

    const task = outcome.value;
    if (task.status === "completed") return task;
    if (task.status === "cleared") return task;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      throw new AssetTaskFailure(task.error || failureMessage, task);
    }
    if (now() >= deadline) return { status: "timed_out" };
  }
  return null;
}
