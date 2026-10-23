import type { UnlockedAchievement } from "@types";

const UNRESOLVED_RETRY_INTERVAL_MS = 60_000;

interface EpicLocalAchievements {
  resolved: Map<string, UnlockedAchievement>;
  unresolved: Map<string, UnlockedAchievement>;
  lastResolveAttemptAt: number;
}

const entries = new Map<string, EpicLocalAchievements>();

const getEntry = (gameKey: string) => {
  const entry = entries.get(gameKey) ?? {
    resolved: new Map(),
    unresolved: new Map(),
    lastResolveAttemptAt: 0,
  };
  entries.set(gameKey, entry);
  return entry;
};

/**
 * Epic unlocks read from local files during this session.
 *
 * Epic games also hold unlocks imported from the Epic account, which must
 * never be uploaded as Hydra unlocks, so only this set is synchronized.
 * Unlocks whose Epic id is not in the catalogue yet wait here until the
 * catalogue can resolve them.
 */
export const EpicLocalAchievementStore = {
  /** Keeps the first observation, since some files have no unlock time. */
  addResolved(gameKey: string, achievements: UnlockedAchievement[]) {
    const { resolved } = getEntry(gameKey);

    for (const achievement of achievements) {
      const key = achievement.name.toUpperCase();
      if (!resolved.has(key)) resolved.set(key, achievement);
    }
  },

  /** Replaces the unlocks still waiting for the catalogue, keyed by Epic id. */
  setUnresolved(
    gameKey: string,
    achievements: UnlockedAchievement[],
    attemptedAt = Date.now()
  ) {
    const entry = getEntry(gameKey);
    const previous = entry.unresolved;

    entry.unresolved = new Map(
      achievements.map((achievement) => [
        achievement.name,
        previous.get(achievement.name) ?? achievement,
      ])
    );
    entry.lastResolveAttemptAt = attemptedAt;
  },

  getResolved(gameKey: string): UnlockedAchievement[] {
    return [...(entries.get(gameKey)?.resolved.values() ?? [])];
  },

  getUnresolved(gameKey: string): UnlockedAchievement[] {
    return [...(entries.get(gameKey)?.unresolved.values() ?? [])];
  },

  shouldRetryUnresolved(gameKey: string, now = Date.now()) {
    const entry = entries.get(gameKey);

    return Boolean(
      entry?.unresolved.size &&
        now - entry.lastResolveAttemptAt >= UNRESOLVED_RETRY_INTERVAL_MS
    );
  },

  delete(gameKey: string) {
    entries.delete(gameKey);
  },

  clear() {
    entries.clear();
  },
};
