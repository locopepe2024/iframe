type TaskStatus = { status?: string; error?: string };

/** Polling observes task state; transport errors and elapsed time are not terminal states. */
export async function waitForAssetTask(
  read: () => Promise<TaskStatus>,
  observing: () => boolean,
  failureMessage: string,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 2000)),
): Promise<boolean> {
  while (observing()) {
    await pause();
    if (!observing()) return false;
    let task: TaskStatus;
    try {
      task = await read();
    } catch {
      continue;
    }
    if (task.status === "completed") return true;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      throw new Error(task.error || failureMessage);
    }
  }
  return false;
}
