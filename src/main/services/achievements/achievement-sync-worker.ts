import { randomUUID } from "node:crypto";
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
import { PendingAchievementSouvenirStore } from "./pending-achievement-souvenir-store";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
  ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
  ACHIEVEMENT_SYNC_RETRY_DELAY_MS,
  ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS,
  ACHIEVEMENT_SYNC_MAX_TIMER_DELAY_MS,
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
      : NaN;
  const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
  const serverDelay = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Number.isFinite(date)
      ? Math.max(0, date - Date.now())
      : 0;
  const backoff = Math.min(
    ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS,
    ACHIEVEMENT_SYNC_RETRY_DELAY_MS * 2 ** Math.min(attempts, 6)
  );
  return Math.max(serverDelay, backoff + (Math.random() * backoff) / 4);
};

export const toAchievementSyncPayload = (item: PendingAchievementSync) => ({
  id: item.remoteId,
  achievements: item.achievements.map((achievement) => ({
    name: achievement.name,
    unlockTime: achievement.unlockTime,
    ...(achievement.hardcoreUnlockTime != null && {
      hardcoreUnlockTime: achievement.hardcoreUnlockTime,
    }),
  })),
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
    await pending.put(key, {
      ...item,
      achievements: mergeUnlockedAchievementLists(
        item.achievements,
        previous?.achievements ?? []
      ),
      revision: randomUUID(),
      attempts: 0,
      nextAttemptAt: 0,
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
      const key = keyOf(item.context, item.gameKey);
      try {
        const response = await achievementSyncCoordinator.runRequest(
          item.gameKey,
          () =>
            HydraApi.put<UpdatedUnlockedAchievements | undefined>(
              "/profile/games/achievements",
              toAchievementSyncPayload(item),
              {
                authContext: item.context,
                timeout: ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
              }
            ),
          () => HydraApi.isAuthContextCurrent(item.context)
        );
        await achievementSyncCoordinator.runMerge(
          item.gameKey,
          async (current) => {
            if (response) await reconcileAchievementMemory(response, current);
            if (!current()) throw new AchievementSyncCancelledError();
            await PendingAchievementSouvenirStore.clearSynced(
              item.gameKey,
              item.achievements
            );
            const latest = await pending.get(key).catch(() => null);
            if (latest?.revision === item.revision) await pending.del(key);
          },
          () => HydraApi.isAuthContextCurrent(item.context)
        );
      } catch (error) {
        if (
          error instanceof AchievementSyncCancelledError ||
          !HydraApi.isAuthContextCurrent(item.context)
        )
          return;
        try {
          await achievementSyncCoordinator.runMerge(
            item.gameKey,
            async () => {
              const latest = await pending.get(key).catch(() => null);
              if (latest?.revision !== item.revision) return;
              // Keep local unlocks durable even if an older server cannot accept them yet.
              await pending.put(key, {
                ...item,
                terminal:
                  isAxiosError(error) &&
                  Boolean(
                    error.response?.status &&
                      error.response.status < 500 &&
                      ![408, 409, 429].includes(error.response.status)
                  ),
                attempts: item.attempts + 1,
                nextAttemptAt:
                  Date.now() +
                  getAchievementSyncRetryDelay(error, item.attempts),
              });
            },
            () => HydraApi.isAuthContextCurrent(item.context)
          );
        } catch (persistenceError) {
          if (persistenceError instanceof AchievementSyncCancelledError) return;
          throw persistenceError;
        }
        if (!HydraApi.isAuthContextCurrent(item.context)) return;
        achievementsLogger.error(
          "Achievement synchronization retained for retry",
          item.gameKey,
          error
        );
      }
    }
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
