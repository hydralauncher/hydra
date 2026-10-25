import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { UserAchievement } from "@types";
import { AchievementMemoryStore } from "./achievement-memory-store.js";
import {
  UNLOCKED_ACHIEVEMENTS_CACHE_TTL_MS,
  UNLOCKED_ACHIEVEMENTS_LOAD_SLOT_LEASE_MS,
  UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS,
  UnlockedAchievementsCache,
} from "./unlocked-achievements-cache.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const row = (name: string, extra: Partial<UserAchievement> = {}) =>
  ({
    name,
    displayName: name,
    icon: "",
    icongray: "",
    hidden: false,
    unlocked: false,
    unlockTime: null,
    ...extra,
  }) as UserAchievement;

const memory = () => ({ achievements: [], unlockedAchievements: [] });

const tick = () => new Promise((resolve) => setImmediate(resolve));

const loader = (rows: () => UserAchievement[], gate?: Promise<void>) => {
  const counts = { prepare: 0, read: 0 };
  const load = (valid: () => boolean = () => true, prepare = async () => {}) =>
    UnlockedAchievementsCache.load(
      "steam",
      "10",
      valid,
      async () => {
        counts.prepare++;
        await prepare();
      },
      async () => {
        counts.read++;
        await gate;
        return rows();
      }
    );
  return { counts, load };
};

