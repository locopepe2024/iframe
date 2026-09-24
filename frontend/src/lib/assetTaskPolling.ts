import type { Project } from "@/store/projectStore";

export type TaskStatus = { status?: string; error?: string };

/** Avoid duplicate terminal notifications when a slow status request overlaps the next poll tick. */
export function createSingleFlightTaskStatusPoller<T>(
  read: () => Promise<T>,
  isTerminal: (status: T) => boolean,
  onStatus: (status: T) => void | Promise<void>,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let terminal = false;

  return () => {
    if (inFlight) return inFlight;
    if (terminal) return Promise.resolve();

    let request: Promise<void>;
    request = Promise.resolve()
      .then(read)
      .then(async (status) => {
        terminal = isTerminal(status);
        await onStatus(status);
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  };
}

/** Remove the backend's Chinese failure wrapper before adding a localized UI title. */
export function normalizeTaskFailureDetail(error: unknown): string {
  return String(error ?? "").trim().replace(/^(?:生成失败：\s*)+/, "").trim();
}

export type AssetTaskResult = TaskStatus & {
  script_id?: string;
  asset_id?: string;
  asset_type?: "character" | "scene" | "prop" | "full_body" | "head_shot";
  asset_source?: "episode" | "series" | "global";
  asset?: Record<string, any>;
};

/** Merge one completed task's target asset snapshot into the current project. */
export function mergeAssetTaskResult(
  project: Project | null | undefined,
  status: AssetTaskResult,
): Partial<Project> | null {
  if (!project || !status.asset || !status.asset_type) return null;
  if (status.status && status.status !== "completed") return null;
  if (status.script_id && status.script_id !== project.id) return null;
  if (status.asset.id && status.asset_id && status.asset.id !== status.asset_id) return null;

  const collection = status.asset_type === "character" || status.asset_type === "full_body" || status.asset_type === "head_shot"
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

  const index = assets.findIndex((asset) => asset.id === assetId);
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

/** Polling observes task state; transport errors and elapsed time are not terminal states. */
export async function waitForAssetTask(
  read: () => Promise<AssetTaskResult>,
  observing: () => boolean,
  failureMessage: string,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 2000)),
): Promise<AssetTaskResult | null> {
  while (observing()) {
    await pause();
    if (!observing()) return null;
    let task: AssetTaskResult;
    try {
      task = await read();
    } catch {
      continue;
    }
    if (task.status === "completed") return task;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      throw new Error(task.error || failureMessage);
    }
  }
  return null;
}
