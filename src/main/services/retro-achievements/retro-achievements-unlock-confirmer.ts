import type { UserAchievement } from "@types";

export interface DetectedRetroAchievementUnlock {
  id: string;
  title: string;
}

export interface RetroAchievementsConfirmationSyncResult {
  status: string;
  achievements: UserAchievement[];
}

export interface RetroAchievementsUnlockConfirmerDependencies {
  sync: () => Promise<RetroAchievementsConfirmationSyncResult>;
  wait: (milliseconds: number) => Promise<void>;
  onConfirmed: (
    confirmed: UserAchievement[],
    achievements: UserAchievement[]
  ) => void | Promise<void>;
  onError?: (error: unknown) => void;
  attemptDelaysMs?: readonly number[];
}

export const RETROACHIEVEMENTS_CONFIRMATION_DELAYS_MS = [
  0, 1_500, 1_500, 3_000, 4_000, 5_000,
] as const;

const TERMINAL_SYNC_STATUSES = new Set(["missing_credentials", "no_mapping"]);

const achievementKey = (name: string) => name.toUpperCase();

export const createRetroAchievementsUnlockConfirmer = ({
  sync,
  wait,
  onConfirmed,
  onError,
  attemptDelaysMs = RETROACHIEVEMENTS_CONFIRMATION_DELAYS_MS,
}: RetroAchievementsUnlockConfirmerDependencies) => {
  const confirmedKeys = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  const runAttempt = async (pending: Set<string>, delay: number) => {
    if (delay > 0) await wait(delay);

    const result = await sync();
    if (TERMINAL_SYNC_STATUSES.has(result.status)) return false;
    if (result.status !== "success") return true;

    const confirmed = result.achievements
      .filter(
        (achievement) =>
          achievement.unlocked && pending.has(achievementKey(achievement.name))
      )
      .toSorted((a, b) => (a.unlockTime ?? 0) - (b.unlockTime ?? 0));

    if (confirmed.length === 0) return true;

    for (const achievement of confirmed) {
      const key = achievementKey(achievement.name);
      pending.delete(key);
      confirmedKeys.add(key);
    }

    await onConfirmed(confirmed, result.achievements);
    return true;
  };

  const confirmPending = async (
    pending: Set<string>,
    attemptIndex: number
  ): Promise<void> => {
    if (pending.size === 0 || attemptIndex >= attemptDelaysMs.length) return;

    const shouldContinue = await runAttempt(
      pending,
      attemptDelaysMs[attemptIndex]
    );
    if (shouldContinue) await confirmPending(pending, attemptIndex + 1);
  };

  const confirm = (detected: DetectedRetroAchievementUnlock[]) =>
    confirmPending(
      new Set(
        detected
          .map((achievement) => achievementKey(achievement.id))
          .filter((key) => !confirmedKeys.has(key))
      ),
      0
    );

  return {
    enqueue: (detected: DetectedRetroAchievementUnlock[]) => {
      queue = queue
        .then(() => confirm(detected))
        .catch((error) => {
          onError?.(error);
        });
      return queue;
    },
  };
};
