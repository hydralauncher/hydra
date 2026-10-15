import { GameRequestQueue } from "../library-sync/game-request-queue.js";

export const ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS = 20_000;
export const ACHIEVEMENT_SYNC_RETRY_DELAY_MS = 1_000;
export const ACHIEVEMENT_SYNC_MAX_RETRY_DELAY_MS = 60_000;
export const ACHIEVEMENT_SYNC_MAX_RETRY_EXPONENT = 6;
export const ACHIEVEMENT_SYNC_RETRY_JITTER_DIVISOR = 4;
export const ACHIEVEMENT_SYNC_MAX_TIMER_DELAY_MS = 2_147_483_647;
export const ACHIEVEMENT_SYNC_RETRYABLE_CLIENT_STATUSES = [408, 409, 429];
export const ACHIEVEMENT_RESET_RETRY_BUDGET_MS = 75_000;

export class AchievementSyncCancelledError extends Error {
  constructor() {
    super("achievement-sync-context-changed");
    this.name = "AchievementSyncCancelledError";
  }
}

const assertCurrent = (current: () => boolean) => {
  if (!current()) throw new AchievementSyncCancelledError();
  return true;
};

export class AchievementSyncCoordinator {
  private readonly merges = new GameRequestQueue();
  private readonly requests = new GameRequestQueue();
  private readonly revisions = new Map<string, number>();
  private readonly resets = new Map<string, number>();

  captureCurrent(key: string, current: () => boolean) {
    const revision = this.revisions.get(key) ?? 0;
    return () =>
      current() &&
      !this.resets.has(key) &&
      (this.revisions.get(key) ?? 0) === revision;
  }

  async runMerge<T>(
    key: string,
    task: (current: () => boolean) => Promise<T>,
    current: () => boolean = () => true
  ) {
    const valid = this.captureCurrent(key, current);
    assertCurrent(valid);
    return this.merges.run(
      [key],
      () => task(valid),
      () => assertCurrent(valid)
    );
  }

  private async request<T>(task: () => Promise<T>, current: () => boolean) {
    assertCurrent(current);
    return this.requests.run(
      ["achievements"],
      async () => {
        const result = await task();
        assertCurrent(current);
        return result;
      },
      () => assertCurrent(current)
    );
  }

  runRequest<T>(key: string, task: () => Promise<T>, current: () => boolean) {
    return this.request(task, this.captureCurrent(key, current));
  }

  runResetRequest<T>(
    key: string,
    task: () => Promise<T>,
    current: () => boolean
  ) {
    return this.request(task, () => this.resets.has(key) && current());
  }

  private drainSentRequests() {
    return this.requests.run(
      ["achievements"],
      async () => {},
      () => true
    );
  }

  async resetGame<T>(
    key: string,
    task: () => Promise<T>,
    current: () => boolean = () => true
  ) {
    this.resets.set(key, (this.resets.get(key) ?? 0) + 1);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    try {
      return await this.merges.run(
        [key],
        async () => {
          await this.drainSentRequests();
          assertCurrent(current);
          return task();
        },
        () => assertCurrent(current)
      );
    } finally {
      const remaining = (this.resets.get(key) ?? 1) - 1;
      if (remaining) this.resets.set(key, remaining);
      else this.resets.delete(key);
    }
  }
}

export const achievementSyncCoordinator = new AchievementSyncCoordinator();
