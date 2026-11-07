export interface QuitTasksResult {
  failed: Array<{ label: string; reason: unknown }>;
  /** Labels of tasks that had not settled when the deadline passed. */
  pending: string[];
}

/**
 * Runs quit cleanup tasks concurrently and stops waiting after `timeoutMs`.
 * A task that never settles (for example a native shutdown blocked on disk or
 * network IO) must not keep a half-closed process alive.
 */
export async function runQuitTasks(
  tasks: Record<string, () => Promise<unknown>>,
  timeoutMs: number
): Promise<QuitTasksResult> {
  const pending = new Set(Object.keys(tasks));
  const failed: QuitTasksResult["failed"] = [];

  const settled = Promise.all(
    Object.entries(tasks).map(async ([label, run]) => {
      try {
        await run();
      } catch (reason) {
        failed.push({ label, reason });
      } finally {
        pending.delete(label);
      }
    })
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([settled, deadline]);
  } finally {
    clearTimeout(timer);
  }

  return { failed: [...failed], pending: [...pending] };
}
