import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { UserAchievement } from "@types";
import { AchievementMemoryStore } from "./achievement-memory-store.js";
import {
  UNLOCKED_ACHIEVEMENTS_CACHE_TTL_MS,
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
    await new Promise((resolve) => setImmediate(resolve));
    UnlockedAchievementsCache.invalidate("steam", "10");
    const fresh = load();
    await new Promise((resolve) => setImmediate(resolve));
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
    await new Promise((resolve) => setImmediate(resolve));
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
});
