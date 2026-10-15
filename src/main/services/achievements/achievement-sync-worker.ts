import { randomInt, randomUUID } from "node:crypto";
import type {
  GameShop,
  UnlockedAchievement,
  UpdatedUnlockedAchievements,
} from "@types";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { HydraApi } from "../hydra-api";
import { db } from "@main/level";
import { achievementsLogger } from "../logger";
import { reconcileAchievementMemory } from "./reconcile-achievement-memory";
import { mergeUnlockedAchievementLists } from "./merge-unlocked-achievements";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
  ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
  ACHIEVEMENT_SYNC_RETRY_DELAY_MS,
  ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS,
  ACHIEVEMENT_SYNC_MAX_RETRY_EXPONENT,
  ACHIEVEMENT_SYNC_RETRY_JITTER_DIVISOR,
  ACHIEVEMENT_SYNC_MAX_TIMER_DELAY_MS,
  ACHIEVEMENT_SYNC_RETRYABLE_CLIENT_STATUSES,
} from "./achievement-sync-coordinator";
import { isAxiosError } from "axios";

export type PendingAchievementSync = {
  revision: string;
  context: HydraApiAuthContext;
  gameKey: string;
  remoteId: string;
  shop: GameShop;
  objectId: string;
  achievements: UnlockedAchievement[];
  attempts: number;
  nextAttemptAt: number;
  terminal?: boolean;
};

const pending = db.sublevel<string, PendingAchievementSync>(
  "pending-achievement-sync",
  { valueEncoding: "json" }
);

const keyOf = (context: HydraApiAuthContext, gameKey: string) =>
  JSON.stringify([context.environment, context.userId, gameKey]);

export const getAchievementSyncRetryDelay = (
  error: unknown,
  attempts: number
) => {
  const retryAfter = isAxiosError(error)
    ? error.response?.headers?.["retry-after"]
    : undefined;
  const seconds =
    typeof retryAfter === "string" || typeof retryAfter === "number"
      ? Number(retryAfter)
      : Number.NaN;
  const date =
    typeof retryAfter === "string" ? Date.parse(retryAfter) : Number.NaN;
  let serverDelay = 0;
  if (Number.isFinite(seconds)) serverDelay = seconds * 1000;
  else if (Number.isFinite(date)) serverDelay = date - Date.now();
  const backoff = Math.min(
    ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS,
    ACHIEVEMENT_SYNC_RETRY_DELAY_MS *
      2 ** Math.min(attempts, ACHIEVEMENT_SYNC_MAX_RETRY_EXPONENT)
  );
  const jitter = randomInt(
    0,
    Math.floor(backoff / ACHIEVEMENT_SYNC_RETRY_JITTER_DIVISOR) + 1
  );
  return Math.max(
    Math.min(serverDelay, ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS),
    backoff + jitter
  );
};

export const isRetryableAchievementSyncStatus = (status: number) =>
  status >= 500 || ACHIEVEMENT_SYNC_RETRYABLE_CLIENT_STATUSES.includes(status);

export const toAchievementSyncEntry = ({
  name,
  unlockTime,
  hardcoreUnlockTime,
}: UnlockedAchievement) =>
  hardcoreUnlockTime == null
    ? { name, unlockTime }
    : { name, unlockTime: hardcoreUnlockTime, hardcore: true };

export const toAchievementSyncPayload = (item: PendingAchievementSync) => ({
  id: item.remoteId,
  achievements: item.achievements.map(toAchievementSyncEntry),
});

export class AchievementSyncWorker {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async enqueue(
    item: Omit<
      PendingAchievementSync,
      "revision" | "attempts" | "nextAttemptAt"
    >
  ) {
    if (!HydraApi.isAuthContextCurrent(item.context)) return;
    const key = keyOf(item.context, item.gameKey);
    const previous = await pending.get(key).catch(() => null);
    const retry = previous?.terminal ? undefined : previous;
    await pending.put(key, {
      ...item,
      achievements: mergeUnlockedAchievementLists(
        item.achievements,
        previous?.achievements ?? []
      ),
      revision: randomUUID(),
      attempts: retry?.attempts ?? 0,
      nextAttemptAt: retry?.nextAttemptAt ?? 0,
    });
  }

