import type { SteamGameSyncPayload } from "../../../types/steam-integration.types.js";

const EXIT_SYNC_DELAYS_MS = [10_000, 30_000] as const;

export const shouldScheduleSteamGameExitSync = (
  shop: string,
  countHydraPlaytime: boolean
) => shop === "steam" && !countHydraPlaytime;

type TimerHandle = ReturnType<typeof setTimeout>;

type ExitSyncDependencies = {
  waitForFullSync: () => Promise<void>;
  collect: (
    steamAppId: string,
    signal: AbortSignal
  ) => Promise<SteamGameSyncPayload>;
  publish: (
    steamAppId: string,
    payload: SteamGameSyncPayload,
    signal: AbortSignal
  ) => Promise<void>;
  scheduleTimer: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer: (timer: TimerHandle) => void;
  log: (message: string, ...args: unknown[]) => void;
  logError: (message: string, ...args: unknown[]) => void;
};

type PendingExitSync = {
  abortController: AbortController;
  timers: TimerHandle[];
  attempts: Set<Promise<void>>;
  firstAttemptPromise: Promise<void> | null;
  secondFinished: boolean;
  firstSucceeded: boolean;
  lastPublishedPayload: SteamGameSyncPayload | null;
};

const achievementFingerprint = (
  achievements: SteamGameSyncPayload["achievements"]
) =>
  achievements
    ?.map(({ name, unlockTime }) => ({ name, unlockTime }))
    .sort((left, right) =>
      `${left.name}:${left.unlockTime}`.localeCompare(
        `${right.name}:${right.unlockTime}`
      )
    );

const hasChanged = (
  previous: SteamGameSyncPayload,
  current: SteamGameSyncPayload
) => {
  if (
    previous.playTimeInSeconds !== current.playTimeInSeconds ||
    previous.lastPlayedAt !== current.lastPlayedAt
  ) {
    return true;
  }

  if (current.achievements === undefined) return false;

  return (
    JSON.stringify(achievementFingerprint(previous.achievements)) !==
    JSON.stringify(achievementFingerprint(current.achievements))
  );
};

export const createSteamGameExitSyncScheduler = (
  dependencies: ExitSyncDependencies
) => {
  const pendingByGameKey = new Map<string, PendingExitSync>();

  const cancel = (gameKey: string) => {
    const pending = pendingByGameKey.get(gameKey);
    if (!pending) return;

    pending.abortController.abort();
    for (const timer of pending.timers) dependencies.clearTimer(timer);
    pendingByGameKey.delete(gameKey);
    dependencies.log("Cancelled Steam game exit sync", gameKey);
  };

  const runAttempt = async (
    gameKey: string,
    steamAppId: string,
    attempt: 0 | 1,
    pending: PendingExitSync
  ) => {
    if (pendingByGameKey.get(gameKey) !== pending) return;

    try {
      await dependencies.waitForFullSync();
      if (pendingByGameKey.get(gameKey) !== pending) return;

      const payload = await dependencies.collect(
        steamAppId,
        pending.abortController.signal
      );
      if (pendingByGameKey.get(gameKey) !== pending) return;

      if (attempt === 1 && pending.firstAttemptPromise) {
        await pending.firstAttemptPromise;
        if (pendingByGameKey.get(gameKey) !== pending) return;
      }

      const shouldPublish =
        attempt === 0 ||
        !pending.firstSucceeded ||
        !pending.lastPublishedPayload ||
        hasChanged(pending.lastPublishedPayload, payload);

      if (shouldPublish) {
        await dependencies.publish(
          steamAppId,
          payload,
          pending.abortController.signal
        );
        pending.lastPublishedPayload = payload;
      }

      if (attempt === 0) pending.firstSucceeded = true;
      dependencies.log("Steam game exit sync finished", gameKey, attempt + 1, {
        published: shouldPublish,
      });
    } catch (error) {
      if (pending.abortController.signal.aborted) return;

      if (attempt === 0) {
        pending.firstSucceeded = false;
        dependencies.log("First Steam game exit sync failed", gameKey, error);
      } else {
        dependencies.logError(
          "Steam game exit sync failed after both attempts",
          gameKey,
          error
        );
      }
    } finally {
      if (attempt === 1) pending.secondFinished = true;
    }
  };

  const schedule = (gameKey: string, steamAppId: string) => {
    cancel(gameKey);

    const pending: PendingExitSync = {
      abortController: new AbortController(),
      timers: [],
      attempts: new Set(),
      firstAttemptPromise: null,
      secondFinished: false,
      firstSucceeded: false,
      lastPublishedPayload: null,
    };
    pendingByGameKey.set(gameKey, pending);

    for (const [attempt, delayMs] of EXIT_SYNC_DELAYS_MS.entries()) {
      const timer = dependencies.scheduleTimer(() => {
        const attemptPromise = runAttempt(
          gameKey,
          steamAppId,
          attempt as 0 | 1,
          pending
        );
        if (attempt === 0) pending.firstAttemptPromise = attemptPromise;
        pending.attempts.add(attemptPromise);
        void attemptPromise.finally(() => {
          pending.attempts.delete(attemptPromise);
          if (
            pending.secondFinished &&
            pending.attempts.size === 0 &&
            pendingByGameKey.get(gameKey) === pending
          ) {
            pendingByGameKey.delete(gameKey);
          }
        });
      }, delayMs);
      timer.unref?.();
      pending.timers.push(timer);
    }

    dependencies.log("Scheduled Steam game exit sync", gameKey, [
      ...EXIT_SYNC_DELAYS_MS,
    ]);
  };

  return {
    schedule,
    cancel,
    waitForPending: (gameKey: string) => {
      const pending = pendingByGameKey.get(gameKey);
      return pending
        ? Promise.all([...pending.attempts]).then(() => undefined)
        : Promise.resolve();
    },
  };
};
