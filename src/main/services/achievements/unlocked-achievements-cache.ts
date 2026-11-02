import type { GameShop, UserAchievement } from "@types";
import {
  AchievementMemoryStore,
  type AchievementMemoryEntry,
} from "./achievement-memory-store.js";

export const UNLOCKED_ACHIEVEMENTS_CACHE_TTL_MS = 30_000;
export const UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS = 4;
export const UNLOCKED_ACHIEVEMENTS_LOAD_SLOT_LEASE_MS = 10_000;

interface MemoryDependency {
  shop: GameShop;
  objectId: string;
  entry: AchievementMemoryEntry | undefined;
}

interface CachedAchievements {
  achievements: UserAchievement[];
  expiresAt: number;
  valid: () => boolean;
  dependencies: Map<string, MemoryDependency>;
}

interface PendingLoad {
  promise: Promise<UserAchievement[]>;
  readingSince: number | null;
}

const gameKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

const cached = new Map<string, CachedAchievements>();
const pending = new Map<string, PendingLoad>();
const combinedMembers = new Map<string, Map<string, [GameShop, string]>>();
const invalidatedAt = new Map<string, number>();
let clearedAt = 0;
let clock = 0;
let activeLoads = 0;
const waitingLoads: (() => void)[] = [];

const acquireLoadSlot = async () => {
  if (activeLoads < UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS) {
    activeLoads++;
    return;
  }
  await new Promise<void>((resolve) => waitingLoads.push(resolve));
};

const releaseLoadSlot = () => {
  // Newest first: the card on screen or the open game page outranks cards scrolled away.
  const next = waitingLoads.pop();
  if (next) next();
  else activeLoads--;
};

const withLoadSlot = async <T>(
  task: () => Promise<T>,
  onLeaseExpired: () => void
) => {
  await acquireLoadSlot();
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    releaseLoadSlot();
  };
  // Achievement GETs have no request timeout, so a stalled one must not pin a slot.
  const lease = setTimeout(() => {
    release();
    onLeaseExpired();
  }, UNLOCKED_ACHIEVEMENTS_LOAD_SLOT_LEASE_MS);
  try {
    return await task();
  } finally {
    clearTimeout(lease);
    release();
  }
};

const collectDependencies = (
  shop: GameShop,
  objectId: string,
  achievements: UserAchievement[]
) => {
  const games = new Map<string, [GameShop, string]>([
    [gameKey(shop, objectId), [shop, objectId]],
    ...(combinedMembers.get(gameKey(shop, objectId)) ?? []),
  ]);
  for (const achievement of achievements) {
    if (
      achievement.sourceObjectId &&
      (achievement.source === "steam" || achievement.source === "epic")
    ) {
      games.set(gameKey(achievement.source, achievement.sourceObjectId), [
        achievement.source,
        achievement.sourceObjectId,
      ]);
    }
    for (const source of achievement.sources ?? []) {
      games.set(gameKey(source.shop, source.objectId), [
        source.shop,
        source.objectId,
      ]);
    }
  }
  return new Map(
    [...games].map(([key, [dependencyShop, dependencyObjectId]]) => [
      key,
      {
        shop: dependencyShop,
        objectId: dependencyObjectId,
        entry: AchievementMemoryStore.get(dependencyShop, dependencyObjectId),
      },
    ])
  );
};

const isFresh = (entry: CachedAchievements) =>
  entry.expiresAt > Date.now() &&
  entry.valid() &&
  [...entry.dependencies.values()].every(
    (dependency) =>
      AchievementMemoryStore.get(dependency.shop, dependency.objectId) ===
      dependency.entry
  );

const changedSince = (since: number, keys: Iterable<string>) =>
  clearedAt > since ||
  [...keys].some((key) => (invalidatedAt.get(key) ?? 0) > since);

const store = (
  shop: GameShop,
  objectId: string,
  achievements: UserAchievement[],
  valid: () => boolean,
  since: number
) => {
  const dependencies = collectDependencies(shop, objectId, achievements);
  if (!valid() || changedSince(since, dependencies.keys())) return;

  const now = Date.now();
  for (const [key, entry] of cached)
    if (entry.expiresAt <= now) cached.delete(key);

  cached.set(gameKey(shop, objectId), {
    achievements,
    expiresAt: now + UNLOCKED_ACHIEVEMENTS_CACHE_TTL_MS,
    valid,
    dependencies,
  });
};

const invalidate = (shop: GameShop, objectId: string) => {
  const key = gameKey(shop, objectId);
  invalidatedAt.set(key, ++clock);
  for (const [cachedKey, entry] of cached)
    if (entry.dependencies.has(key)) cached.delete(cachedKey);
  // A load that has not started reading will still observe this change.
  if (pending.get(key)?.readingSince != null) pending.delete(key);
  return clock;
};

const load = (
  shop: GameShop,
  objectId: string,
  valid: () => boolean,
  prepare: () => Promise<void>,
  read: () => Promise<UserAchievement[]>
): Promise<UserAchievement[]> => {
  const key = gameKey(shop, objectId);
  const entry = cached.get(key);
  if (entry && isFresh(entry)) return Promise.resolve(entry.achievements);
  if (entry) cached.delete(key);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight.promise;

  const run: PendingLoad = { readingSince: null, promise: Promise.resolve([]) };
  pending.set(key, run);
  let expired = false;
  run.promise = (async () => {
    try {
      return await withLoadSlot(
        async () => {
          await prepare();
          const since = clock;
          run.readingSince = since;
          const achievements = await read();
          // A retry may already have stored newer results for this game.
          if (!expired) store(shop, objectId, achievements, valid, since);
          return achievements;
        },
        () => {
          expired = true;
          if (pending.get(key) === run) pending.delete(key);
        }
      );
    } finally {
      if (pending.get(key) === run) pending.delete(key);
    }
  })();
  return run.promise;
};

export const UnlockedAchievementsCache = {
  load,

  // `since` is the mark from the writer's own invalidate, taken before it read.
  set: store,

  invalidate,

  // Locked variants never reach the presented rows, so the whole group is recorded here.
  recordCombinedMembers(
    shop: GameShop,
    objectId: string,
    members: Iterable<{ shop: GameShop; objectId: string }>
  ) {
    combinedMembers.set(
      gameKey(shop, objectId),
      new Map(
        [...members].map((member) => [
          gameKey(member.shop, member.objectId),
          [member.shop, member.objectId],
        ])
      )
    );
  },

  clear() {
    clearedAt = ++clock;
    invalidatedAt.clear();
    cached.clear();
    pending.clear();
    combinedMembers.clear();
  },
};
