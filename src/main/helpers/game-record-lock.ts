const gameRecordLockQueues = new Map<string, Promise<unknown>>();

// Serializes read-modify-write updates to a single game's record across
// event handlers (e.g. manual "set executable path" vs. the post-install
// rescan) so a slow write from one can't be clobbered by a stale write
// from the other racing it.
export const withGameRecordLock = <T>(
  gameKey: string,
  task: () => Promise<T>
): Promise<T> => {
  const previous = gameRecordLockQueues.get(gameKey) ?? Promise.resolve();
  const next = previous.then(task, task);

  gameRecordLockQueues.set(
    gameKey,
    next.then(
      () => undefined,
      () => undefined
    )
  );

  return next;
};