describe("UnlockedAchievementsCache", () => {
  afterEach(() => {
    mock.timers.reset();
    UnlockedAchievementsCache.clear();
    AchievementMemoryStore.clear();
  });

  it("shares one in-flight load and serves repeats until the TTL ends", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000 });
    const { counts, load } = loader(() => [row("A")]);

    const [first, second] = await Promise.all([load(), load()]);
    assert.equal(first, second);
    assert.deepEqual(counts, { prepare: 1, read: 1 });

    await load();
    assert.equal(counts.read, 1);

    mock.timers.tick(UNLOCKED_ACHIEVEMENTS_CACHE_TTL_MS);
    await load();
    assert.deepEqual(counts, { prepare: 2, read: 2 });
  });

  it("reloads after the game or a combined sibling is rewritten in memory", async () => {
    AchievementMemoryStore.set("steam", "10", memory());
    AchievementMemoryStore.set("epic", "epic-10", memory());
    const { counts, load } = loader(() => [
      row("A", { source: "steam", sourceObjectId: "10" }),
      row("B", {
        unlocked: true,
        unlockTime: 1,
        sources: [
          { shop: "epic", objectId: "epic-10", name: "B", unlockTime: 1 },
        ],
      }),
    ]);

    await load();
    AchievementMemoryStore.set("steam", "10", memory());
    await load();
    assert.equal(counts.read, 2);

    AchievementMemoryStore.set("epic", "epic-10", memory());
    await load();
    assert.equal(counts.read, 3);

    await load();
    assert.equal(counts.read, 3);
  });

  it("does not cache a read that a change overtook, nor let new callers join it", async () => {
    const gate = deferred();
    const { counts, load } = loader(() => [row("A")], gate.promise);

    const stale = load();
    await tick();
    UnlockedAchievementsCache.invalidate("steam", "10");
    const fresh = load();
    await tick();
    assert.equal(counts.read, 2);

    gate.resolve();
    await Promise.all([stale, fresh]);
    await load();
    assert.equal(counts.read, 2);
  });

  it("keeps sharing a load whose own preparation changed the game", async () => {
    const { counts, load } = loader(() => [row("A")]);
    const prepare = async () => {
      UnlockedAchievementsCache.invalidate("steam", "10");
    };

    await Promise.all([load(undefined, prepare), load(undefined, prepare)]);
    await load();
    assert.deepEqual(counts, { prepare: 1, read: 1 });
  });

  it("keeps fresh results stored by a writer over an older in-flight read", async () => {
    const gate = deferred();
    const { counts, load } = loader(() => [row("OLD")], gate.promise);

    const older = load();
    await tick();
    const since = UnlockedAchievementsCache.invalidate("steam", "10");
    UnlockedAchievementsCache.set(
      "steam",
      "10",
      [row("NEW")],
      () => true,
      since
    );
    gate.resolve();
    await older;

    assert.deepEqual(
      (await load()).map((achievement) => achievement.name),
      ["NEW"]
    );
    assert.equal(counts.read, 1);
  });

  it("drops a writer's result when another change lands while it reads", async () => {
    const { counts, load } = loader(() => [row("A")]);

    let since = UnlockedAchievementsCache.invalidate("steam", "10");
    UnlockedAchievementsCache.invalidate("steam", "10");
    UnlockedAchievementsCache.set(
      "steam",
      "10",
      [row("STALE")],
      () => true,
      since
    );
    await load();
    assert.equal(counts.read, 1);

    since = UnlockedAchievementsCache.invalidate("steam", "10");
    UnlockedAchievementsCache.clear();
    UnlockedAchievementsCache.set(
      "steam",
      "10",
      [row("STALE")],
      () => true,
      since
    );
    await load();
    assert.equal(counts.read, 2);
  });

  it("ignores entries whose account or reset context ended, and clears everything", async () => {
    let current = true;
    const { counts, load } = loader(() => [row("A")]);

    await load(() => current);
    current = false;
    await load(() => current);
    assert.equal(counts.read, 2);

    current = true;
    await load(() => current);
    await load(() => current);
    assert.equal(counts.read, 3);

    UnlockedAchievementsCache.clear();
    await load(() => current);
    assert.equal(counts.read, 4);
  });

  it("caps concurrent loads and starts the newest waiting one first", async () => {
    const releases = new Map<string, () => void>();
    const prepared: string[] = [];
    const started: string[] = [];
    const ids = Array.from(
      { length: UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS + 2 },
      (_, index) => String(index)
    );
    const loads = ids.map((objectId) =>
      UnlockedAchievementsCache.load(
        "steam",
        objectId,
        () => true,
        async () => {
          prepared.push(objectId);
        },
        () => {
          started.push(objectId);
          return new Promise<UserAchievement[]>((resolve) =>
            releases.set(objectId, () => resolve([]))
          );
        }
      )
    );
    const [oldest, ...rest] = ids;
    const newest = rest.pop()!;
    const queued = rest.pop()!;

    await tick();
    assert.deepEqual(prepared, [oldest, ...rest]);
    assert.deepEqual(started, [oldest, ...rest]);

    releases.get(oldest)!();
    await tick();
    assert.equal(started.at(-1), newest);

    releases.get(newest)!();
    await tick();
    assert.equal(started.at(-1), queued);

    for (const release of releases.values()) release();
    await Promise.all(loads);
  });

  it("reloads after a locked combined sibling is rewritten in memory", async () => {
    AchievementMemoryStore.set("steam", "10", memory());
    AchievementMemoryStore.set("epic", "epic-10", memory());
    let reads = 0;
    const load = () =>
      UnlockedAchievementsCache.load(
        "steam",
        "10",
        () => true,
        async () => {},
        async () => {
          reads++;
          UnlockedAchievementsCache.recordCombinedMembers("steam", "10", [
            { shop: "steam", objectId: "10" },
            { shop: "epic", objectId: "epic-10" },
          ]);
          return [row("A", { source: "steam", sourceObjectId: "10" })];
        }
      );

    await load();
    await load();
    assert.equal(reads, 1);

    AchievementMemoryStore.set("epic", "epic-10", memory());
    await load();
    assert.equal(reads, 2);
  });

  it("lets a later caller retry a load that outlives its lease", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let reads = 0;
    let releaseStalled!: () => void;
    const load = () =>
      UnlockedAchievementsCache.load(
        "steam",
        "10",
        () => true,
        async () => {},
        () => {
          reads++;
          if (reads > 1) return Promise.resolve([row("A")]);
          return new Promise<UserAchievement[]>((resolve) => {
            releaseStalled = () => resolve([]);
          });
        }
      );

    const stalled = load();
    await tick();
    assert.equal(load(), stalled);

    mock.timers.tick(UNLOCKED_ACHIEVEMENTS_LOAD_SLOT_LEASE_MS);
    await tick();
    const retried = await load();
    assert.equal(reads, 2);
    assert.deepEqual(retried, [row("A")]);

    releaseStalled();
    await stalled;
    assert.deepEqual(await load(), [row("A")]);
    assert.equal(reads, 2);
  });

  it("frees the slot of a load that outlives its lease", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const releases: (() => void)[] = [];
    const started: string[] = [];
    const loads = Array.from(
      { length: UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS + 1 },
      (_, index) =>
        UnlockedAchievementsCache.load(
          "steam",
          `stalled-${index}`,
          () => true,
          async () => {},
          () => {
            started.push(String(index));
            return new Promise<UserAchievement[]>((resolve) =>
              releases.push(() => resolve([]))
            );
          }
        )
    );

    await tick();
    assert.equal(started.length, UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS);

    mock.timers.tick(UNLOCKED_ACHIEVEMENTS_LOAD_SLOT_LEASE_MS);
    await tick();
    assert.equal(
      started.length,
      UNLOCKED_ACHIEVEMENTS_MAX_CONCURRENT_LOADS + 1
    );

    for (const release of releases) release();
    await Promise.all(loads);
  });
});
