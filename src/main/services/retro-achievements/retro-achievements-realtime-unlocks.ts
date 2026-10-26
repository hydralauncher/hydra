import type { Game, UserPreferences } from "@types";

import { db, levelKeys } from "@main/level";
import { achievementsLogger } from "../logger";
import { WindowManager } from "../window-manager";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { publishAchievementUnlockNotifications } from "../achievements/achievement-unlock-notifications";
import { syncRetroAchievements } from "./retro-achievements-sync";
import {
  createRetroAchievementsUnlockConfirmer,
  type DetectedRetroAchievementUnlock,
} from "./retro-achievements-unlock-confirmer";
import { loadRetroAchievementsEmulatorAccount } from "./retro-achievements-emulator-account";
import {
  countSessionUnlocks,
  retroAchievementKey,
  selectOptimisticUnlocks,
} from "./retro-achievements-optimistic-unlocks";

const loadUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

interface RealtimeUnlocksOptions {
  getEmulatorUsername?: () => Promise<string | null>;
}

export const createRetroAchievementsRealtimeUnlocks = (
  game: Game,
  { getEmulatorUsername }: RealtimeUnlocksOptions = {}
) => {
  const notifiedKeys = new Set<string>();
  let accountMatch: Promise<boolean> | null = null;

  const isEmulatorOnHydraAccount = () => {
    accountMatch ??= Promise.all([
      getEmulatorUsername?.().catch(() => null) ?? null,
      loadRetroAchievementsEmulatorAccount().catch(() => null),
    ]).then(([emulatorUsername, account]) => {
      if (!emulatorUsername || !account) return true;
      return emulatorUsername.toLowerCase() === account.username.toLowerCase();
    });
    return accountMatch;
  };

  const sync = () =>
    syncRetroAchievements({ objectId: game.objectId, shop: game.shop });

  const confirmer = createRetroAchievementsUnlockConfirmer({
    sync,
    wait: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
    onConfirmed: async (confirmed, achievements) => {
      achievementsLogger.info("Confirmed realtime RetroAchievements unlocks", {
        objectId: game.objectId,
        achievementIds: confirmed.map(({ name }) => name),
      });

      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${game.objectId}-${game.shop}`,
        achievements
      );

      const unnotified = confirmed.filter(
        ({ name }) => !notifiedKeys.has(retroAchievementKey(name))
      );
      if (unnotified.length === 0) return;

      for (const { name } of unnotified) {
        notifiedKeys.add(retroAchievementKey(name));
      }

      publishAchievementUnlockNotifications({
        game,
        achievements: unnotified,
        completesGame: achievements.every(({ unlocked }) => unlocked),
        unlockedAchievementCount: achievements.filter(
          ({ unlocked }) => unlocked
        ).length,
        totalAchievementCount: achievements.length,
        userPreferences: await loadUserPreferences(),
      });
    },
    onError: (error) => {
      achievementsLogger.error(
        "Failed to confirm realtime RetroAchievements unlocks",
        game.objectId,
        error
      );
    },
  });

  const notifyFromCache = async (
    detected: DetectedRetroAchievementUnlock[]
  ) => {
    const cached = AchievementMemoryStore.get(game.shop, game.objectId);
    if (!cached?.achievements.length) return;

    if (!(await isEmulatorOnHydraAccount())) {
      achievementsLogger.info(
        "Skipped instant RetroAchievements unlocks for a different emulator account",
        { objectId: game.objectId }
      );
      return;
    }

    const unlockedNames = cached.unlockedAchievements.map(({ name }) => name);
    const achievements = selectOptimisticUnlocks(
      detected,
      cached.achievements,
      unlockedNames,
      notifiedKeys
    );
    if (achievements.length === 0) return;

    for (const { name } of achievements) {
      notifiedKeys.add(retroAchievementKey(name));
    }

    const unlockedAchievementCount = countSessionUnlocks(
      cached.achievements,
      unlockedNames,
      notifiedKeys
    );

    achievementsLogger.info("Notified detected RetroAchievements unlocks", {
      objectId: game.objectId,
      achievementIds: achievements.map(({ name }) => name),
    });

    publishAchievementUnlockNotifications({
      game,
      achievements,
      completesGame: unlockedAchievementCount >= cached.achievements.length,
      unlockedAchievementCount,
      totalAchievementCount: cached.achievements.length,
      userPreferences: await loadUserPreferences(),
    });
  };

  return {
    prime: () => {
      void sync().catch((error) => {
        achievementsLogger.warn(
          "Failed to preload RetroAchievements for realtime unlocks",
          { objectId: game.objectId, error }
        );
      });
    },
    enqueue: async (detected: DetectedRetroAchievementUnlock[]) => {
      await notifyFromCache(detected).catch((error) => {
        achievementsLogger.error(
          "Failed to notify detected RetroAchievements unlocks",
          game.objectId,
          error
        );
      });
      return confirmer.enqueue(detected);
    },
  };
};