  trigger() {
    if (!this.running) {
      this.running = this.run()
        .catch((error) =>
          achievementsLogger.error(
            "Failed to process pending achievement synchronization",
            error
          )
        )
        .finally(() => {
          this.running = null;
          void this.schedule().catch((error) =>
            achievementsLogger.error(
              "Failed to schedule achievement synchronization",
              error
            )
          );
        });
    }
    return this.running;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async cancelGame(gameKey: string) {
    const context = HydraApi.getAuthContext();
    if (context) await pending.del(keyOf(context, gameKey));
  }

  private async records() {
    const context = HydraApi.getAuthContext();
    if (!context) return [];
    return (await pending.values().all())
      .filter(
        (item) =>
          item.context.environment === context.environment &&
          item.context.userId === context.userId
      )
      .map((item) => ({ ...item, context }));
  }

  private async run() {
    while (HydraApi.getAuthContext()) {
      const item = (await this.records()).find(
        (row) => !row.terminal && row.nextAttemptAt <= Date.now()
      );
      if (!item) return;
      if (!(await this.synchronize(item))) return;
    }
  }

  private async synchronize(item: PendingAchievementSync): Promise<boolean> {
    const key = keyOf(item.context, item.gameKey);
    const current = achievementSyncCoordinator.captureCurrent(
      item.gameKey,
      () => HydraApi.isAuthContextCurrent(item.context)
    );
    try {
      const response = await achievementSyncCoordinator.runRequest(
        item.gameKey,
        async () => {
          const latest = await pending.get(key).catch(() => null);
          if (!current() || latest?.revision !== item.revision)
            throw new AchievementSyncCancelledError();
          return HydraApi.put<UpdatedUnlockedAchievements | undefined>(
            "/profile/games/achievements",
            toAchievementSyncPayload(item),
            {
              authContext: item.context,
              timeout: ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
            }
          );
        },
        current
      );
      await achievementSyncCoordinator.runMerge(
        item.gameKey,
        async (valid) => {
          if (response) await reconcileAchievementMemory(response, valid);
          if (!valid()) throw new AchievementSyncCancelledError();
          const latest = await pending.get(key).catch(() => null);
          if (latest?.revision === item.revision) await pending.del(key);
        },
        current
      );
      return true;
    } catch (error) {
      if (error instanceof AchievementSyncCancelledError || !current())
        return false;
      return this.retainForRetry(item, error);
    }
  }

  private async retainForRetry(
    item: PendingAchievementSync,
    error: unknown
  ): Promise<boolean> {
    const current = () => HydraApi.isAuthContextCurrent(item.context);
    const key = keyOf(item.context, item.gameKey);
    try {
      await achievementSyncCoordinator.runMerge(
        item.gameKey,
        async () => {
          const latest = await pending.get(key).catch(() => null);
          if (!latest) return;
          const attempts = Math.max(latest.attempts, item.attempts);
          const status = isAxiosError(error)
            ? error.response?.status
            : undefined;
          const terminal =
            status !== undefined && !isRetryableAchievementSyncStatus(status);
          await pending.put(key, {
            ...latest,
            terminal: latest.revision === item.revision && terminal,
            attempts: attempts + 1,
            nextAttemptAt: Math.max(
              latest.nextAttemptAt,
              Date.now() + getAchievementSyncRetryDelay(error, attempts)
            ),
          });
        },
        current
      );
    } catch (persistenceError) {
      if (persistenceError instanceof AchievementSyncCancelledError)
        return false;
      throw persistenceError;
    }
    if (!current()) return false;
    achievementsLogger.error(
      "Achievement synchronization retained for retry",
      item.gameKey,
      error
    );
    return true;
  }

  private async schedule() {
    this.stop();
    const items = (await this.records()).filter((item) => !item.terminal);
    if (!items.length) return;
    const at = Math.min(...items.map((item) => item.nextAttemptAt));
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.trigger();
      },
      Math.min(
        ACHIEVEMENT_SYNC_MAX_TIMER_DELAY_MS,
        Math.max(ACHIEVEMENT_SYNC_RETRY_DELAY_MS, at - Date.now())
      )
    );
    this.timer.unref?.();
  }
}

export const achievementSyncWorker = new AchievementSyncWorker();
